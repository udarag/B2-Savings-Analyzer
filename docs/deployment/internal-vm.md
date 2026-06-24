# Internal VM Deployment Runbook

B2 Savings Analyzer is deployed as a serverful Next.js app on a Backblaze-internal VM. The public app hostname is `https://savings.backblazedemos.xyz`, but access still depends on the internal/VPN network path to the VM.

## Current Production Shape

- Host: Backblaze-internal `deals` VM at `172.16.56.50`.
- App checkout: `/home/udara/b2-savings-analyzer/app`.
- Active release symlink: `/home/udara/b2-savings-analyzer/current`.
- Production env file: `/home/udara/b2-savings-analyzer/shared/.env.production`, symlinked into releases.
- App service: `b2-savings-analyzer.service`.
- App bind: `127.0.0.1:3001`.
- Reverse proxy: nginx site `b2-savings-analyzer`.
- TLS: Let's Encrypt certificate for `savings.backblazedemos.xyz`, issued with Cloudflare DNS-01.
- Deploy automation: `b2-savings-analyzer-deploy.timer` runs a deploy check about once per minute against `origin/BSA-V2-db`.
- Current persistence mode: B2-backed JSON/object storage. Postgres support exists in the codebase, but production is intentionally not using it until a migration/backfill is planned.
- Email: Resend magic links from a verified sender on `mail.backblazedemos.xyz`.

The VM also hosts DealStory. Deployment and restart commands for this app should only touch `b2-savings-analyzer.service` and the B2 Savings Analyzer nginx site.

## Required Environment

Set these in the VM service environment or production env file. Do not commit values:

```env
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_KEY_ID=<key-id>
B2_APP_KEY=<app-key>
B2_BUCKET_NAME=<bucket>

AUTH_SECRET=<random-32-char-string>
ALLOWED_EMAIL_DOMAIN=backblaze.com
RESEND_API_KEY=<resend-key>
EMAIL_FROM="B2 Savings Analyzer <sign-in@your-verified-resend-domain>"

APP_BASE_URL=https://savings.backblazedemos.xyz
NEXT_PUBLIC_BASE_URL=https://savings.backblazedemos.xyz

# Current production mode is B2-only persistence.
DATABASE_STORAGE_ENABLED=false

# Optional future Postgres mode:
# DATABASE_URL=postgres://user:password@host:5432/b2_savings_analyzer
# DATABASE_STORAGE_ENABLED=true
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_POOL_MAX=5
```

If the internal Postgres service requires a custom CA, mount the CA file on the VM/container and set:

```env
DATABASE_SSL=true
DATABASE_SSL_CA_FILE=/path/to/ca-bundle.pem
```

## Normal Production Release

Normal app changes should ship through git, not by editing source on the VM.

1. Commit the change on branch `BSA-V2-db`.
2. Run local verification: `npm run lint`, `npm run build`, and `git diff --check`.
3. Push to `origin/BSA-V2-db`.
4. Wait for `b2-savings-analyzer-deploy.timer`, or trigger an immediate deploy check:

```sh
ssh udara@172.16.56.50
sudo systemctl start b2-savings-analyzer-deploy.service
sudo systemctl status b2-savings-analyzer-deploy.service --no-pager
```

The deploy script builds a release under `/home/udara/b2-savings-analyzer/releases/{sha}`, copies `.next/static` and `public` into `.next/standalone`, flips `/home/udara/b2-savings-analyzer/current`, and restarts `b2-savings-analyzer.service`.

## Manual Node Deploy Shape

Use this only if the deploy timer needs to be recreated or debugged:

```sh
npm install
npm run build
cp -a .next/static .next/standalone/.next/static
cp -a public .next/standalone/public
HOSTNAME=127.0.0.1 PORT=3001 node .next/standalone/server.js
```

That static-copy step is required for standalone runtime output; without it, CSS chunks and public images return 404.

## Future Docker Shape

The repository has a `Dockerfile`, and Docker remains a good portable target. If switching production to Docker, preserve the same requirements:

- Include Playwright Chromium dependencies.
- Include `.next/static` and `public` in the runtime image.
- Bind the app to localhost or an internal interface behind nginx/load balancer.
- Run `npm run db:migrate` before enabling Postgres-backed persistence.

## Magic-Link Verification

After deployment:

1. Visit `https://savings.backblazedemos.xyz/login`.
2. Request a link for a `@backblaze.com` address.
3. Confirm the email link starts with `https://savings.backblazedemos.xyz/api/auth/verify`.
4. Confirm the post-verification redirect stays on `https://savings.backblazedemos.xyz`.

If a link or redirect points at `0.0.0.0:3000`, check `APP_BASE_URL` first.

If the UI says the email was sent but the recipient never receives it, check service logs for Resend errors and confirm `EMAIL_FROM` is set to a sender address on a verified Resend domain. The Resend test sender `onboarding@resend.dev` can only send to the Resend account owner's email address.

## Postgres Migration Notes

Do not enable Postgres in production casually. The current production cutover intentionally uses B2-backed JSON/object persistence so existing analyses stay readable.

When the team decides to move structured data into Postgres:

1. Provision Postgres and backups.
2. Set `DATABASE_URL` and database SSL settings in the production env file.
3. Run `npm run db:migrate`.
4. Backfill existing B2 records with `npm run db:backfill -- user@backblaze.com`.
5. Set `DATABASE_STORAGE_ENABLED=true`.
6. Deploy and verify analysis listing, upload, report snapshot, PDF generation, and rerun flows.

## Network Notes

Restrict access at the internal proxy, load balancer, VM firewall, or network ACL layer. The app itself only enforces Backblaze email-domain authentication; it does not replace VPN/network access control.
