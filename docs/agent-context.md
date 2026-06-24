# Shared Coding Agent Context

This file is tracked on purpose. It gives any coding agent enough shared context to work in this repo without relying on one person's local notes. Keep sensitive values, customer bills, and machine-only state in `PROJECT_CONTEXT.local.md` instead.

Last updated: 2026-06-24.

## Read First

- Follow `AGENTS.md`. Before changing Next.js code, read the relevant guide under `node_modules/next/dist/docs/` because this repo uses Next.js 16 and the APIs may differ from common training data.
- Quote App Router paths that contain brackets in shell commands, for example `sed -n '1,200p' 'src/app/analyses/[id]/page.tsx'`.
- Treat unrelated worktree changes as user-owned. Do not revert them unless the user explicitly asks.
- Keep `.env*`, `.claude/`, `bills/`, `tmp/`, and `PROJECT_CONTEXT.local.md` out of commits.
- Customer bills are sensitive. Store local test bills under `bills/`, which is gitignored.

## Current Product State

- Product: Backblaze B2 Savings Analyzer, an internal Backblaze Solutions Engineering tool for turning customer cloud bills into storage-scope migration economics.
- Stack: Next.js 16.2.9 App Router, React 19.2.4, TypeScript, Tailwind CSS 4, Recharts, Playwright, Backblaze B2 via the S3-compatible SDK, jose JWTs, Resend magic-link email, optional Postgres.
- Production URL: `https://savings.backblazedemos.xyz`.
- Production host: Backblaze-internal `deals` VM, behind internal/VPN network access, served by nginx over HTTPS.
- Runtime: systemd-managed Next.js standalone server bound to localhost, currently behind nginx at `127.0.0.1:3001`.
- Production release source: branch `BSA-V2-db` on `origin`. A VM systemd deploy timer checks that branch about once per minute, builds new releases, flips the `current` symlink, and restarts only `b2-savings-analyzer.service`.
- Production persistence today: B2-backed JSON/object storage. The Postgres schema and adapter exist, but production should stay B2-only until a deliberate migration/backfill is planned.
- Auth: Backblaze-domain magic links. Production requires `EMAIL_FROM` on a verified Resend sender domain.

## Architecture Map

- `src/app/`: App Router pages and API routes.
- `src/app/page.tsx`: authenticated opportunity list, search/sort, duplicate/delete, latest snapshot previews, and "Rerun All".
- `src/app/analyses/[id]/page.tsx`: internal analysis dashboard.
- `src/app/analyses/[id]/report/page.tsx`: customer-facing report screen used by PDF export.
- `src/app/api/analyses/route.ts`: list/create analyses for the signed-in user.
- `src/app/api/analyses/[id]/route.ts`: read/update/delete one analysis.
- `src/app/api/analyses/[id]/upload/route.ts`: upload bill, parse it, save parsed bill and model config.
- `src/app/api/analyses/[id]/pdf/route.ts`: Playwright PDF generation from the customer report route.
- `src/app/api/analyses/rerun/route.ts`: rerun every opportunity owned by the signed-in user.
- `src/lib/parsers/`: deterministic bill parsers and provider detection.
- `src/lib/engine/`: tier inventory, tier selection, cost model, egress model, projections.
- `src/lib/pricing/`: provider pricing JSON, lookup helpers, freshness checks, pricing detection.
- `src/lib/storage/`: B2 object storage plus optional Postgres persistence adapters.
- `src/lib/analysis/`: shared snapshot, action-cost, access-cost, readiness, and rerun logic.

## Data Model

- User object prefix: `users/{userEmail}`.
- Analysis object prefix: `users/{userEmail}/analyses/{analysisId}`.
- B2 objects per analysis: `meta.json`, `parsed.json`, `model-config.json`, `uploads/{filename}`, `snapshots/{snapshotId}.json`, and `latest-snapshot.json`.
- Optional Postgres mode stores structured metadata, parsed bills, model configs, report snapshots, user profiles, and upload object metadata while keeping original bill files in B2.
- API routes must preserve user scoping through `requireUser()` and user-specific storage paths.

## Product Boundaries

- Frame savings around addressable storage-scope economics. Do not imply the tool replaces an entire cloud bill.
- Keep miscellaneous and non-storage spend out of the storage story unless the UI explicitly labels it as transfer, operations, retrieval, or out-of-scope context.
- Customer-facing reports and PDFs should not expose internal warnings, missing env-var names, beta parser caveats, or implementation details.
- Internal dashboard warnings are acceptable when they help Backblaze users understand pricing freshness, parser confidence, or source-bill assumptions.
- Use sentence-case copy by default and keep AE-facing labels direct.
- Reports should use the customer/company name when available, falling back to the internal opportunity name.

## Important Workflows

- Upload flow stores the original bill, runs `detectAndParse()`, saves parsed output and metadata, and creates an initial model config from tier inventory defaults.
- Dashboard flow reads metadata, parsed bill, and model config, then computes tier inventory, cost model, projections, transaction impact, access costs, deal sizing, and readiness in the client.
- Report flow creates durable `ReportSnapshot` records and renders the customer-facing report without internal-only warnings.
- PDF flow uses Playwright to open the report route with the user's session cookie and export a Letter PDF.
- Bulk rerun uses `src/lib/analysis/rerun.ts` to reparse the latest original upload when present, normalize model config, rebuild snapshots, and return per-analysis statuses.

## Validation Gates

- Run `npm run lint` and `npm run build` before pushing production changes.
- Use `git diff --check` before staging or committing.
- Run focused parser/model checks when touching parsers, pricing, projections, egress, access costs, or transaction logic.
- For report/PDF changes, verify the browser report and PDF route with realistic data when credentials and a running app are available.
- For production-impacting changes, confirm the app still builds as a standalone Next.js server and that `.next/static` plus `public` are included in the standalone runtime artifact.

## Production Release Flow

1. Make changes on `BSA-V2-db`.
2. Run `npm run lint`, `npm run build`, and `git diff --check`.
3. Commit only intended source/docs changes.
4. Push to `origin/BSA-V2-db`.
5. The VM deploy timer should pick up the new commit within about one minute and restart `b2-savings-analyzer.service`.
6. Verify `https://savings.backblazedemos.xyz/login` from a network that can reach the internal VM.

Do not hot-edit application source on the VM for normal releases. Use VM changes only for environment, systemd, nginx, certificate, or emergency operational fixes, and document any durable operational change in `docs/deployment/internal-vm.md`.
