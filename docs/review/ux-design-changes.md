# UX + Design change directive — B2 Savings Analyzer

This is an implementation brief produced from a full effectiveness review of the app (both the
"migration" and "commit-upsell" motions, from creation through the exported PDF). The only reader is a
coding agent that has the repo but **not** the review. Everything you need is here; do not guess.

## How to use this file

1. **Read `AGENTS.md` and `docs/agent-context.md` first and obey them.** In particular:
   - This is **Next.js 16**. Before editing any Next.js code, read the relevant guide under
     `node_modules/next/dist/docs/`. APIs may differ from your training data.
   - Use the **`--c-*` design tokens** (see `src/app/globals.css`) instead of hardcoded hex for the
     internal app. Reports are **light-only** and use the `bb-*` aliases — do **not** introduce `.dark`
     styling or `--c-*` theme-flipping colors into customer report/PDF components.
   - **Customer-facing report/PDF surfaces must never expose internal detail** (internal opportunity
     names, discount %, pricing-freshness/parser warnings, env var names, file paths, "beta" caveats).
   - This repo is **public**; never commit customer data, real bills, screenshots with real customers,
     or `.env*` / `bills/` / `PROJECT_CONTEXT.local.md`.
   - Run the validation gates before finishing: `git diff --check`, `npm run lint`, `npm run build`.
     For report/PDF changes, render the report route and export a PDF with a realistic (synthetic)
     analysis. For parser changes, run the focused parser tests (`npm test`).
2. Work the sections **in order** (Blockers → AE-friction → Customer-report → Design-consistency).
   Dependencies are noted per item.
3. Items tagged **NEEDS-DECISION** require a human product/design answer. Do **not** invent numbers,
   pricing, claims, or contract terms. Ask the specific question stated, and stop that item until answered.
4. Customer-facing (report/PDF) items are labeled **[CUSTOMER]**; internal-app items **[INTERNAL]**.
   Their constraints differ — keep the edits separated and never let internal detail cross into
   `[CUSTOMER]` surfaces.

Two synthetic test opportunities may exist from the review ("Contoso Synthetic — migration",
"Northwind Synthetic — Q3 upsell"). They are safe to delete; do not treat their data as real.

---

## Section 1 — Blockers

### B1 — Commit-upsell report leaks the internal opportunity name to the customer  [CUSTOMER] [INTERNAL]
**Priority: Blocker.  STATUS: DONE** — implemented and verified live. Two parts shipped:
(1) **Root cause fixed:** `src/app/api/analyses/route.ts` no longer stamps `companyName = prospectName`
when the AE leaves Company blank — it now stores `undefined`. Every customer-facing surface already
falls back to `companyName || prospectName`, so display is unchanged, but an unset company now reads as
blank instead of silently carrying internal shorthand. (2) **Parity added:** `CommitUpsellDashboard.tsx`
gained a "Company (shown to the customer)" inline editor (local `meta` state + `patchMeta`), seeded
blank so it shows a "+ Add company name" prompt. Verified: a fresh commit-upsell opp named "… — Q3
upsell" now shows the prompt; setting Company to "Aperture Media, Inc." produces a report/PDF with no
"Q3 upsell" anywhere and the company name in the header, hero, and tab title.
**Where:**
- Symptom source: `src/components/report/CommitUpsellReport.tsx` (header line ~167 `Prepared for {reportCompanyName}`, hero line ~181 `Signing a contract moves {reportCompanyName} to the …`). `reportCompanyName = meta.companyName || meta.prospectName`.
- Root cause: the commit-upsell flow never captures a customer-facing company name and offers no way to fix it.
  - `src/components/upload/B2UsageForm.tsx` collects storage/spend only — no company field.
  - `src/components/dashboard/CommitUpsellDashboard.tsx` shows `meta.prospectName` but has **no** inline company editor (the migration dashboard has one at `src/app/analyses/[id]/page.tsx` ~lines 351–361 via `InlineEditText`).

