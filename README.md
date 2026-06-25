# Backblaze B2 Savings Analyzer

Internal tool for Backblaze Solutions Engineering. Upload a customer's cloud storage bill, isolate addressable storage spend, and model the savings from migrating to Backblaze B2.

Produces an interactive internal dashboard for AE/SE analysis and a customer-facing report/PDF that frames savings in customer-ready language.

Production is hosted at `https://savings.backblazedemos.xyz` on the Backblaze-internal `deals` VM behind internal/VPN network access. See [Internal VM Deployment](docs/deployment/internal-vm.md) for the operational runbook.

![Dashboard Preview](public/dashboard-preview.png)

## What It Does

1. **Upload** — drag in an AWS or GCP bill (PDF, CSV, or Excel)
2. **Parse** — deterministic parsers extract storage tiers, egress, transactions, and discounts
3. **Model** — choose migration tiers, configure egress/data growth, test B2 price/term scenarios, and see real-time savings
4. **Report** — generate a branded customer report that explains what they save, what Backblaze covers, and the assumptions used

### Supported Bill Formats

| Provider | Format | Detail Level |
|----------|--------|-------------|
| AWS | Detailed billing PDF | Full per-SKU breakdown |
| AWS | S3 cost export CSV | Per-SKU with usage quantities |
| AWS | Summary invoice PDF | Service-level totals (estimated GB) |
| GCP | Cost table CSV | Full per-SKU breakdown |
| Any | Excel (.xlsx) | Auto-detected sheet → CSV |

### Key Features

- **Tier-grouped storage inventory** — Standard/hot storage is selected by default, cooler tiers are grouped and expandable, and each tier includes region/location detail plus help links
- **Transaction cost analysis** — groups source transaction line items by B2 transaction class, separates unsupported or non-applicable items into Other, and keeps source line-item detail expandable
- **Egress modeling** — decision tree for compute location, partner CDN, UDM, and bill-derived egress profile suggestions
- **Data growth modeling** — choose annual percentage growth or fixed TB/month growth for projections and deal sizing
- **Custom pricing detection** — flags EDP, Savings Plans, private rate cards, and list-price vs. discounted storage rates, ordered by price with clear region names
- **Centralized pricing data** — AWS/Azure/GCP/R2/B2 prices flow through JSON-backed lookup helpers
- **1/2/3/5-year cost projections** — modeled current-provider cost, Backblaze B2 cost, cumulative savings, data stored, and break-even timing
- **Deal sizing** (internal) — editable B2 price/TB, quick discount presets, ARR/TCV summaries at list/current/custom price, contract term slider, growth controls, and copy-ready Salesforce/Slack handoff text
- **Customer report generation** — customer-facing summary, storage tier comparison, UDM-covered migration egress cost, projection assumptions, and PDF export
- **Durable report snapshots and reruns** — report/PDF views store snapshots, and signed-in users can rerun all their opportunities after parser or model changes
- **Magic link auth** — scoped to `@backblaze.com` email domain with branded Resend email templates

## Prerequisites

- **Node.js** 20+
- **pdftotext** (from Poppler) — required for PDF parsing
  ```sh
  brew install poppler        # macOS
  apt install poppler-utils   # Linux
  ```
- A **Backblaze B2** bucket for persistence (S3-compatible API)
- Optional: a **PostgreSQL** database for structured persistence
- A **Resend** account for magic link emails (free tier works)

## Setup

```sh
git clone https://github.com/udarag/B2-Savings-Analyzer.git
cd B2-Savings-Analyzer
npm install
```

Create `.env.local`:

```env
# B2 Storage (S3-compatible)
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_KEY_ID=<your-key-id>
B2_APP_KEY=<your-app-key>
B2_BUCKET_NAME=<your-bucket>

# Auth
AUTH_SECRET=<random-32-char-string>
ALLOWED_EMAIL_DOMAIN=backblaze.com

# Email (Resend)
RESEND_API_KEY=<your-resend-key>
EMAIL_FROM="B2 Savings Analyzer <sign-in@your-verified-resend-domain>"

# App
NEXT_PUBLIC_BASE_URL=http://localhost:3000
APP_BASE_URL=http://localhost:3000

# Optional: enables API-backed GCP pricing refreshes
GCP_CLOUD_BILLING_API_KEY=<your-google-cloud-api-key>

# Optional: Postgres structured persistence
# Leave DATABASE_URL unset to use the original B2-only JSON persistence path.
# DATABASE_URL=postgres://user:password@host:5432/b2_savings_analyzer
# DATABASE_STORAGE_ENABLED=true
# DATABASE_SSL=false
# DATABASE_SSL_REJECT_UNAUTHORIZED=true
# DATABASE_SSL_CA_FILE=/path/to/ca-bundle.pem
# DATABASE_POOL_MAX=5
```

```sh
npm run dev
```

### Optional Postgres Persistence

By default, the app stores structured records as JSON objects in B2. When `DATABASE_URL` is set, the app uses Postgres for structured data and keeps uploaded bill files in B2 object storage.

Postgres stores:

- Analysis metadata
- Parsed bill JSON
- Model configuration
- Report snapshots
- User profiles
- Upload object metadata

