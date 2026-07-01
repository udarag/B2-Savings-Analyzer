# Shared Coding Agent Context

This file is tracked on purpose. It gives any coding agent shared repo context without depending on one person's local notes. Keep secrets, customer bills, private credentials, local screenshots, and machine-only observations in `PROJECT_CONTEXT.local.md` instead.

Last updated: 2026-06-30.

## Source Of Truth

- `AGENTS.md`: mandatory agent instructions. It includes the Next.js 16 warning and points agents here.
- `CLAUDE.md`: tracked one-line forwarder to `@AGENTS.md`.
- `README.md`: human-facing overview, setup, production release flow, completed work, and TODOs.
- `docs/deployment/internal-vm.md`: tracked operational runbook for the internal VM deployment.
- `PROJECT_CONTEXT.local.md`: ignored local handoff with maximal context, deployment observations, validation notes, and sensitive or machine-specific details.

When architecture, release flow, validation expectations, or important product behavior changes, update this file if the context is safe to share in the repo. When making code pushes, also update `PROJECT_CONTEXT.local.md` with local current state and validation results.

## Read First

- Before changing Next.js code, read the relevant guide under `node_modules/next/dist/docs/`; this repo uses Next.js 16 and may differ from common training-data assumptions.
- Quote App Router paths that contain brackets in shell commands, for example `sed -n '1,200p' 'src/app/analyses/[id]/page.tsx'`.
- Treat unrelated worktree changes as user-owned. Do not revert them unless the user explicitly asks.
- Keep `.env*`, `.claude/`, `bills/`, `tmp/`, and `PROJECT_CONTEXT.local.md` out of commits.
- Customer bills are sensitive. Store local test bills under `bills/`, which is gitignored.
- Prefer concrete repo changes and verification over long proposals for routine implementation work.

## Product Snapshot

- Product: Backblaze B2 Savings Analyzer.
- Audience: internal Backblaze AE/SE workflow.
- Purpose: upload customer cloud bills, isolate addressable storage-scope spend, model migration economics to Backblaze B2, and produce both an internal analysis dashboard and customer-facing report/PDF.
- Supported inputs: AWS detailed billing PDF, AWS S3 cost export CSV, AWS summary invoice PDF, GCP cost table CSV, and Excel files converted to CSV.
- Core distinction: this is a storage economics tool, not a full cloud-bill replacement model.

## Tech Stack

- Next.js 16.2.9 App Router, React 19.2.4, TypeScript, Tailwind CSS 4.
- Recharts for projection charts.
- Playwright for PDF generation.
- AWS S3 SDK pointed at Backblaze B2 for object storage.
- Optional Postgres via `pg` for structured persistence.
- `jose` JWTs for magic-link auth/session cookies.
- Resend for magic-link email.
- `xlsx` for Excel ingestion.
- `@next/env` for script-side env loading.

## Production State

- Production URL: `https://savings.backblazedemos.xyz`.
- Hosting: Backblaze-internal `deals` VM behind internal/VPN network access.
- Runtime: systemd-managed Next.js standalone server bound to localhost behind nginx.
- Release branch: `main` on `origin`.
- Deploy automation: VM systemd deploy timer checks `origin/main` about once per minute, builds a new release, copies `.next/static` and `public` into the standalone runtime, flips the `current` symlink, and restarts only `b2-savings-analyzer.service`.
- Build/version display: `/login` shows a small `Build <short-sha>` footer. `next.config.ts` derives it from the git SHA at build time, so the VM login page tracks the deployed commit after each push to `origin/main`.
- Persistence in production: B2-backed JSON/object storage. Postgres support exists, but production should stay B2-only until a deliberate migration/backfill is planned.
- Email in production: Resend with a verified sender domain. `EMAIL_FROM` is required in production.

See `docs/deployment/internal-vm.md` for the full operator runbook. Do not hot-edit application source on the VM for normal releases.

## Environment Variables

