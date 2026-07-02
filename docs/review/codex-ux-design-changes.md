# Codex UX Review And Implementation Directive

This file is independent of `docs/review/ux-design-changes.md`. Do not merge the two review documents unless the product owner asks for it.

## Scope

This review covers two real sales workflows:

- New-customer migration analysis from a detailed AWS April storage bill.
- Existing B2 customer commit-upgrade analysis from a B2 usage PDF export.

The test bills are sensitive customer artifacts and must stay local or in approved application storage. Do not commit the PDFs, extracted text, screenshots, or customer-specific raw values unless the user explicitly approves sanitized fixtures.

## Required Setup For Any Implementer

Before changing code:

1. Read `AGENTS.md`.
2. Read `docs/agent-context.md`.
3. Read `PROJECT_CONTEXT.local.md` if it exists.
4. If changing Next.js code, read the relevant installed Next.js 16 docs under `node_modules/next/dist/docs/`.
5. Keep customer reports/PDFs light-mode, branded, and free of internal parser, environment, and pricing-refresh warnings.
6. Prefer existing `--c-*` design tokens over raw hex values for the internal app. Customer report print styles may keep report-specific aliases when they are intentionally scoped.

## Evidence From Review

The local real-bill walkthrough found these states:

- The migration bill parsed successfully with 737 line items, `0.85` confidence, no parser warnings, and a storage-scope savings story that was generally persuasive.
- The commit-up usage PDF prefilled current storage and current monthly spend, but parsed an annual growth assumption that was not shown for confirmation before saving.
- The commit-up report and PDF rendered, but did not persist a report snapshot, so the opportunities list still showed "No report yet" and excluded that opportunity from report-ready and TCV summaries.
- The direct commit-up PDF route used the migration filename logic and produced an AWS-style filename for a B2 commitment report.
- The internal app uses many raw brand hex classes in routes and components that otherwise use the tokenized `--c-*` theme.
- `/analyses/new` had horizontal overflow at a 390px mobile viewport.
- The first-login profile prompt can cover primary workflow actions on dashboards and reports.

## Priorities

- `P0`: Blocks correct sales workflow state, auditability, or customer artifact framing.
- `P1`: Creates AE friction or risk of an incorrect customer-facing story.
- `P2`: Visual/design consistency and responsive polish.

## P0-1: Persist Commit-Up Report Snapshots And List State

**Files likely involved**

- `src/components/report/CommitUpsellReport.tsx`
- `src/app/api/analyses/[id]/snapshot/route.ts`
- `src/app/api/analyses/[id]/pdf/route.ts`
- `src/app/api/analyses/route.ts`
- `src/lib/analysis/commit-upsell-model.ts`
- `src/types/model.ts`
- `src/types/analysis.ts`

**Current behavior**

Commit-up reports render, and the PDF endpoint returns a PDF, but the analysis has no `latestSnapshot`. The opportunities list therefore says "Usage entered" / "No report yet" after a report view and after PDF export. Portfolio totals also ignore the commit-up opportunity.

Migration reports are snapshotted through `buildAnalysisSnapshot()`, but the snapshot route currently returns `404` when a parsed source bill does not exist. Commit-up analyses are based on `B2UsageInput`, so they need their own snapshot path.

**Desired behavior**

Commit-up report views and PDF downloads should create durable snapshots with the same audit intent as migration reports.

The opportunities list should treat a commit-up opportunity with a saved report snapshot as report-ready. Its potential TCV and storage modeled should include commit-up values using the agreed contract term.

**NEEDS-DECISION**

Choose the default commit-up term for list TCV and report snapshot math:

- Option A: 12 months by default.
- Option B: add an explicit commitment term field before snapshotting TCV.

Do not infer multi-year TCV from the report copy unless a term exists in saved model state.

**Acceptance criteria**

- Viewing a commit-up customer report creates a snapshot with trigger `report-view`.
- Downloading a commit-up PDF creates a snapshot with trigger `pdf-download`.
- The opportunities list shows the commit-up opportunity as report-ready after either action.
- Portfolio "Reports ready" includes the commit-up report.
- Portfolio TCV/storage totals include commit-up values using the selected term rule.
- Migration report snapshot behavior remains unchanged.

## P0-2: Preserve Usage Export Provenance And Confirm Parsed Growth

**Files likely involved**

- `src/components/upload/B2UsageForm.tsx`
- `src/components/upload/B2UsageExportUpload.tsx`
- `src/app/api/analyses/[id]/usage-export/route.ts`
- `src/app/api/analyses/[id]/b2-usage/route.ts`
- `src/components/report/CommitUpsellReport.tsx`
- `src/types/analysis.ts`