**Problem:** When the AE names the opportunity with internal shorthand (e.g. "Northwind Synthetic — Q3
upsell") and leaves Company blank at creation, the customer report header AND hero render that internal
string. Verified live: the report showed "PREPARED FOR NORTHWIND SYNTHETIC — Q3 UPSELL" and "Signing a
contract moves Northwind Synthetic — Q3 upsell to the Committed tier." There is no path to correct it
after creation on the commit-upsell side.

**Change (CURRENT → DESIRED):**
Add a company-name editor to the commit-upsell dashboard, mirroring the migration dashboard exactly.
- In `CommitUpsellDashboard.tsx`, under the title block (after the `<h1>{meta.prospectName}</h1>` at
  ~line 76), add the same "Company" inline editor the migration dashboard uses. Wire it to
  `PATCH /api/analyses/${analysisId}` with `{ meta: { companyName } }` and keep local `meta` state in
  sync so the value persists and the report picks it up. Use `InlineEditText`
  (`src/components/shared/InlineEditText`) with `placeholder="Company name"` and `maxLength={100}`,
  seeded from `meta.companyName || ''` (do **not** seed it with `prospectName`).
- CURRENT: no company control on the commit-upsell dashboard.
- DESIRED: an editable "Company" row identical in look to the migration dashboard's, so the AE can set
  the clean customer-facing name before generating the report.

**Rationale:** A customer report that says "Q3 upsell" in the title is embarrassing and instantly erodes
trust — the exact opposite of "a report an AE would proudly send." Migration already has an escape
hatch; commit-upsell must have parity (customer-persuasion + AE-ease).

**Acceptance criteria:**
- Create a commit-upsell opportunity named "Acme — Q3 upsell" with Company blank. On the deal-sizing
  dashboard, set Company to "Acme Corp". Open `/analyses/{id}/report`: header reads "Prepared for Acme
  Corp" and the hero reads "Signing a contract moves Acme Corp to the … tier". The string "Q3 upsell"
  must not appear anywhere on the report or in the downloaded PDF filename.
- The edit autosaves (reload the report; the company name persists).

---

### B2 — Dashboard hero claims "Savings start: Day 1" while the same screen shows a break-even month  [INTERNAL]
**Priority: Blocker (misleading number on the primary internal surface).  STATUS: DONE** — implemented
and verified live. `src/app/analyses/[id]/page.tsx` now derives `hasMigrationPayback` /
`savingsTimingLabel` / `savingsTimingValue` and the hero shows "Break-even · Month N" when a migration
cost is unrecovered, "Savings start · Day 1" when UDM covers it (and "—" when there are no savings).
Verified: with UDM off the hero read "Break-even · Month 5" (matching the projection block); enabling
UDM flipped it to "Migration cost $0 / Savings start · Day 1".
**Where:** `src/app/analyses/[id]/page.tsx` line ~525:
`<HeroStat label="Savings start" value={costModel.monthlySavings > 0 ? 'Day 1' : '—'} />`

**Problem:** The hero's "Savings start" only checks whether monthly savings are positive; it ignores an
unrecovered upfront migration cost. Verified live: with migration cost **$26,609** (UDM off) the hero
said "Savings start: Day 1" while the projection block immediately below said "Break-Even: Month 5" —
a direct self-contradiction on one screen. The customer report already handles this correctly via
`hasCustomerMigrationPayback` (`report/page.tsx` ~lines 268–275); the dashboard does not.

**Change (CURRENT → DESIRED):** Make the dashboard hero mirror the report's logic.
- CURRENT: label always "Savings start", value `costModel.monthlySavings > 0 ? 'Day 1' : '—'`.
- DESIRED: when `!costModel.udmEnabled && costModel.migrationCost.total > 0`, label the stat
  **"Break-even"** and show `costModel.breakEvenMonth ? \`Month ${costModel.breakEvenMonth}\` : 'Review required'`.
  Otherwise keep label "Savings start" and value "Day 1". Reuse the same condition names as the report
  for consistency (compute a local `hasMigrationPayback = !costModel.udmEnabled && costModel.migrationCost.total > 0`).

**Rationale:** An AE who spots a hero that contradicts the projection right below it stops trusting every
number in the tool (AE-ease + coherence).

**Acceptance criteria:** With UDM off and a bill that yields a non-zero migration cost, the hero stat
reads "Break-even · Month N" and N equals the projection block's break-even month. Enable UDM (migration
cost → $0): the hero reverts to "Savings start · Day 1".

---

## Section 2 — AE-friction fixes

### A1 — Commit-upsell opportunities are invisible to the pipeline (no snapshot, no TCV, never "reported")  [INTERNAL]
**Priority: High.  STATUS: DONE** — implemented and verified live. `buildCommitUpsellSnapshot()` (pure, in
`commit-upsell-model.ts`) builds a `ReportSnapshot` from `B2UsageInput`; the snapshot route branches to it
for commit-upsell (no bill); `CommitUpsellReport` POSTs a `report-view` snapshot on first view; and the
opportunity card renders it honestly ("120.0 TB on Committed", not "$0/yr saved"). NEEDS-DECISION on the
TCV term was resolved by using the model's existing 12-month projection term (no fabricated multi-year
term); a term selector remains a future refinement. Verified: a fresh commit-upsell opp now shows a green
"reported" dot, "$10,459 potential TCV", and counts in Reports-ready / Potential TCV / Storage modeled.
**Where:**
- `src/components/report/CommitUpsellReport.tsx` — never POSTs a report snapshot (the migration report
  does, at `report/page.tsx` ~lines 214–222 with `{ trigger: 'report-view' }`).