- B2 storage: `B2_ENDPOINT`, `B2_REGION`, `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET_NAME`.
- Auth: `AUTH_SECRET`, `ALLOWED_EMAIL_DOMAIN`.
- Email: `RESEND_API_KEY`, `EMAIL_FROM`.
- App URLs: `APP_BASE_URL`, `NEXT_PUBLIC_BASE_URL`.
- Optional build metadata override: `B2SA_BUILD_SHA`, `GIT_HASH`, or `VERCEL_GIT_COMMIT_SHA`.
- Optional pricing refresh: `GCP_CLOUD_BILLING_API_KEY`.
- Optional commit-upsell screenshot parsing: `ANTHROPIC_API_KEY` (Claude vision reads uploaded B2 usage *screenshots*). The default PDF upload is parsed deterministically and needs no key; absent the key, the image path degrades to manual entry — no other feature depends on it.
- Optional Postgres: `DATABASE_URL`, `DATABASE_STORAGE_ENABLED`, `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `DATABASE_SSL_CA_FILE`, `DATABASE_POOL_MAX`.

`APP_BASE_URL` is used by server-side flows such as magic-link generation, auth verification redirects, and PDF generation. In production, set both `APP_BASE_URL` and `NEXT_PUBLIC_BASE_URL` to `https://savings.backblazedemos.xyz`.

Database storage is enabled only when `DATABASE_URL` is present and `DATABASE_STORAGE_ENABLED` is not `false`, `0`, or `off`. Leave `DATABASE_URL` unset or set `DATABASE_STORAGE_ENABLED=false` to force B2-only mode.

## Repository Map

- `src/app/`: App Router pages and API routes.
- `src/app/page.tsx`: authenticated opportunity list, search/sort, delete, latest snapshot previews, and "Rerun All".
- `src/app/analyses/new/page.tsx`: new opportunity creation.
- `src/app/analyses/[id]/page.tsx`: internal analysis dashboard.
- `src/app/analyses/[id]/report/page.tsx`: customer-facing report screen used by PDF export.
- `src/app/api/analyses/route.ts`: list/create analyses for the signed-in user.
- `src/app/api/analyses/[id]/route.ts`: read/update/delete one analysis.
- `src/app/api/analyses/[id]/upload/route.ts`: upload bill, parse it, save parsed bill and initial model config; also fulfills a pending Overdrive-variant clone after the first successful parse.
- `src/app/api/analyses/[id]/create-overdrive-variant/route.ts`: clone an existing analysis into a linked Overdrive-tier variant.
- `src/app/api/analyses/[id]/b2-usage/route.ts`: get/save the commit-upsell flow's AE-entered usage input.
- `src/app/api/analyses/[id]/usage-export/route.ts`: stores an uploaded usage export and parses it — PDF deterministically (default), image via Claude vision.
- `src/app/api/analyses/[id]/snapshot/route.ts`: create/list durable report snapshots.
- `src/app/api/analyses/[id]/pdf/route.ts`: Playwright-based PDF generation.
- `src/app/api/analyses/rerun/route.ts`: rerun every opportunity owned by the signed-in user.
- `src/app/api/auth/*`: magic-link login, session lookup, profile, logout, verification.
- `src/components/dashboard/`: internal dashboard widgets, including `CommitUpsellDashboard.tsx` for the no-bill commit-upsell opportunity type.
- `src/components/report/`: `CommitUpsellReport.tsx`, the commit-upsell flow's customer-facing report (dispatched from `report/page.tsx`).
- `src/components/upload/`: upload and parse review UI, plus `B2UsageForm.tsx`/`B2UsageExportUpload.tsx` for the commit-upsell flow.
- `src/components/shared/`: shared formatting, user menu, theme controller, document title helper, inline editing.
- `src/lib/parsers/`: deterministic bill parsers and provider detection.
- `src/lib/engine/`: tier inventory, tier selection, egress model, cost model, projections.
- `src/lib/pricing/`: provider pricing JSON, lookup helpers, freshness checks, pricing detection, and `service-levels.ts` (B2 service-tier specs).
- `src/lib/storage/`: B2 storage helpers and optional Postgres persistence adapters.
- `src/lib/db/`: Postgres connection helper.
- `src/lib/analysis/`: shared rerun, readiness, action-cost, access-cost, service-tier-comparison, Overdrive-variant cloning (`variant.ts`), and commit-upsell compute (`commit-upsell-model.ts`) helpers.
- `src/types/`: durable TypeScript interfaces for parsed bills, model config, B2 usage input, and snapshots.
- `migrations/`: SQL migrations for optional Postgres mode.
- `scripts/`: pricing refresh, DB migration, and DB backfill scripts.

## Data And Storage Model