**Current behavior**

The B2 usage upload route parses the PDF and returns values to the client. The form shows current storage and current monthly spend, but carries parsed growth through hidden state. Saving the form posts no source/provenance, and the API hardcodes `source: 'manual'`.

In the reviewed real usage PDF, the parsed growth assumption was `300%` annual growth. That assumption only became visible later in the dashboard and customer report.

**Desired behavior**

The AE must see and confirm all imported assumptions before saving. Source provenance should survive from upload to saved usage to report copy.

**Implementation guidance**

- Add source/provenance to the parsed upload result, for example `source: 'usage-pdf'` or `source: 'usage-screenshot'`.
- Store source on `B2UsageInput` from the POST body. Default to `manual` only when the user typed values without a successful import.
- Show parsed growth in `B2UsageForm` before save.
- If parsed annual growth is unusually high, show an internal warning before save.

**Suggested copy**

Upload success:

```text
Read the usage PDF and filled in storage, spend, and growth. Review all three before saving.
```

Growth field label:

```text
Parsed annual growth
```

Growth helper:

```text
From the usage export trend. Validate before sharing a customer report.
```

High-growth warning:

```text
This import implies {growth}% annual growth. Confirm this is representative before generating a customer report.
```

Report assumptions, PDF source:

```text
Based on {storageTb} TB at {ratePerTb}/TB from the B2 usage PDF, with {growthLabel} pending account-team confirmation.
```

Report assumptions, manual source:

```text
Based on {storageTb} TB at {ratePerTb}/TB entered by your account team, with {growthLabel} pending account-team confirmation.
```

**Acceptance criteria**

- After uploading a usage PDF, storage, spend, and growth are visible before save.
- Saving a PDF-derived usage record stores non-manual provenance.
- Commit-up report copy no longer says PDF-derived values were "entered by your account team".
- A `300%` annual growth import is visibly flagged before the AE can proceed.
- Manual entry still works without requiring a file.

## P0-3: Fix Commit-Up PDF Filename And Route Framing

**Files likely involved**

- `src/app/api/analyses/[id]/pdf/route.ts`
- `src/lib/report-filename.ts`
- `src/components/report/CommitUpsellReport.tsx`
- `src/components/dashboard/CommitUpsellDashboard.tsx`

**Current behavior**

The commit-up report page's client-side download code names the file as a commitment upgrade, but the direct `/api/analyses/{id}/pdf` route uses the migration report filename builder. From the dashboard PDF link, the filename can include `AWS` even though the opportunity is an existing B2 customer commitment report.

**Desired behavior**

The PDF route should branch by `analysis.opportunityType` and use commitment-report naming for commit-up analyses.

**Suggested filename pattern**

```text
{companyName}-B2-Commitment-Upgrade-{YYYY-MM-DD}.pdf
```

**Acceptance criteria**

- Dashboard PDF links and report-page PDF buttons produce the same filename family for commit-up analyses.
- Commit-up filenames never include `AWS`, `Azure`, `GCS`, or migration billing-period labels.
- Migration report filenames remain unchanged.

## P1-1: Make The First-Login Profile Prompt Non-Blocking

**Files likely involved**

- `src/components/shared/UserMenu.tsx`
- `src/components/shared/AppHeader.tsx`

**Current behavior**

On first login, the profile setup prompt appears as an absolute panel anchored to the user menu. It can cover top-right dashboard/report actions such as Customer report, PDF, rerun, and primary metrics.

**Desired behavior**

The app should still collect AE name/title for customer reports, but it should not block first-run analysis work.

**Implementation options**

- Convert it to a dismissible, full-width internal banner below the global header.
- Or keep it in the account menu and only prompt when the AE tries to export/share a report.

**Acceptance criteria**

- On desktop and at 390px mobile width, the setup prompt does not cover primary actions.
- The prompt remains dismissible.
- Customer report/PDF generation still has a clear path to collect AE name/title before sharing.
- Styling uses the internal token system and supports dark mode.

## P1-2: Label Standard Vs Overdrive Variants Everywhere They Can Be Confused

**Files likely involved**

- `src/app/analyses/new/page.tsx`
- `src/app/page.tsx`
- `src/app/analyses/[id]/page.tsx`
- `src/app/analyses/[id]/report/page.tsx`
- `src/lib/storage/storage.ts`
- `src/types/analysis.ts`

**Current behavior**

