# Internal VM Deployment Runbook

This deployment path runs B2 Savings Analyzer on a Backblaze-internal VM behind VPN/internal access controls.

## Runtime Shape

- Next.js standalone server listens on `0.0.0.0:3000`.
- Internal reverse proxy or load balancer terminates TLS for `savings.backblazedemos.xyz`.
- Postgres stores structured app data when `DATABASE_URL` is set.
- Backblaze B2 remains the object store for uploaded bills and binary artifacts.
- Resend sends magic-link emails.

## Required Environment

Set these in the VM service environment or container env file:

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

DATABASE_URL=postgres://user:password@host:5432/b2_savings_analyzer
DATABASE_STORAGE_ENABLED=true
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_POOL_MAX=5
```

If the internal Postgres service requires a custom CA, mount the CA file on the VM/container and set:

```env
DATABASE_SSL=true
DATABASE_SSL_CA_FILE=/path/to/ca-bundle.pem
```

## Deploy With Node

```sh
npm install
npm run build
npm run db:migrate
HOSTNAME=0.0.0.0 PORT=3000 npm run start
```

Run the server under the VM's normal process supervisor, such as systemd.

## Deploy With Docker

```sh
docker build -t b2-savings-analyzer .
docker run --env-file .env.production -p 3000:3000 b2-savings-analyzer
```

Run migrations before replacing the serving container:

```sh
docker run --rm --env-file .env.production b2-savings-analyzer npm run db:migrate
```

## Magic-Link Verification

After deployment and DNS/proxy remapping:

1. Visit `https://savings.backblazedemos.xyz/login`.
2. Request a link for a `@backblaze.com` address.
3. Confirm the email link starts with `https://savings.backblazedemos.xyz/api/auth/verify`.
4. Confirm the post-verification redirect stays on `https://savings.backblazedemos.xyz`.

If a link or redirect points at `0.0.0.0:3000`, check `APP_BASE_URL` first.

If the UI says the email was sent but the recipient never receives it, check service logs for Resend errors and confirm `EMAIL_FROM` is set to a sender address on a verified Resend domain. The Resend test sender `onboarding@resend.dev` can only send to the Resend account owner's email address.

## Network Notes

Restrict access at the internal proxy, load balancer, VM firewall, or network ACL layer. The app itself only enforces Backblaze email-domain authentication; it does not replace VPN/network access control.