- User object prefix: `users/{userEmail}`.
- Analysis object prefix: `users/{userEmail}/analyses/{analysisId}`.
- B2 objects per analysis:
  - `meta.json`: `Analysis`.
  - `parsed.json`: `ParsedBill`.
  - `model-config.json`: `ModelConfig`.
  - `uploads/{filename}`: original uploaded bill file.
  - `snapshots/{snapshotId}.json`: `ReportSnapshot`.
  - `latest-snapshot.json`: latest `ReportSnapshot` for efficient list previews.
- Optional Postgres mode stores structured metadata, parsed bills, model configs, report snapshots, user profiles, and upload object metadata while keeping original bill files in B2.
- API routes must preserve user scoping through `requireUser()` and user-specific storage paths.
- Bulk operations are signed-in-user scoped, not global admin operations.

## Core Types

- `Analysis`: opportunity metadata such as id, prospect name, optional company name, notes, provider, bill type, billing period, account id, detection signals, timestamps, pipeline status, opportunity type, and Overdrive-variant linkage fields.
- `ParsedBill`: parsed line items, account/service breakdowns, compute signals, egress profile suggestion, total, warnings, discounts, and optional commercial signals.
- `ModelConfig`: tier toggles, egress config, B2 price/TB, B2 service tier, projection term, pricing discount confirmation.
- `B2UsageInput`: the commit-upsell flow's ParsedBill analog — AE-entered current storage/spend, growth assumption, and target tier, with no source bill involved.
- `ReportSnapshot`: durable rollup used by list previews, report views, PDF downloads, and reruns. Trigger values include `pdf-download`, `report-view`, and `analysis-rerun`.
- `TIER_SELECTION_VERSION`: currently `2`; rerun logic normalizes stored configs to current defaults and version.

## B2 Service Tiers, Overdrive Variants, And Opportunity Types