B2 still stores:

- Original uploaded bills
- Any future binary exports or artifacts

Run migrations before enabling the app against a new database:

```sh
npm run db:migrate
```

Backfill existing B2 JSON records into Postgres for one or more users:

```sh
npm run db:backfill -- user@backblaze.com other@backblaze.com
```

If `DATABASE_URL` is unset, the app continues to use B2-only persistence.

## Current Production Deployment

The app is live at `https://savings.backblazedemos.xyz` on the Backblaze-internal `deals` VM. nginx terminates HTTPS for the hostname and proxies to the systemd-managed Next.js standalone server on `127.0.0.1:3001`.

Production currently uses B2-backed JSON/object persistence. The Postgres schema and adapter are in the repo, but production should stay B2-only until the team deliberately runs migrations, backfills existing B2 records, and enables `DATABASE_STORAGE_ENABLED=true`.

The production environment sets both base URL variables to the final hostname:

```env
APP_BASE_URL=https://savings.backblazedemos.xyz
NEXT_PUBLIC_BASE_URL=https://savings.backblazedemos.xyz
```

`APP_BASE_URL` is used by server-side flows such as magic-link generation, auth verification redirects, and PDF generation. `NEXT_PUBLIC_BASE_URL` remains available to client-side code. Keeping both set to the same hostname prevents internal bind addresses like `0.0.0.0:3000` from leaking into user-visible links.

Production magic-link email uses Resend with a verified sender domain. `EMAIL_FROM` is required in production.

### How We Push Code To Production

Normal production updates go through GitHub branch `main`; do not hot-edit app source on the VM.

1. Work on `main`.
2. Run `npm run lint`, `npm run build`, and `git diff --check`.
3. Commit only intended source/docs changes.
4. Push to `origin/main`.
5. The VM's `b2-savings-analyzer-deploy.timer` checks that branch about once per minute, builds a release, copies `.next/static` and `public` into the standalone runtime, flips the active `current` symlink, and restarts `b2-savings-analyzer.service`.
6. Verify `https://savings.backblazedemos.xyz/login` from a network that can reach the internal VM.

To force an immediate VM deploy check:

```sh
ssh udara@172.16.56.50
sudo systemctl start b2-savings-analyzer-deploy.service
sudo systemctl status b2-savings-analyzer-deploy.service --no-pager
```

Use direct VM changes only for environment, systemd, nginx, certificate, or emergency operational fixes. Document durable operational changes in [docs/deployment/internal-vm.md](docs/deployment/internal-vm.md).

## Shared Coding-Agent Context

Tracked agent context lives in [docs/agent-context.md](docs/agent-context.md). Coding agents should read it before non-trivial work because it captures the current architecture, production release flow, validation gates, and customer-facing product boundaries.

`PROJECT_CONTEXT.local.md` remains ignored by git and is for machine-specific or sensitive handoff notes that should not be shared in the repo.

## Tech Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Tailwind CSS v4** with custom Backblaze theme
- **Backblaze B2** object storage with optional **Postgres** structured persistence
- **pdftotext** for PDF text extraction
- **Recharts** for projection charts
- **Playwright** for PDF report generation
- **jose** for JWT-based magic link auth
- **Resend** for email delivery

## Project Structure

```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── analyses/[id]/      # Dashboard + report pages
│   ├── api/analyses/       # REST API (CRUD, upload, PDF generation)
│   └── login/              # Magic link auth flow
├── components/
│   ├── dashboard/          # TierInventory, CostBreakdown, TransactionAnalysis, etc.
│   ├── upload/             # FileUpload, ParseReview
│   └── shared/             # FormatCurrency, InlineEditText, UserMenu
├── lib/
│   ├── parsers/            # Bill parsers (AWS PDF/CSV, GCP CSV, detection)
│   ├── engine/             # Cost model, tier inventory, egress, projections
│   ├── pricing/            # Provider pricing JSON, lookup gateway, freshness checks, pricing detection
│   ├── db/                 # Optional Postgres connection helper
│   ├── storage/            # B2 object storage plus optional Postgres persistence adapters
│   ├── storage-tiers.ts    # Tier explanations and docs links
│   ├── regions.ts          # Provider region/location labels
│   └── auth/               # Magic link tokens + session management
└── types/                  # TypeScript interfaces
```

## Pricing Data

Provider pricing is kept in `src/lib/pricing/*.json` and accessed through `src/lib/pricing/lookup.ts`. Avoid hardcoding cloud rates in components, parsers, or model code.

- `b2.json` contains B2 storage, egress, transaction, Reserve, UDM, and Overdrive assumptions.
- `aws.json` contains multi-region S3 storage pricing refreshed from AWS Bulk Pricing APIs, including the dedicated S3 Glacier Deep Archive offer.
- `azure.json` contains multi-region Blob Storage pricing refreshed from the Azure Retail Prices API.
- `gcp.json` can be refreshed from the Google Cloud Billing Catalog API when `GCP_CLOUD_BILLING_API_KEY` is configured. Without that key, the script leaves GCP pricing unchanged and prints the manual verification links.
- `r2.json` and `b2.json` are static pricing assumptions because no stable public pricing API is configured for those sources.
- If a refresh is skipped or errors because an API key is missing, invalid, rate-limited, or otherwise unavailable, the internal analysis dashboard can show a warning that affected pricing may be stale or inaccurate. Customer-facing reports should stay free of internal credential and parser warnings.