The migration upload flow can create linked Standard and Overdrive opportunities with identical customer names. Variant state is present in saved metadata, but the list and dashboard top-level surfaces do not make the variant obvious enough before an AE opens or sends a report.

**Desired behavior**

Every linked-pair surface should label the service tier variant near the title and primary actions.

**Suggested labels**

```text
Standard variant
Overdrive variant
```

**Acceptance criteria**

- The opportunities list shows a visible service-tier badge for linked variants.
- The dashboard title area shows whether the current opportunity is Standard or Overdrive.
- The customer report header/summary includes the service tier being modeled.
- Any CTA that opens the sibling opportunity says which variant it opens.
- A pair of linked opportunities with the same company name cannot be mistaken for duplicate records.

## P1-3: Make Universal Data Migration Eligibility Hard To Miss Internally

**Files likely involved**

- `src/types/analysis.ts`
- `src/components/dashboard/DealSizing.tsx`
- `src/app/analyses/[id]/page.tsx`
- `src/app/analyses/[id]/report/page.tsx`

**Current behavior**

The reviewed migration report showed a large migration cost in the customer-facing economics. That is transparent, but if Universal Data Migration can cover the move, the AE needs an obvious internal prompt before sending a less persuasive report.

**NEEDS-DECISION**

Decide whether UDM should be:

- Off by default with a stronger internal eligibility prompt.
- On by default only when eligibility can be inferred safely.
- A required AE confirmation before report/PDF export when migration cost is material.

**Suggested internal copy**

```text
Backblaze may be able to cover this migration through Universal Data Migration. Confirm eligibility before sharing a report with migration cost included.
```

**Acceptance criteria**

- Customer reports do not claim UDM unless the AE enables or confirms it.
- Internal dashboards make material migration cost/UDM eligibility obvious before report export.
- The PDF/report continues to show migration cost transparently when UDM is off.

## P1-4: Strengthen The Commit-Up Customer Report Story

**Files likely involved**

- `src/components/report/CommitUpsellReport.tsx`
- `src/lib/analysis/commit-upsell-model.ts`
- `src/types/analysis.ts`

**Current behavior**

The commit-up report leads with throughput and request-rate multipliers, but it does not clearly explain the business ask: what commitment changes, what term/minimum applies, and why the customer should sign when current monthly spend is roughly unchanged.

It also hardcodes `June 2026` in the header and assumptions. That will become stale and was already wrong during July testing.

**Desired behavior**

The report should tie the commitment to growth headroom, operational risk reduction, and the agreed commercial term. Dates should be derived from saved usage/report metadata, not hardcoded copy.

**NEEDS-DECISION**

Add explicit saved fields for:

- Commitment term.
- Minimum monthly commitment or committed storage baseline.
- Pricing effective date or usage export period.

**Suggested copy replacement**

Current:

```text
Signing a contract moves {companyName} to the Committed tier - the same {rate}/TB, with the throughput ceiling lifted.
```

Replace with:

```text
Moving to B2 Committed keeps storage at {rate}/TB and raises the operating ceiling from 4/4 Gbit/s to 50/50 Gbit/s, so growth has headroom without changing the storage platform.
```

Add a section:

```text
What changes with a commitment
```

Include rows for:

- Storage rate.
- Commitment term.
- Minimum commitment.
- GET/PUT throughput ceiling.
- Request-rate ceiling.
- Growth assumption.

Add a section:

```text
What to validate before signature
```

Include rows for:

- Whether the parsed growth trend is representative.
- Whether peak throughput or request rates are approaching current caps.
- Whether the commitment baseline matches forecasted storage.

**Acceptance criteria**

- No hardcoded month/year remains in the commit-up report.
- The report names the commitment term and minimum once those fields exist.
- If term/minimum are not known yet, the report uses internal-only missing-info states and does not generate confident customer copy.
- The customer-facing report explains why the same storage rate is still worth committing to.

## P1-5: Round Customer-Facing Headline Numbers To Avoid False Precision

**Files likely involved**

- `src/app/analyses/[id]/report/page.tsx`
- `src/components/report/CommitUpsellReport.tsx`
- `src/components/shared/FormatCurrency.tsx`
- `src/lib/analysis/commit-upsell-model.ts`

**Current behavior**

The migration report can show headline values such as projected savings, annual savings, monthly savings, and migration cost with cents. That level of precision looks less credible in an executive report.

**Desired behavior**

Round headline and summary currency values to whole dollars. Keep cents only where they clarify rates or unit economics.

**Acceptance criteria**