- `ModelConfig.b2ServiceTier` (`'uncommitted' | 'committed' | 'overdrive'`, default `'committed'`) drives throughput/RPS display and Overdrive's unlimited-egress treatment in the cost/egress engine (`src/lib/engine/cost-model.ts`, `egress-model.ts`). Tier specs (throughput Gbit/s, RPS ceiling, egress/fee treatment) live in `src/lib/pricing/b2.json`'s `serviceLevels` object; read them via `src/lib/pricing/service-levels.ts`, never by re-deriving in a second place.
- The dashboard's "Build the deal" panel (`DealSizing.tsx`) has a 3-way service-tier segmented control next to the price control; switching to Overdrive suggests (does not force) the tier's starting $/TB. The customer report shows a service-tier comparison card via `src/lib/analysis/service-tier-comparison.ts`.
- **Linked Overdrive variants**: an AE can check "also create a linked Overdrive variant" at New Opportunity creation. The clone (same parsed bill, `b2ServiceTier: 'overdrive'`, suggested $15/TB) happens right after the first successful bill upload, via the shared `createOverdriveVariant()` helper in `src/lib/analysis/variant.ts` (also exposed as `POST /api/analyses/[id]/create-overdrive-variant` for triggering it later). The two analyses are bidirectionally linked via `Analysis.linkedAnalysisId`/`serviceTierVariant`; deleting one half intentionally does not cascade-delete the other, and a dangling cross-link is expected to 404 gracefully rather than being treated as an error.
- **Commit-upsell opportunities** (`Analysis.opportunityType === 'commit-upsell'`, absent means the default `'migration'` flow): for an existing B2 Uncommitted customer with no source-cloud bill, pitching a move to Committed or Overdrive. New Opportunity branches to a usage form (`B2UsageForm`) instead of the bill-upload step; the dashboard/report pages each do a thin early dispatch to `CommitUpsellDashboard`/`CommitUpsellReport` rather than threading a branch through the bill-shaped migration UI. The compute path (`src/lib/analysis/commit-upsell-model.ts`) reuses the migration flow's growth-projection helpers but is otherwise separate from `ParsedBill`/`computeCostModel`, and never fabricates a dollar-savings figure — Committed is typically flat $/TB vs. Uncommitted, and the report leads with a throughput comparison instead of a savings hero.
- **Usage export upload** (the default way to fill `B2UsageForm`): `B2UsageExportUpload` posts to `POST /api/analyses/[id]/usage-export`, which stores the file and branches by type. A **PDF** (an AE printing Bzadmin's Usage page — the recommended path) is parsed **deterministically** via `extractPdfText()` + `parseUsagePdfText()` (`src/lib/analysis/usage-pdf-parse.ts`): monthly spend = the summary row's last dollar amount, current storage = the largest volume number, growth from the total-stored trend, period from the title date range — **no API key, no data egress**. A **screenshot image** is read via Claude vision (`parseUsageScreenshot()`, `usage-screenshot-parse.ts`, `claude-opus-4-8`) only when `ANTHROPIC_API_KEY` is set. Both paths return `{status: 'parsed', parsed}` and the form pre-fills; `'unavailable'` (image, no key) / `'failed'` fall back to manual entry. The shared GB→TB/spend/growth derivation lives in the dependency-free `usage-fields.ts` (imported by both parsers and, as a type, by the client). The Claude SDK (`@anthropic-ai/sdk` + optional `ANTHROPIC_API_KEY`) is the app's first external-LLM dependency and is imported server-side only, so the PDF default works with no LLM at all.

## Product Boundaries

- Frame savings around addressable storage-scope economics. Do not imply the tool replaces an entire cloud bill.
- Keep miscellaneous and non-storage spend out of the storage story unless the UI explicitly labels it as transfer, operations, retrieval, or out-of-scope context.
- Customer-facing reports and PDFs must not expose internal warnings, missing env-var names, beta parser caveats, local file paths, or implementation details.
- Internal dashboard warnings are acceptable when they help Backblaze users understand pricing freshness, parser confidence, or source-bill assumptions.
- Use sentence-case copy by default and keep AE-facing labels direct.
- Reports should use `companyName || prospectName` for customer-facing headings, "Prepared for" copy, and generated filenames.

## Upload, Dashboard, Report, PDF

- Upload flow stores the original bill, runs `detectAndParse()`, saves parsed output and metadata, and creates an initial model config from tier inventory defaults.
- Dashboard flow reads metadata, parsed bill, and model config, then computes tier inventory, tier selection, cost model, projections, transaction impact, access costs, deal sizing, and readiness.
- Customer report flow creates durable snapshots and renders the customer-facing report without internal-only warnings.
- PDF flow uses Playwright to open the report route with the user's session cookie and export a Letter PDF.
- `next.config.ts` includes `node_modules/playwright-core/browsers.json` in the `/api/analyses/*/pdf` standalone trace. Without that metadata, the VM can have Chromium installed and still fail PDF generation with a missing `playwright-core/browsers.json` module error.
- The report/PDF path should keep Backblaze branding visible, use compact print-safe layout, and avoid app-like chrome in customer-facing output.

## Bulk Rerun

- Shared helper: `src/lib/analysis/rerun.ts`.
- API route: `POST /api/analyses/rerun`.
- UI entrypoint: "Rerun All" on the opportunities page.
- Scope: all opportunities owned by the signed-in user.
- Behavior:
  - List the signed-in user's analyses.
  - Load stored parsed bill, stored model config, and latest original upload.
  - Reparse the latest original upload when present.
  - Fall back to stored parsed data when no upload exists.
  - Normalize model config and tier toggles.
  - Recompute cost model and save an `analysis-rerun` snapshot.
  - Return per-analysis statuses: `rerun`, `skipped`, or `failed`.
  - Return HTTP `207` when at least one analysis failed, otherwise `200`.

Do not duplicate cost-model assembly in individual routes. Use shared snapshot/rerun helpers when durable recomputation is needed.

## Pricing And Parser Notes

- Pricing tables live in `src/lib/pricing/*.json`; do not hardcode cloud rates in components, parsers, or model code when a pricing helper exists.
- `b2.json` is the source for B2 storage, egress, transaction, Reserve, UDM, and Overdrive assumptions.
- AWS and Azure pricing can be refreshed from public pricing APIs.
- GCP pricing can be refreshed from the Google Cloud Billing Catalog API when `GCP_CLOUD_BILLING_API_KEY` is configured.
- R2 and B2 pricing are static assumptions unless a stable public source is added.
- Internal pricing freshness warnings belong in the internal app, not customer reports.
- Parser/model changes should be validated with real bills when possible, but those bills must stay local under `bills/`.
- Known parser lessons:
  - AWS Standard storage is tiered; compare observed blended rates, not only the first tier rate.
  - Region fallback matters for AWS rows that omit region on the line item.
  - Very small charges should not create fake discount findings.
  - GCP API storage rates are GiB-month and must be normalized to the app's GB-month basis.
  - GCP location labels need normalized/lowercase matching so multi-region names do not fall back to regional pricing.
  - Provider commercial/list-price signals can belong in `ParsedBill.commercialSignals` instead of parser warnings so clean parses do not lose parser-confidence points.

## Transaction And Access Cost Notes

- Transaction analysis groups source line items by B2 transaction class and separates unsupported or non-applicable items into Other.
- AWS `PUT/COPY/POST/LIST` and provider Class A/write-style rows are treated as PUT/write-related source charges.
- AWS `GET/SELECT` and provider Class B/read-style rows are treated as GET/read-related source charges.
- B2 standard Class A/B/C transactions map to no-fee exposure in the model; avoid implying exact PUT-only or GET-only isolation when the source bill bundles operations.
- Cold-tier access costs should be surfaced for AWS S3 and GCS because they reveal how colder tiers become expensive when accessed.
- Use `src/lib/analysis/access-costs.ts` for cold-tier retrieval, restore, early deletion, lifecycle, and tiering access signals.
- Use `src/lib/analysis/action-costs.ts` so internal dashboard and customer report classify action costs consistently.

## UI And Report Conventions

- Internal app can use dark mode; generated customer reports should stay light-only.
- Theme controls belong in the user/profile menu.
- The app shell owns viewport height: `body` uses `min-h-dvh` and `main` uses `flex min-h-0 flex-1 flex-col`. Route pages under the global header should not use `min-h-screen`, because that adds the header height on top of the viewport and creates unnecessary scroll.
- Short route states such as login, empty opportunities, loading states, and new-opportunity creation should fill the remaining `main` area only when needed, using `flex-1` for vertical centering rather than adding hard viewport heights.
- The global header is hidden on `/login`; the login card owns its own Backblaze branding. The header "New" action belongs inside `UserMenu` and should render only after an authenticated user is known.
- The `/login` build footer should stay small, low-contrast, and outside the sign-in card so it can identify the deployed VM version without competing with the sign-in flow.
- Visible Backblaze branding matters on login, dashboard navigation, customer report, and PDF output.
- Use `public/backblaze-logo.png` for official horizontal logo on light surfaces.
- Use `public/backblaze-logo-white.png` on dark navigation/login surfaces.
- Use `public/backblaze-flame.png` and `public/backblaze-webclip.png` for favicon/app icon/small icon-only contexts.
- Internal dashboard provider/source detection should be trusted in the common path; keep manual override behind the subtle "Fix source" reveal.
- Customer Report CTA should use a clear document/report glyph, not an external-link/window glyph.
- Report/PDF header convention: white header band, Backblaze wordmark on the left, compact metadata on the right.
- Browser-only report actions should be compact and `no-print`.
- Customer report browser views use report-specific chrome; the global authenticated app header is hidden on `/login` and `/analyses/{id}/report`.
- Animated metric values are appropriate for internal dashboard/list summary surfaces, but keep customer reports and PDFs stable/static for capture reliability.
- Opportunity-list and new-opportunity copy should use "opportunity" language instead of exposing "analysis" language unless the context is explicitly technical.
- The opportunities page is AE-facing pipeline context: prioritize open opportunities, report readiness, modeled B2 potential TCV/revenue, and storage scope over aggregate customer-savings rollups.
- Opportunity metadata can carry `pipelineStatus` as `open`, `closed-won`, or `closed-lost`; missing status should be treated as `open` for older records. Closed deals should be filterable but not counted in open potential TCV.
- Print layout should be defensive: avoid negative header margins, use `min-w-0` for shrinking header/footer text, keep headings with their content, and preserve report-specific print classes for action-fee rows.

## Auth And Error Handling

- Magic links expire after 15 minutes.
- In development, localhost login requests bypass external email delivery: `/api/auth/send-link` returns a local verification URL and the login page follows it immediately. Production and other non-local hosts still use Resend magic-link email.
- Successful login sessions are long-lived unless the user logs out, the browser removes cookies, or `AUTH_SECRET` rotates.
- Production session cookies are secure; production-like auth testing over plain HTTP can fail to preserve cookies.
- Protected API routes hit by client fetches should return JSON 401s instead of throwing uncaught auth errors or HTML redirects.
- Storage-backed client-read routes should classify transient B2/S3 failures with safe JSON, not uncaught 500s.
- `/api/auth/profile` can degrade with profile-unavailable information rather than breaking the app when profile storage is temporarily unavailable.

## Validation Gates

- Run `git diff --check` before staging or committing.
- Run `npm run lint` before production pushes.
- Run `npm run build` before production pushes or when touching shared app logic.
- For app-shell or short-page layout changes, verify `/login`, empty `/`, and `/analyses/new` at desktop and mobile viewport sizes. Use a mocked/dev session if needed for protected routes, and confirm pages without extra content do not create vertical scroll.
- Run focused parser/model checks when touching parsers, pricing, cost model, egress, access costs, transactions, or projections.
- For report/PDF changes, verify the browser report and PDF route with realistic data when credentials and a running app are available.
- For bulk rerun changes, verify user scoping, skipped/failure aggregation, model config normalization, parsed-bill update behavior, and snapshot creation.
- For production-impacting changes, confirm the app still builds as a standalone Next.js server and that `.next/static`, `public`, and the Playwright `browsers.json` trace include are present in the standalone runtime artifact.

## Production Release Flow

1. Make changes on `main`.
2. Update `PROJECT_CONTEXT.local.md` with relevant current state, validation results, deployment notes, and handoff context. Keep it ignored/local-only.
3. Run `git diff --check`, `npm run lint`, and `npm run build`.
4. Commit only intended tracked files.
5. Push to `origin/main`.
6. The VM deploy timer should pick up the new commit within about one minute and restart `b2-savings-analyzer.service`.
7. Verify `https://savings.backblazedemos.xyz/login` from a network that can reach the internal VM.

If SSH or HTTP checks to the internal VM fail from Codex with network reachability errors, report that the environment could not reach the internal network rather than assuming production failed.

## Completed Recently

- Internal VM production deployment at `https://savings.backblazedemos.xyz`, backed by nginx, systemd, Let's Encrypt, Cloudflare DNS, and an automatic deploy timer following `origin/main`.
- Optional Postgres persistence foundation: migrations, DB adapter, backfill script, storage abstraction, upload metadata references, snapshots, and profiles.
- Branded magic-link email flow with verified Resend sender domain and hard production failure when `EMAIL_FROM` is missing.
- Durable report snapshots, optimized latest-snapshot reads, and signed-in-user-scoped "Rerun All" for parser/model changes.
- Customer report/PDF polish: Backblaze branding, company-aware headings/filenames, report-specific print layout, action-fee callouts, and no internal pricing-refresh warnings on customer-facing surfaces.
- Pricing/parser improvements for AWS and GCP, including AWS detailed billing PDF validation, GCP cost table validation, GCP GiB-to-GB pricing normalization, Cloud Billing refresh support, and cleaner commercial/list-price signal handling.
- App-wide dark mode for internal app surfaces while generated customer reports stay light-only.
- Repo hygiene cleanup: root-scoped ignore rules for local files, unused starter assets removed, redundant typings removed, and build/lint gates cleaned up.

## Current Open Gaps

- Transaction analysis for summary invoices: no per-SKU operations data, so either estimate operations from service totals or prompt the AE to request the detailed bill.
- PDF report regression testing: report/PDF exists, but future report changes should be checked with realistic analyses and exported PDFs before production pushes.
- Egress questionnaire model validation: verify compute-stays-in-hyperscaler and partner-CDN scenarios against real bill egress numbers.
- AI-assisted egress profile and AE/SE follow-up questions: current suggestions are deterministic; future work could synthesize sharper prompts from full bill context.
- Projection model validation: cross-check percentage growth and fixed TB/month growth against manual spreadsheet math.
- Manual line-item editing: parse review summarizes categories/warnings, but inline editing of parsed values still needs to be added or reintroduced.
- More real-bill coverage: AWS S3 cost export CSV, AWS summary invoice edge cases, Excel exports, more multi-region examples, and more discount/private-rate-card variants.
- Database-backed collaboration: team analytics, audit trail/version history, and shared opportunities remain unbuilt even though the Postgres foundation exists.