Refresh supported pricing data with:

```sh
npm run refresh-pricing
```

You can also target one provider:

```sh
npm run refresh-pricing -- aws
npm run refresh-pricing -- azure
npm run refresh-pricing -- gcp
```

## Completed Recently

- Internal VM production deployment at `https://savings.backblazedemos.xyz`, backed by nginx, systemd, Let's Encrypt, Cloudflare DNS, and an automatic deploy timer that follows `origin/main`.
- Optional Postgres persistence foundation: migration script, DB adapter, backfill script, and storage abstraction. Production remains B2-only until migration is intentionally enabled.
- Branded magic-link email flow with a verified Resend sender domain and hard production failure when `EMAIL_FROM` is missing.
- Durable report snapshots, optimized latest-snapshot reads, and a signed-in-user-scoped "Rerun All" path for parser/model changes.
- Customer report and PDF polish: Backblaze branding, company-aware headings/filenames, report-specific print layout, action-fee callouts, and no internal pricing-refresh warnings on customer-facing surfaces.
- Pricing/parser improvements for AWS and GCP, including AWS detailed billing PDF validation, GCP cost table validation, GCP GiB-to-GB pricing normalization, Cloud Billing refresh support, and better commercial/list-price signal handling.
- App-wide dark mode for the internal app while keeping generated customer reports light-only.
- Repo hygiene cleanup: root-scoped ignore rules for local files, unused starter assets removed, redundant typings removed, and build/lint gates cleaned up.

## TODOs

### Unfinished Features

- [ ] **Transaction analysis for summary invoices** — Summary invoices (like Azira's) have no per-SKU operations data, so the Transaction Cost Analysis section doesn't appear. Need to either estimate operations from service totals or surface a note prompting the AE to request the detailed bill.
- [ ] **PDF report regression testing** — The Playwright-based PDF generation route and report layout exist, but future report changes should be checked with realistic analyses and exported PDFs before production pushes.
- [ ] **Egress questionnaire → model validation** — The egress decision tree UI is built, but the full flow (compute stays in hyperscaler → new costs appear, partner CDN → egress zeroes out) hasn't been validated against real egress numbers from a bill.
- [ ] **AI-assisted egress profile and AE/SE follow-up questions** — Current bill-derived egress guesses and follow-up questions are deterministic prompts based on parsed bill signals. A future improvement could use AI to synthesize sharper profile suggestions and questions from the full bill context, customer notes, detected services, egress profile, and likely B2 architecture fit.
- [ ] **Projection model validation** — Projection growth compounding and fixed TB/month growth exist but should be cross-checked against a manual spreadsheet calculation with real customer numbers.
- [ ] **Manual line-item editing** — Parse review currently summarizes parsed categories and warnings. Inline editing of parsed line-item values still needs to be added or reintroduced, then verified against downstream recalculation.

### Testing Against Real Bills

> **Note to the team:** We all should be pushing our AEs to gather bills from customers so we can use the data to make this tool better. Every new bill format we test against makes the parsers more robust and the savings models more accurate. Drop bills in your local `bills/` directory (gitignored — customer data stays local).

- [ ] **AWS S3 cost export CSV** — Test with a real export. Verify pivoted SKU columns (TimedStorage, Requests-Tier1, etc.) parse correctly and monthly breakdowns work.
- [ ] **AWS summary invoice edge cases** — Bills with fewer linked accounts, no discounts, $0 services, or different formatting/layout variations.
- [ ] **Excel (.xlsx)** — Test with a real Excel export to verify sheet detection and CSV conversion.
- [ ] **More multi-region and discount variants** — AWS detailed PDF and GCP cost table paths have initial real-bill validation, but the parser still needs more customer bills covering additional regions, EDP/Savings Plans/Private Rate Card shapes, and unusual account layouts.

### Database-backed Collaboration

The app can now use Postgres for structured persistence. That opens the door for:

- [ ] **Team analytics dashboard** — Aggregate savings across all AEs and prospects to surface trends like "average savings % by provider" or "top 10 opportunities by ARR." The Postgres foundation makes this practical, but the UI and aggregation queries still need to be built.
- [ ] **Audit trail and version history** — Track every change to an analysis (who toggled which tier, when pricing was adjusted, previous model configs) so AEs and managers can review the decision history. The current schema stores snapshots but does not yet record every edit event.
- [ ] **Collaboration and sharing** — Let multiple AEs or SEs work on the same opportunity with role-based access, comments, and notifications. The current data model is still user-scoped even when backed by Postgres.

## Adding Bills for Testing

Place test bills in a `bills/` directory (gitignored — customer data stays local):

```sh
mkdir bills
cp ~/path/to/test-bill.pdf bills/
```

---

Authored by Udara. Pair-programmed with a statistically significant amount of Claude.