- Hero savings, monthly savings, annual savings, migration cost, and TCV-style values render as whole dollars.
- Per-TB rates and per-unit fees keep their appropriate decimal precision.
- PDF and browser report formatting match.

## P2-1: Tokenize Internal App Colors

**Files likely involved**

- `src/app/globals.css`
- `src/app/page.tsx`
- `src/app/analyses/new/page.tsx`
- `src/components/shared/UserMenu.tsx`
- `src/components/upload/B2UsageForm.tsx`
- `src/components/upload/ParseReview.tsx`
- `src/components/dashboard/CommitUpsellDashboard.tsx`
- `src/components/dashboard/DealSizing.tsx`
- `src/components/dashboard/EgressQuestionnaire.tsx`
- `src/components/dashboard/ProjectionChart.tsx`
- `src/components/dashboard/TierInventory.tsx`

**Current behavior**

The internal app mixes tokenized classes with raw hex classes such as `#e20626`, `#b40a23`, `#3430ff`, `#f9733a`, `#11113a`, and chart-specific hex values.

**Desired behavior**

Use the `--c-*` token system for internal app surfaces, controls, focus states, and chart colors. Keep report-specific print palettes scoped to report styles when they are intentional.

**Implementation guidance**

- Add missing semantic tokens if the current set is insufficient, for example active amber, chart provider navy, chart savings green, and focus accent.
- Prefer reusable class patterns for primary red buttons, segmented controls, checkbox accents, and focus rings.
- For Recharts, centralize chart colors in one helper or constant set. If dark-mode chart colors need to react to theme, read CSS variables rather than hardcoding light-mode hex values.

**Acceptance criteria**

- A targeted search for common brand hexes in internal app routes/components returns only allowed token definitions, report-scoped styles, comments, or intentionally centralized chart constants.
- Primary buttons, checkboxes, segmented controls, and focus rings still look consistent in light and dark mode.
- Customer reports/PDFs are visually unchanged except where a report-specific change is explicitly part of this directive.

## P2-2: Fix Mobile Overflow On New Opportunity

**Files likely involved**

- `src/app/analyses/new/page.tsx`
- `src/components/shared/AppHeader.tsx`
- `src/components/shared/UserMenu.tsx`

**Current behavior**

At a 390px mobile viewport, `/analyses/new` had horizontal overflow. The page rendered wider than the viewport.

**Desired behavior**

The new-opportunity flow should fit within the viewport at common mobile widths without horizontal scrolling.

**Acceptance criteria**

- At 390x844, `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- Repeat that check with the profile prompt open and closed.
- Buttons, upload cards, and option cards do not clip or overlap text.
- The mobile report page remains overflow-free.

## P2-3: Keep Report Light Mode Forced, But Make The Boundary Explicit

**Files likely involved**

- `src/app/analyses/[id]/report/page.tsx`
- `src/components/report/CommitUpsellReport.tsx`
- `src/app/globals.css`

**Current behavior**

Internal dark mode works, and customer reports render light. That is the right direction, but future token work could accidentally let dark-mode app tokens leak into customer reports.

**Desired behavior**

Keep customer reports and generated PDFs light-only by design. Make that boundary explicit in comments or local CSS naming so future tokenization does not break print output.

**Acceptance criteria**

- Switching the app to dark mode does not darken either report type.
- Generated PDFs use the same light report palette as browser reports.
- Report CSS has a clear boundary from internal app theme tokens.

## Verification Checklist

Use approved real bills for local manual testing when available. Do not commit those files or derived raw customer data.

Minimum checks after implementation:

1. `git diff --check`
2. `npm run lint`
3. `npm run build`
4. New-customer migration flow with linked Standard and Overdrive variants.
5. Existing-customer commit-up flow from a B2 usage PDF.
6. Browser report and PDF route for migration.
7. Browser report and PDF route for commit-up.
8. Opportunities list after viewing/downloading both report types.
9. Light and dark internal dashboard checks.
10. 390px mobile checks for `/analyses/new` and both report pages.

## Implementation Order

1. `P0-2` usage provenance/growth confirmation.
2. `P0-1` commit-up snapshot/list state.
3. `P0-3` commit-up PDF filename.
4. `P1-4` commit-up report story and stale dates.
5. `P1-1` profile prompt.
6. `P1-2` linked variant labeling.
7. `P1-3` UDM internal prompt.
8. `P1-5` report rounding.
9. `P2-2` mobile overflow.
10. `P2-1` tokenized colors.
11. `P2-3` explicit report light-mode boundary.