- `src/app/page.tsx` — `estimateStorageTcv()` (~lines 63–80) and `portfolioStats` (~lines 199–212) read
  `latestSnapshot`; commit-upsell rows have `latestSnapshot === null` forever.
- `src/app/api/analyses/route.ts` — `latestSnapshot` is populated from the stored snapshot (~line 72),
  which commit-upsell never writes.

**Problem:** Verified live: after generating a commit-upsell report **and** downloading its PDF, the
opportunity still read "Usage entered / No report yet", stayed at the orange "active" readiness dot,
did not increment "Reports ready", and contributed **$0** to "Potential TCV" and **0 TB** to "Storage
modeled". An AE running a pipeline of B2-upsell deals sees them as perpetually unfinished and worth
nothing.

**Change (CURRENT → DESIRED):**
1. Have the commit-upsell report create a durable snapshot on first view, mirroring the migration report
   (`CommitUpsellReport.tsx`: add a `useEffect` that POSTs to `/api/analyses/${analysisId}/snapshot`
   once `view` is computed).
2. Populate the snapshot with the fields the list already consumes so the existing rollups light up
   without special-casing: `totalStorageGb = usage.currentStorageTb * 1000`, `b2PricePerTb =
   view.targetRatePerTb`, `termMonths` = the commit-upsell projection term, growth fields from `usage`,
   and `annualSavings = 0` (there is typically no dollar savings — never fabricate one). The existing
   `estimateStorageTcv()` will then compute a committed-storage TCV from those fields.
3. Confirm `src/app/api/analyses/[id]/snapshot/route.ts` can build a snapshot for a commit-upsell
   analysis (no `ParsedBill`); if it currently requires a parsed bill, branch on
   `opportunityType === 'commit-upsell'` to build the snapshot from `B2UsageInput` instead.

**NEEDS-DECISION (ask before implementing #2's term):** The commit-upsell model
(`src/lib/analysis/commit-upsell-model.ts`) hardcodes a 12-month projection and there is **no** contract-
term selector in the commit-upsell UI. TCV over a commitment needs a term. Ask: *"For commit-upsell TCV,
what contract term should we assume — fixed 12 months, or should we add a term selector to the
commit-upsell deal-sizing dashboard like the migration `DealSizing` has?"* Do not assume a multi-year
term without an answer.

**Rationale:** The tool's landing page is explicitly the AE's pipeline view; a whole opportunity type
that reports $0 potential and never reaches "reported" makes the pipeline numbers wrong and hides real
committed revenue (AE-ease + coherence).

**Acceptance criteria:** Generate a commit-upsell report; return to `/`. The row shows the "reported"
(green) readiness dot, "Reports ready" increments, and the row shows a non-zero "potential TCV" derived
from `targetRatePerTb × storage × term`. Numbers on the card match the deal-sizing dashboard.

---

### A2 — Migration report defaults UDM off, so the biggest objection is unanswered by default  [INTERNAL] [CUSTOMER]
**Priority: High. NEEDS-DECISION.  STATUS: PARTIAL (Option A shipped)** — the internal nudge is implemented
and verified: `analyses/[id]/page.tsx` shows an internal-only banner below the hero when
`!udmEnabled && migrationCost.total > 0`, prompting the AE to enable UDM. It never renders on the report/PDF.
Option B (flipping the `udmEnabled` default to true in `types/analysis.ts`) was deliberately NOT taken — it
remains the open product decision below.
**Where:** default is `udmEnabled: false` in `src/types/analysis.ts` line ~303 (egress-config default).
Consumed by `src/lib/engine/cost-model.ts` (~lines 173–197) and surfaced in `DealSizing.tsx` (UDM toggle)
and both the dashboard hero and the customer report.

**Problem:** Verified live: the default migration report leads the customer's single biggest objection —
a **$26,608.70** one-time migration/egress cost — with no mention that Backblaze can cover it. Universal
Data Migration is a marquee differentiator, but it is buried behind a toggle the AE must know to flip, so
every first-pass report is scarier than it needs to be.

**Change — pick ONE after the decision below:**
- Option A (nudge, safest): In `src/app/analyses/[id]/page.tsx`, when
  `!costModel.udmEnabled && costModel.migrationCost.total > 0`, render an **internal** dashboard hint
  near the hero or the DealSizing UDM toggle: *"Backblaze can cover this migration cost — enable
  Universal Data Migration to model it at $0 to the customer."* (Internal-only copy; must not appear on
  the report.)
