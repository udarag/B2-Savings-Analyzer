# B2 Savings Analyzer

Internal tool for Backblaze Solutions Engineering. Upload a customer's cloud storage bill, isolate addressable storage spend, and model the savings from migrating to Backblaze B2.

Produces an interactive dashboard for AE analysis and a customer-facing PDF report.

![Dashboard Preview](public/dashboard-preview.png)

## What It Does

1. **Upload** — drag in an AWS or GCP bill (PDF, CSV, or Excel)
2. **Parse** — deterministic parsers extract storage tiers, egress, transactions, and discounts
3. **Model** — toggle which tiers to migrate, configure egress, see real-time B2 cost comparison
4. **Report** — generate a branded PDF report to share with prospects

### Supported Bill Formats

| Provider | Format | Detail Level |
|----------|--------|-------------|
| AWS | Detailed billing PDF | Full per-SKU breakdown |
| AWS | S3 cost export CSV | Per-SKU with usage quantities |
| AWS | Summary invoice PDF | Service-level totals (estimated GB) |
| GCP | Cost table CSV | Full per-SKU breakdown |
| Any | Excel (.xlsx) | Auto-detected sheet → CSV |

### Key Features

- **Per-tier inventory** with migrate/keep toggles and per-account breakdowns
- **Transaction cost analysis** — shows every API fee type going to $0 on B2
- **Egress modeling** — decision tree for compute location, partner CDN, UDM
- **Custom pricing detection** — flags EDP, Savings Plans, private rate cards
- **3-year projections** with configurable growth rates
- **Deal sizing** (internal) — estimated B2 MRR/ARR and contract value
- **Magic link auth** — scoped to `@backblaze.com` email domain

## Prerequisites

- **Node.js** 20+
- **pdftotext** (from Poppler) — required for PDF parsing
  ```sh
  brew install poppler        # macOS
  apt install poppler-utils   # Linux
  ```
- A **Backblaze B2** bucket for persistence (S3-compatible API)
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

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

```sh
npm run dev
```

## Tech Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Tailwind CSS v4** with custom Backblaze theme
- **Backblaze B2** as sole persistence layer (no database)
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
│   └── shared/             # FormatCurrency, EditableCell
├── lib/
│   ├── parsers/            # Bill parsers (AWS PDF/CSV, GCP CSV, detection)
│   ├── engine/             # Cost model, tier inventory, egress, projections
│   ├── pricing/            # B2/AWS/GCP list prices + custom pricing detection
│   ├── storage/            # B2 S3-compatible persistence layer
│   └── auth/               # Magic link tokens + session management
└── types/                  # TypeScript interfaces
```

## TODOs

### Unfinished Features

- [ ] **Transaction analysis for summary invoices** — Summary invoices (like Azira's) have no per-SKU operations data, so the Transaction Cost Analysis section doesn't appear. Need to either estimate operations from service totals or surface a note prompting the AE to request the detailed bill.
- [ ] **PDF report — end-to-end testing** — The Playwright-based PDF generation route and 4-page report layout exist but haven't been verified with real data. Need to generate a PDF and confirm all pages render correctly.
- [ ] **Egress questionnaire → model validation** — The egress decision tree UI is built, but the full flow (compute stays in hyperscaler → new costs appear, partner CDN → egress zeroes out) hasn't been validated against real egress numbers from a bill.
- [ ] **Projection chart accuracy** — 3-year projection with growth compounding exists but hasn't been cross-checked against a manual spreadsheet calculation with real numbers.
- [ ] **Inline editing validation** — EditableCell component exists in ParseReview, but editing a parsed value and confirming the downstream model (tier inventory, savings, projections) recalculates correctly hasn't been tested.

### Testing Against Real Bills

> **Note to the team:** We all should be pushing our AEs to gather bills from customers so we can use the data to make this tool better. Every new bill format we test against makes the parsers more robust and the savings models more accurate. Drop bills in your local `bills/` directory (gitignored — customer data stays local).

- [ ] **AWS detailed billing PDF** — Verify per-SKU line items, storage class mapping (Standard, Standard-IA, Glacier, etc.), operations subcategories in Transaction Analysis, egress categorization, and grand total reconciliation.
- [ ] **GCP cost table CSV** — Verify Class A / Class B operations parse with storage class attribution, GiB → GB normalization, Nearline/Coldline/Archive tier inventory, and savings programs discount detection.
- [ ] **AWS S3 cost export CSV** — Test with a real export. Verify pivoted SKU columns (TimedStorage, Requests-Tier1, etc.) parse correctly and monthly breakdowns work.
- [ ] **AWS summary invoice edge cases** — Bills with fewer linked accounts, no discounts, $0 services, or different formatting/layout variations.
- [ ] **Excel (.xlsx)** — Test with a real Excel export to verify sheet detection and CSV conversion.
- [ ] **Multi-region bills** — Verify region-specific pricing (e.g., Singapore vs US East) produces separate tier inventory rows with correct effective rates.
- [ ] **Discount accuracy** — Verify named discounts (EDP, Savings Plans, Private Rate Card) are correctly extracted and pricing detection flags them accurately.

## Adding Bills for Testing

Place test bills in a `bills/` directory (gitignored — customer data stays local):

```sh
mkdir bills
cp ~/path/to/test-bill.pdf bills/
```

---

Authored by Udara. Pair-programmed with a statistically significant amount of Claude.