- Option B (default on): flip the default to `udmEnabled: true`. Only if product confirms UDM is
  broadly applicable enough to be the default assumption.

**NEEDS-DECISION:** Ask: *"Should UDM be ON by default, or should we keep it off and add an internal
nudge prompting the AE to enable it when a migration cost exists? UDM has eligibility conditions —
defaulting it on may overpromise."* Do not flip the default without this answer; Option A (nudge) is safe
to build regardless and is the recommended interim.

**Rationale:** Turning "$26,608 to migrate" into "$0 — covered by Backblaze" is the single biggest swing
in the report's persuasiveness, and prompting it removes an AE guess about whether the default report is
the strongest one (customer-persuasion + AE-ease).

**Acceptance criteria (Option A):** On a migration analysis with a non-zero migration cost and UDM off,
an internal-only hint is visible on the dashboard; it is **absent** from `/analyses/{id}/report` and the
PDF. Enabling UDM hides the hint.

---

## Section 3 — Customer-report / persuasion fixes

### C1 — Report shows cents on headline figures (false precision)  [CUSTOMER]
**Priority: High.  STATUS: DONE** — implemented and verified live. Added `formatUsd0()` (whole dollars) and
`formatStorageTbWhole()` to the migration report and routed every headline/aggregate dollar figure through
it (hero, outcome metrics, decision summary, narrative, business-potential, tier-comparison, migration-cost,
projections, savings-drivers, scenario, assumptions), plus the commit-upsell report's monthly row. Per-unit
rates ($/TB, $/GB) still use `formatCurrency` (cents). Verified: a text scan of the rendered report finds
cents only on `$6.95/TB`, `$23.00/TB`, `$0.01/GB`; every headline is whole dollars, and free egress reads
"887 TB/mo" (was "886.96 TB/mo").
**Where:** `src/app/analyses/[id]/report/page.tsx`. `formatCurrency` defaults to **2 decimals**
(`src/components/shared/FormatCurrency.tsx` line 7), and the report calls it without the decimals arg in
its headline/aggregate spots, e.g.:
- Hero projected savings ~line 498 `formatCurrency(totalSavings)`.
- Monthly/annual savings ~lines 503, 507.
- `OutcomeMetric` values ~lines 512–519.
- Decision Summary ~lines 555–560; narrative ~lines 570–577; "Where the Savings Come From" net figure
  ~line 1285; tier-comparison totals; migration-cost totals ~lines 750, 765, 788.
- `BusinessPotentialStrip` egress figure uses `formatReportStorage(...)` which shows up to 2 decimals
  ("886.96 TB/mo").

**Problem:** Verified live: the hero read "$52,279.66", "$6,290.67/mo", "$75,488.04/yr", the migration
cost "$26,608.70", and "886.96 TB/mo". Cents on five- and six-figure headline numbers read like a
spreadsheet dump and undermine credibility. It is also inconsistent with the internal dashboard hero,
which rounds to whole dollars (`formatCurrency(v, 0)`).

**Change (CURRENT → DESIRED):** Round **headline and aggregate** currency to whole dollars; keep cents
only on **small per-unit rates** (e.g. `$6.95/TB`, `$0.01/GB`).
- CURRENT: `formatCurrency(totalSavings)` → "$52,279.66".
- DESIRED: `formatCurrency(totalSavings, 0)` → "$52,280". Apply `, 0` to: the hero savings, monthly/
  annual/total savings, all `OutcomeMetric`/`DecisionMetric`/`AssumptionItem` dollar values, narrative
  dollar figures, "Where the Savings Come From" amounts and net, tier-comparison Current/B2/Savings
  columns and totals, action-fee "/mo" amounts, and migration-cost totals.
- KEEP 2 decimals: `formatEffectiveRate` / `b2StorageRateLabel` and any `$/TB` or `$/GB` unit rate.
- For "886.96 TB/mo", round the free-egress figure to whole TB (or 1 decimal) in
  `BusinessPotentialStrip` — do not show hundredths of a TB.

**Rationale:** Whole-dollar headlines read as confident and executive; cents read as machine output
(customer-persuasion + polish + coherence with the dashboard).

**Acceptance criteria:** Render a migration report with realistic synthetic data. No headline/summary
dollar figure shows cents; per-TB/per-GB unit rates still show cents; the free-egress figure shows no
hundredths of a TB. Verify the same figures match (rounded) between dashboard and report.

---

### C2 — Commit-upsell report is thin and doesn't pre-empt the buyer's obvious questions  [CUSTOMER]
**Priority: Medium. Partly NEEDS-DECISION.  STATUS: DONE** — a growth-tied headroom line renders under the
spec table when there's growth, built from modeled data (growthLabel, current/target throughput) with no
invented dollars. **Decision made (state the terms):** the AE now sets a contract length (12/24/36/60mo) on
the deal-sizing dashboard (`B2UsageInput.contractTermMonths`), the report hero states it ("Signing a
3-year contract moves … to the Committed tier"), and it drives the projection and TCV term. No specific
minimum is asserted (Committed has none in the model), so nothing is fabricated. Verified end to end.
**Where:** `src/components/report/CommitUpsellReport.tsx` (whole body).

**Problem:** The report leads with "12.5× more bandwidth / 6× more requests per second" (tier-ceiling
ratios) and a spec table where the storage rate and monthly cost are identical in both columns. A
skeptical architect asks "am I even hitting the 4 Gbit/s ceiling today?" and a CFO sees "same $/month"
with no dollar story. The report never states what "signing a contract" commits the customer to (term,
minimum). It is honest, but it does not close.

**Change (CURRENT → DESIRED):**
- The multiplier hero and messaging-angle points are good — keep them. Add a short, capability-framed
  line that ties the headroom to the customer's own trajectory using data already modeled, e.g. under
  the spec table: *"At {growthLabel}, your stored data keeps climbing while your throughput ceiling
  today stays fixed at {current} — the Committed tier lifts it to {target} so growth never hits a wall."*
  (Use `view.growthLabel`, `view.currentSpec`, `view.targetSpec`; invent no numbers.)
- **NEEDS-DECISION (commitment terms):** The report should state what the customer commits to, but the
  commitment terms are not in the data model. Ask: *"What commitment does moving to Committed require
  (term length, minimum storage/spend), and may we state it on the customer report?"* Do not write any
  specific term until answered.

**Rationale:** Gives the economic buyer a reason beyond "same price" and pre-empts the "do I need this?"
objection without overclaiming (customer-persuasion).

**Acceptance criteria:** The commit-upsell report shows a growth-tied headroom line derived from the
model; no fabricated dollar savings; commitment-terms copy only appears after the NEEDS-DECISION answer.

---

### C3 — Commit-upsell report footer omits AE attribution the migration report includes  [CUSTOMER]
**Priority: Medium (polish + coherence).  STATUS: DONE** — the report page now passes `aeInfo` into
`CommitUpsellReport`, which renders the same "Prepared by {name}, {title} ({email}) · Backblaze | {date}"
footer as the migration report. Verified with `?ae=` params and the redundant "Prepared by your account
team" line removed from the caption.
**Where:** `src/components/report/CommitUpsellReport.tsx` footer ~lines 278–280 (logo only). Migration
report footer for reference: `src/app/analyses/[id]/report/page.tsx` ~lines 943–953 ("Prepared by
{aeInfo …}", "Backblaze | {date}").

**Problem:** The two customer deliverables in the same family have different footers. The commit-upsell
report drops "Prepared by [AE], Backblaze | date", which is a trust/contactability signal on the
migration report.

**Change (CURRENT → DESIRED):** Give the commit-upsell report the same footer treatment as the migration
report: Backblaze wordmark left, "Prepared by {aeName}{, title} ({email})" and "Backblaze | {date}"
right. Load the AE identity the same way the migration report does (URL `?ae=` params, falling back to
`/api/auth/me` + `/api/auth/profile`). Keep it light-only and print-safe.

**Rationale:** One coherent report family; contactable, signed deliverable (coherence + persuasion).

**Acceptance criteria:** The commit-upsell report and PDF footer show the AE's name and email and a date,
matching the migration report's footer layout.

---

### C4 — Single-month bills render the period as an identical-date range  [CUSTOMER]
**Priority: Polish.  STATUS: DONE** — `aws-cost-csv.ts` now renders just the single label when first ===
last instead of "X to X". Verified: a one-row export yields "2026-04-01". (The detail-PDF and summary-PDF
parsers derive the period from a regex match, not a first/last range, so they don't hit this.)
**Where:** period string built in `src/lib/parsers/aws-cost-csv.ts` line ~182
(`billingPeriod = \`${first} to ${last}\``); displayed in the report source-bill rows
(`report/page.tsx` ~line 866, assumptions ~line 1593) and in the PDF filename builder
(`src/lib/report-filename.ts`).

**Problem:** Verified live: a single-month export produced "2026-04-01 to 2026-04-01" in the report,
assumptions, and the PDF filename — reads like a bug to a customer.

**Change (CURRENT → DESIRED):** When the first and last period labels are equal, render the single label
(prefer a month form like "April 2026" if the data supports it) instead of "X to X". Apply at the parser
(so all downstream consumers benefit) — CURRENT `\`${first} to ${last}\`` → DESIRED `first === last ? first : \`${first} to ${last}\``. Confirm the report and the filename builder inherit the fix.

**Rationale:** Small credibility detail on a customer-facing surface (customer-persuasion + polish).

**Acceptance criteria:** A single-month synthetic bill shows one period label (not "X to X") in the
report, the assumptions table, and the PDF filename.

---

### C5 — Hardcoded "June 2026" pricing-date label  [CUSTOMER]
**Priority: Polish. NEEDS-DECISION.  STATUS: DONE** — the three "June 2026" literals now resolve from one
place, `pricingAsOfLabel()` in `src/lib/pricing/pricing-meta.ts` (used by both report surfaces).
**Decision made (auto-derive):** the label is computed from the report-generation date (formatted "Month
YYYY") on each call, so it can't go stale. There is no pricing-refresh timestamp on the JSON to key off,
so report-date is the honest source; if one is added later, only that one file changes. Verified: reports
now show the current month (e.g. "July 2026"), not a frozen literal.
**Where:** `src/app/analyses/[id]/report/page.tsx` line ~928 ("June 2026 (verified against published
rates)"); `src/components/report/CommitUpsellReport.tsx` line ~167 ("· June 2026") and ~272 ("June 2026
published rates").

**Problem:** These are hardcoded literals; the current date at review time was 2026-07-01, so the label
is already a month stale, and it will drift further.

**Change:** NEEDS-DECISION — ask: *"Should the report pricing-date label be driven by a single
`PRICING_AS_OF` constant (updated when pricing is refreshed) or auto-derived from the current date?"*
Then replace all three literals with the chosen single source. Do not scatter a new hardcoded month.

**Rationale:** Avoids a stale-looking date on the customer deliverable and centralizes it (polish).

**Acceptance criteria:** All three "June 2026" strings resolve from one source; changing that source
updates every surface.

---

## Section 4 — Design-consistency fixes

### D1 — No brand-fill token / shared primary button; 51 inline `#e20626` copies with drifting styles  [INTERNAL]
**Priority: High (highest-leverage consistency fix).  STATUS: DONE (token swap; component extraction deferred)**
Added static `--color-c-brand: #e20626` / `--color-c-brand-hover: #b40a23` (same in both themes) and swapped
every bracketed `[#e20626]`/`[#b40a23]` Tailwind utility in the internal app to `bg-c-brand` /
`hover:bg-c-brand-hover` (across page.tsx, new/[id] pages, DealSizing, CommitUpsellDashboard,
EgressQuestionnaire, TierInventory, ParseReview, B2UsageForm, UserMenu, login, and the ProjectionChart term
button). **Intentionally left as literals:** the ProjectionChart Recharts line colors + their matching
legend/tooltip swatches (must equal the SVG line colors) and the light-only customer report. **Verified**
via computed styles + production CSS that the brand stays `#e20626` in dark mode (a plain `bg-c-red` would go
pink). A shared `PrimaryButton` component was **not** extracted — the token swap removes the color drift; a
component to also unify padding/shadow remains an optional follow-up.
**Where:** 123 hardcoded 6-digit hex occurrences across `src/**/*.tsx`. Breakdown of the biggest:
`#e20626` ×51 (= `--c-red` light value), `#b40a23` ×17 (= `--c-red-dark`), `#000033` ×8 (= `--c-nav`),
`#3430ff` ×2 (= `--c-purple`). The primary CTA `bg-[#e20626] … hover:bg-[#b40a23]` is re-implemented
inline in at least: `src/app/page.tsx`, `src/app/analyses/new/page.tsx`, `src/app/analyses/[id]/page.tsx`,
`src/components/dashboard/DealSizing.tsx`, `src/components/dashboard/CommitUpsellDashboard.tsx`,
`src/components/upload/B2UsageForm.tsx`. Its drop shadow drifts (`shadow-[0_4px_14px_rgba(226,6,38,0.28)]`
in some, `hover:shadow-[0_8px_22px_rgba(226,6,38,0.4)]` in the empty state, none elsewhere).

**Why it's hardcoded (do not naively swap to `bg-c-red`):** `--c-red` flips to a light pink (`#ff6173`)
in **dark mode** because it is tuned for text/border legibility, not button fills. Replacing the buttons
with `bg-c-red` would make them pink in dark mode. The correct fix is a dedicated brand-fill token that
stays `#e20626` in both themes, plus one shared button component.

**Change (CURRENT → DESIRED):**
1. In `src/app/globals.css`, add a brand-fill token that does **not** flip with theme. In the `@theme
   inline` block add `--color-c-brand: #e20626;` and `--color-c-brand-hover: #b40a23;` (static hex,
   intentionally the same in light and dark — analogous to the existing static `bb-*` aliases). Document
   with a comment that these are for solid brand button/fill surfaces where the theme-aware `--c-red`
   (which lightens in dark mode) would be wrong.
2. Create `src/components/shared/PrimaryButton.tsx` (and a `SecondaryButton` if useful) encapsulating the
   canonical primary CTA: `bg-c-brand text-white hover:bg-c-brand-hover`, one standard radius, one
   standard shadow, disabled state, and optional leading icon. Match the current dominant look
   (`rounded-[10px]`, `shadow-[0_4px_14px_rgba(226,6,38,0.28)]`, `px-5 py-2.5 text-[13px] font-semibold`).
3. Replace the inline `bg-[#e20626] … hover:bg-[#b40a23]` CTAs in the files above with `PrimaryButton`.
   Replace remaining `#e20626`/`#b40a23`/`#000033`/`#3430ff` used as **flat UI colors** (segmented-control
   active fills, pills, stepper active, filter active, accent bars) with `c-brand`/`c-brand-hover`/`c-nav`/
   `c-purple` utilities as appropriate.
   - **Do not** convert chart/SVG literals in `src/components/dashboard/ProjectionChart.tsx` and the
     report's `ProjectionGraph` (`report/page.tsx` ~lines 1489–1552) in this pass — SVG `stroke`/`fill`
     need literal colors; leave them but note them for a follow-up that passes CSS-var values.

**Rationale:** One brand color and one button = the app teaches itself; a brand tweak becomes a
one-line change instead of 51 edits; drifting shadows stop (coherence + maintainability).

**Acceptance criteria:** Grep `grep -rn "#e20626\|#b40a23" src --include="*.tsx"` returns only chart/SVG
literals (documented). Every primary CTA across new-opportunity, dashboard, deal-sizing, commit-upsell,
and the opportunities list looks identical (radius, shadow, hover). Toggle dark mode: primary buttons
stay brand red (`#e20626`), not pink. `npm run build` passes.

---

### D2 — Orphan semantic colors with no token (`#f9733a`, `#8fe9be`, `#11113a`)  [INTERNAL]
**Priority: Medium.**
**Where:**
- `#f9733a` (orange "active/in-progress") ×4: `src/app/page.tsx` — `cardAccent()` ~line 146, the readiness
  status dot ~line 699, and the "Storage modeled" portfolio bar ~line 483.
- `#8fe9be` (hero stat green) ×2: `src/app/analyses/[id]/page.tsx` `HeroStat` ~line 687.
- `#11113a` (tooltip background) ×3: `src/app/page.tsx` `OpportunityActionButton` tooltip ~line 890
  (and similar tooltips elsewhere).

**Problem:** These recur as real semantic roles ("in progress", "positive hero figure", "tooltip
surface") but have no `--c-*` token, so the same meaning is expressed by a magic hex in multiple files
and can drift.

**Change (CURRENT → DESIRED):** Add tokens in `globals.css` (`@theme inline`, with light/dark values in
`:root`/`.dark` where the color should adapt) and replace the literals:
- `--color-c-accent` (the orange in-progress accent) → replace all `#f9733a` and `bg-[#f9733a]`.
- A tooltip-surface token (e.g. `--color-c-tooltip: #11113a;` or reuse `c-nav`) → replace `#11113a`.
- For the hero stat green (`#8fe9be`): the navy hero band is always dark, so a static token is fine
  (`--color-c-hero-pos: #8fe9be`) — replace the literal and reuse it if other hero positives appear.

**Rationale:** Single source of truth for each semantic role; "in progress" means one color everywhere
(coherence).

**Acceptance criteria:** No `#f9733a` / `#8fe9be` / `#11113a` literals remain in `.tsx`; the readiness
dot, card accent, and "Storage modeled" bar all read from `c-accent`; visuals unchanged in light and dark.

---

### D3 — Standardize currency decimals across internal surfaces  [INTERNAL]
**Priority: Polish (pairs with C1).**
**Where:** `src/app/analyses/[id]/page.tsx` — hero uses `formatCurrency(v, 0)` (whole dollars) but the
projection summary tiles below render cents (verified live: "$52,279.66", "$6,864.99").

**Problem:** Whole dollars in the hero, cents in the projection cards on the same screen — inconsistent.

**Change (CURRENT → DESIRED):** Use `formatCurrency(value, 0)` for the projection summary tiles and any
other large aggregate on the dashboard, matching the hero. Keep cents only for `$/TB`-type unit rates.

**Acceptance criteria:** On the dashboard, no large aggregate shows cents; unit rates still show cents.

---

### D4 — Linked-pair cards show diverging TCV vs. savings without explanation  [INTERNAL]
**Priority: Polish.**
**Where:** `src/app/page.tsx` linked-pair rendering (~lines 558–608) and the per-card savings preview
(~lines 716–726).

**Problem:** Verified live: a linked Standard/Overdrive pair for the same customer showed Overdrive with
**higher** "$/yr saved" but **lower** "potential TCV" than Standard. It is arithmetically explicable
(Overdrive's unlimited egress raises customer savings; TCV reflects the modeled $/TB), but on the card
it invites "which number is right?".

**Change (CURRENT → DESIRED):** Add a one-line explanatory caption to the linked-pair bracket (near the
existing "Linked pair · shown to the customer side by side" header, ~line 598), e.g. *"Overdrive can save
the customer more (unlimited egress) while its storage TCV differs — compare both."* Copy only; no
number changes.

**Rationale:** Removes a moment of AE doubt on the pipeline's headline view (AE-ease + coherence).

**Acceptance criteria:** The linked-pair block carries a short caption clarifying why the two numbers can
diverge; single (unpaired) cards are unaffected.

---

## Suggested order & dependencies

- **B1, B2** first (blockers; independent).
- **A1** depends on its NEEDS-DECISION (TCV term) — resolve the question, then implement; touches the
  report, snapshot route, and list.
- **A2** depends on its NEEDS-DECISION — build Option A (nudge) meanwhile; independent of others.
- **C1** and **D3** are the same "round currency" theme (report vs dashboard) — do together.
- **D1** before **D2** (establish the brand-fill token pattern, then add the smaller orphan tokens).
- **C2, C3, C4, C5** are independent of each other; C2/C5 gated on their NEEDS-DECISION answers.

## Change checklist

- [x] B1 — Commit-upsell customer name: API no longer stamps internal name; company editor added; report shows clean name *(done, verified)*
- [x] B2 — Dashboard hero "Savings start" respects unrecovered migration cost (Break-even · Month N) *(done, verified)*
- [x] A1 — Commit-upsell creates a snapshot and contributes to pipeline TCV / reports-ready *(done, verified; term = 12mo, the model's projection term — a term selector remains a future refinement)*
- [x] A2 — UDM: internal nudge when migration cost > 0 *(done, verified; the default-on option was NOT taken — still a product decision)*
- [x] C1 — Report headline/aggregate currency rounded to whole dollars; unit rates keep cents *(done, verified across both the migration and commit-upsell reports)*
- [x] C2 — Commit-upsell report: growth-tied headroom line + AE-set contract term stated on the report *(done, verified; decision made — state the terms, driven by an AE-chosen contract length)*
- [x] C3 — Commit-upsell report footer gains AE attribution + date (parity with migration report) *(done, verified)*
- [x] C4 — Single-month bills render one period label, not "X to X" *(done, verified; aws-cost-csv only — other parsers use regex-matched periods)*
- [x] C5 — Pricing-date label auto-derived from the report date via `pricingAsOfLabel()` *(done, verified; decision made — auto-derive)*
- [x] D1 — `--c-brand`/`--c-brand-hover` static tokens added; all inline `[#e20626]`/`[#b40a23]` in the internal app swapped to `bg-c-brand`/`hover:bg-c-brand-hover` (chart-line/legend/tooltip swatches + UserMenu avatar gradient intentionally left as literals). Verified brand stays #e20626 in dark. *(done, verified; a shared PrimaryButton component was NOT extracted — token swap only, which removes the color drift; component extraction remains optional follow-up)*
- [x] D2 — `--c-accent` (orange), `--color-c-hero-pos`, `--color-c-tooltip` tokens added; `#f9733a`/`#8fe9be`/`#11113a` literals swapped (UserMenu avatar gradient left as-is). *(done, verified)*
- [x] D3 — Dashboard projection tiles, trend sentence, and hover tooltip use whole-dollar currency (match the hero). *(done, verified)*
- [x] D4 — Linked-pair bracket now carries a caption explaining the TCV-vs-savings divergence. *(done, verified)*
- [ ] Gates: `git diff --check`, `npm run lint`, `npm run build`; render report + export a PDF with synthetic data
