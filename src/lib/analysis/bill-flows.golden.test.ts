import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

import { extractPdfText } from '@/lib/parsers/pdf-text';
import { parseAwsDetailPdf } from '@/lib/parsers/aws-detail-pdf';
import { parseUsagePdfText } from '@/lib/analysis/usage-pdf-parse';
import {
  computeCommitUpsellView,
  buildCommitUpsellSnapshot,
} from '@/lib/analysis/commit-upsell-model';
import { buildTierState, computeAnalysisView } from '@/lib/analysis/analysis-model';
import { buildAnalysisSnapshot } from '@/lib/analysis/rerun';
import {
  getStorageScopeCurrentMonthly,
  getStorageScopeReplacementMonthly,
} from '@/lib/engine/cost-model';
import { DEFAULT_MODEL_CONFIG } from '@/types/analysis';
import type { B2ServiceTier, B2UsageInput, ModelConfig, ParsedBill } from '@/types/analysis';
import type { ProjectionPoint } from '@/types/model';

// End-to-end regression gate for the two flows an AE actually runs, driven by the two canonical test
// bills — a new-customer AWS detailed bill (migration) and an existing-customer B2 usage export
// (commit-upsell). Both bills are real customer data, so they live only in gitignored `bills/` and
// this suite self-skips on any checkout without them (fresh clone, public mirror, CI). That keeps
// `npm test` green everywhere while giving local pre-push runs the full real-bill check. Synthetic-
// input parsing is already covered by the unit tests next to each parser; this file guards the wiring.
//
// Each bill runs through 4 variants of the options an AE selects (service tier + $/TB for migration,
// contract discount for commit-upsell). For every variant we assert three things:
//   1. Invariants      — structural/range sanity (no NaN, sane counts, right sign).
//   2. Math reconciles  — derived numbers are recomputed from their inputs and must match within a
//      rounding tolerance. This is what "notices variance in the math": the golden below catches when
//      a value *changes*; these checks catch when a value stops *reconciling* (e.g. annualSavings no
//      longer equals monthlySavings x 12), which a wrong golden re-bless would otherwise hide.
//   3. Direction        — changing an option moves the numbers the way the math requires (more
//      discount => lower committed rate; cheaper $/TB => more savings; unlimited-egress tier => no
//      new egress cost).
// Plus a golden summary per flow (gitignored `bills/golden/*.snap`), auto-blessed on first local run,
// then failing on any drift. Re-bless intentional model changes with `npm test -- -u`.

const BILLS_DIR = resolve(process.cwd(), 'bills');
const GOLDEN_DIR = resolve(BILLS_DIR, 'golden');
const AWS_BILL = resolve(BILLS_DIR, 'April-bill-highlighted.pdf');
const USAGE_BILL = resolve(BILLS_DIR, 'ca004-usage.pdf');

// The AWS parser shells out to poppler's `pdftotext`; without it the flow can't run at all. If you
// have the bills you almost certainly have it (the app requires it), but check so the skip reason is
// clear rather than a cryptic ENOENT.
function hasPdftotext(): boolean {
  try {
    execSync('pdftotext -v', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const missing: string[] = [];
if (!existsSync(AWS_BILL)) missing.push('bills/April-bill-highlighted.pdf');
if (!existsSync(USAGE_BILL)) missing.push('bills/ca004-usage.pdf');
if (!hasPdftotext()) missing.push('pdftotext (poppler)');
const canRun = missing.length === 0;

if (!canRun) {
  console.warn(`[bill-flows.golden] skipped — missing: ${missing.join(', ')}`);
}

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Assert a derived value matches what its formula recomputes, reporting the variance on failure. The
 *  message is what surfaces "variance in the math" — you see the got/expected/delta, not just a bool. */
function reconcile(label: string, actual: number, expected: number, tol = 0.02): void {
  const delta = Math.abs(actual - expected);
  expect(
    delta,
    `math variance in ${label}: got ${actual}, expected ≈ ${expected} (|Δ|=${delta.toFixed(4)} > tol ${tol})`,
  ).toBeLessThanOrEqual(tol);
}

/** Re-derive the per-month projection math exactly as engine/projections.ts does and assert it holds:
 *  monthlySavings = currentCost - b2Cost, cumulative is the running sum seeded at -migrationCost, and
 *  storage never shrinks under non-negative growth. */
function assertProjectionMath(points: ProjectionPoint[], termMonths: number, migrationCostTotal: number): void {
  expect(points).toHaveLength(termMonths);
  let running = -migrationCostTotal;
  let prevStorage = -Infinity;
  for (const p of points) {
    reconcile(`projection[m${p.month}].monthlySavings = currentCost - b2Cost`, p.monthlySavings, round2(p.currentCost - p.b2Cost), 0.011);
    running += p.monthlySavings;
    reconcile(`projection[m${p.month}].cumulativeSavings recurrence`, p.cumulativeSavings, round2(running), 0.011);
    expect(p.storageGb, `storage shrank at month ${p.month}`).toBeGreaterThanOrEqual(prevStorage - 0.01);
    prevStorage = p.storageGb;
  }
}

/** First and last projection point — enough to lock projection behavior in the golden without dumping
 *  every month (the interior recurrence is covered by assertProjectionMath). */
function projectionEndpoints(points: ProjectionPoint[]) {
  return { count: points.length, first: points[0], last: points[points.length - 1] };
}

// ---------------------------------------------------------------------------------------------------
// Migration flow — new customer AWS detailed bill
// ---------------------------------------------------------------------------------------------------

interface MigrationVariant {
  key: string;
  tier: B2ServiceTier;
  pricePerTb: number;
  termMonths: number;
}

// The option combinations an AE realistically selects in the "Build the deal" panel: list-price
// Committed (the baseline), a negotiated multi-year Committed rate, unlimited-egress Overdrive, and
// pay-as-you-go Uncommitted. B2 list is $6.95/TB; Overdrive suggests $15/TB.
const MIGRATION_VARIANTS: MigrationVariant[] = [
  { key: 'committed-list', tier: 'committed', pricePerTb: 6.95, termMonths: 12 },
  { key: 'committed-negotiated', tier: 'committed', pricePerTb: 5.0, termMonths: 36 },
  { key: 'overdrive-15', tier: 'overdrive', pricePerTb: 15.0, termMonths: 12 },
  { key: 'uncommitted-list', tier: 'uncommitted', pricePerTb: 6.95, termMonths: 12 },
];

function runMigrationVariant(parsed: ParsedBill, v: MigrationVariant) {
  const config: ModelConfig = {
    ...DEFAULT_MODEL_CONFIG,
    b2ServiceTier: v.tier,
    b2PricePerTb: v.pricePerTb,
    projectionTermMonths: v.termMonths,
  };
  const { tiers, modelConfig } = buildTierState(parsed, config);
  const view = computeAnalysisView({
    lineItems: parsed.lineItems,
    discounts: parsed.discounts,
    tiers,
    egressConfig: modelConfig.egressConfig,
    b2PricePerTb: modelConfig.b2PricePerTb,
    b2ServiceTier: modelConfig.b2ServiceTier,
    termMonths: modelConfig.projectionTermMonths,
  });
  // The durable snapshot the pipeline/report actually persist — kept in step with the view above.
  const { snapshot } = buildAnalysisSnapshot({ analysisId: v.key, parsed, modelConfig: config, trigger: 'analysis-rerun', now: FIXED_NOW });
  return { v, view, snapshot };
}

describe.skipIf(!canRun)('migration flow — new customer AWS detailed bill', () => {
  const { parsedBill: parsed, billingPeriod, accountId } = parseAwsDetailPdf(readFileSync(AWS_BILL));
  const runs = MIGRATION_VARIANTS.map((v) => runMigrationVariant(parsed, v));

  it('parses to a sane, storage-scoped structure', () => {
    expect(parsed.grandTotal).toBeGreaterThan(0);
    expect(parsed.lineItems.length).toBeGreaterThan(0);
    expect(parsed.accounts?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.parseConfidence).toBeGreaterThanOrEqual(0.5);
  });

  it('every variant models to finite numbers with the selected options echoed', () => {
    for (const { v, view, snapshot } of runs) {
      const cm = view.costModel;
      for (const n of [cm.currentMonthly.total, cm.b2Monthly.total, cm.monthlySavings, cm.annualSavings, cm.savingsPercent]) {
        expect(Number.isFinite(n), `${v.key}: non-finite cost-model value`).toBe(true);
      }
      expect(view.migratedTiers.length, `${v.key}: no tiers migrated`).toBeGreaterThan(0);
      // The snapshot must echo exactly the options this run modeled.
      expect(snapshot.b2ServiceTier).toBe(v.tier);
      expect(snapshot.b2PricePerTb).toBe(v.pricePerTb);
      expect(snapshot.termMonths).toBe(v.termMonths);
    }
  });

  it('every variant reconciles internally (no math variance)', () => {
    for (const { v, view, snapshot } of runs) {
      const cm = view.costModel;
      // Savings is exactly storage-scope current spend minus the B2 replacement spend.
      reconcile(`${v.key}: monthlySavings = scopeCurrent - scopeReplacement`, cm.monthlySavings, round2(getStorageScopeCurrentMonthly(cm) - getStorageScopeReplacementMonthly(cm)));
      reconcile(`${v.key}: annualSavings = monthlySavings x 12`, cm.annualSavings, round2(cm.monthlySavings * 12));
      reconcile(`${v.key}: b2Monthly.total = storage + egress`, cm.b2Monthly.total, round2(cm.b2Monthly.storage + cm.b2Monthly.egress));
      // Savings and its percentage must share a sign — a positive saving can't read as a negative %.
      if (cm.monthlySavings > 0) expect(cm.savingsPercent, `${v.key}: savings +ve but % not`).toBeGreaterThan(0);
      // The persisted snapshot must carry the same savings the view computed.
      reconcile(`${v.key}: snapshot.monthlySavings = costModel.monthlySavings`, snapshot.monthlySavings, cm.monthlySavings);
      reconcile(`${v.key}: snapshot.annualSavings = costModel.annualSavings`, snapshot.annualSavings, cm.annualSavings);
      assertProjectionMath(view.projections, v.termMonths, cm.migrationCost.total);
    }
  });

  it('option changes move the math in the required direction', () => {
    const byKey = Object.fromEntries(runs.map((r) => [r.v.key, r.view.costModel]));
    // Uncommitted and Committed model identical economics (the tier only changes throughput display,
    // not egress treatment), so at the same price their savings must match.
    reconcile('uncommitted == committed savings at same price', byKey['uncommitted-list'].monthlySavings, byKey['committed-list'].monthlySavings, 0.02);
    // A cheaper negotiated $/TB must yield strictly more monthly savings than list.
    expect(byKey['committed-negotiated'].monthlySavings).toBeGreaterThan(byKey['committed-list'].monthlySavings);
    // Overdrive has unlimited egress, so migration introduces no new egress cost.
    expect(byKey['overdrive-15'].newCosts.some((c) => /egress/i.test(c.description))).toBe(false);
  });

  it('matches the local golden summary for all variants', async () => {
    const summary = {
      billingPeriod,
      accountId,
      grandTotal: round2(parsed.grandTotal),
      lineItemCount: parsed.lineItems.length,
      accountCount: parsed.accounts?.length ?? 0,
      parseConfidence: parsed.parseConfidence,
      variants: runs.map(({ v, view, snapshot }) => ({
        key: v.key,
        tier: v.tier,
        pricePerTb: v.pricePerTb,
        termMonths: v.termMonths,
        currentMonthlyTotal: view.costModel.currentMonthly.total,
        b2Monthly: view.costModel.b2Monthly,
        monthlySavings: view.costModel.monthlySavings,
        annualSavings: view.costModel.annualSavings,
        savingsPercent: view.costModel.savingsPercent,
        breakEvenMonth: view.costModel.breakEvenMonth,
        migrationCostTotal: view.costModel.migrationCost.total,
        newCosts: view.costModel.newCosts,
        migratedStorageGb: round2(view.migratedStorageGb),
        migratedTierCount: view.migratedTiers.length,
        snapshotStorageGb: round2(snapshot.totalStorageGb),
        projection: projectionEndpoints(view.projections),
      })),
    };
    await expect(summary).toMatchFileSnapshot(resolve(GOLDEN_DIR, 'april-aws.snap'));
  });
});

// ---------------------------------------------------------------------------------------------------
// Commit-upsell flow — existing customer B2 usage export
// ---------------------------------------------------------------------------------------------------

// The one option an AE selects here is the contract discount off the customer's current implied $/TB.
// The pitch is always toward Committed (Overdrive is a separate motion), so we sweep the discount.
const COMMIT_UPSELL_DISCOUNTS = [0, 5, 10, 15];

function runUpsellVariant(base: Omit<B2UsageInput, 'committedDiscountPercent'>, discountPercent: number) {
  const usage: B2UsageInput = { ...base, committedDiscountPercent: discountPercent };
  const view = computeCommitUpsellView(usage);
  const snapshot = buildCommitUpsellSnapshot({
    analysisId: `upsell-${discountPercent}`,
    usage,
    trigger: 'analysis-rerun',
    snapshotId: `snap-${discountPercent}`,
    createdAt: FIXED_NOW.toISOString(),
  });
  return { discountPercent, usage, view, snapshot };
}

describe.skipIf(!canRun)('commit-upsell flow — existing customer B2 usage export', () => {
  const parsed = parseUsagePdfText(extractPdfText(readFileSync(USAGE_BILL)));

  it('parses the usage export deterministically', () => {
    expect(parsed).not.toBeNull();
    expect(parsed!.currentStorageTb).toBeGreaterThan(0);
    expect(parsed!.currentMonthlySpendUsd).toBeGreaterThan(0);
    expect(parsed!.dataGrowthMode).toBe('percent');
  });

  const base: Omit<B2UsageInput, 'committedDiscountPercent'> = {
    currentStorageTb: parsed?.currentStorageTb ?? 0,
    currentMonthlySpendUsd: parsed?.currentMonthlySpendUsd ?? 0,
    dataGrowthMode: parsed?.dataGrowthMode ?? 'percent',
    dataGrowthRatePercent: parsed?.dataGrowthRatePercent ?? 0,
    dataGrowthFixedTbPerMonth: 0,
    dataGrowthPeriod: parsed?.dataGrowthPeriod ?? 'yearly',
    targetTier: 'committed',
    source: 'manual',
    createdAt: FIXED_NOW.toISOString(),
    updatedAt: FIXED_NOW.toISOString(),
  };
  const runs = COMMIT_UPSELL_DISCOUNTS.map((d) => runUpsellVariant(base, d));

  it('every variant produces finite numbers and 12 projection points', () => {
    for (const { discountPercent, view } of runs) {
      expect(view.projections).toHaveLength(12);
      for (const n of [view.currentRatePerTb, view.targetRatePerTb, view.currentMonthlyCostUsd, view.projectedTargetMonthlyCostUsd, view.monthlyDeltaUsd]) {
        expect(Number.isFinite(n), `discount ${discountPercent}: non-finite value`).toBe(true);
      }
      // A discount can never raise the committed rate above the current implied rate.
      expect(view.targetRatePerTb).toBeLessThanOrEqual(view.currentRatePerTb);
    }
  });

  it('every variant reconciles internally (no math variance)', () => {
    const spend = base.currentMonthlySpendUsd;
    const storage = base.currentStorageTb;
    for (const { discountPercent: d, view, snapshot } of runs) {
      const impliedRate = spend / storage;
      reconcile(`d${d}: currentRate = spend / storage`, view.currentRatePerTb, round2(impliedRate), 0.01);
      reconcile(`d${d}: targetRate = currentRate x (1 - d/100)`, view.targetRatePerTb, round2(impliedRate * (1 - d / 100)));
      reconcile(`d${d}: projectedCost = spend x (1 - d/100)`, view.projectedTargetMonthlyCostUsd, round2(spend * (1 - d / 100)));
      reconcile(`d${d}: monthlyDelta = current - projected`, view.monthlyDeltaUsd, round2(view.currentMonthlyCostUsd - view.projectedTargetMonthlyCostUsd), 0.011);
      // Snapshot echoes: savings never fabricated beyond the negotiated discount.
      reconcile(`d${d}: snapshot.annualSavings = monthlyDelta x 12`, snapshot.annualSavings, round2(view.monthlyDeltaUsd * 12));
      expect(snapshot.savingsPercent, `d${d}: savingsPercent != discount`).toBe(d);
      expect(snapshot.totalStorageGb).toBe(round2(storage * 1000));
      reconcile(`d${d}: snapshot.b2PricePerTb = targetRate`, snapshot.b2PricePerTb, view.targetRatePerTb);
      assertProjectionMath(view.projections, 12, 0);
    }
  });

  it('more discount moves the math in the required direction', () => {
    const ordered = [...runs].sort((a, b) => a.discountPercent - b.discountPercent);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].view;
      const cur = ordered[i].view;
      expect(cur.targetRatePerTb, 'rate should fall as discount rises').toBeLessThan(prev.targetRatePerTb);
      expect(cur.projectedTargetMonthlyCostUsd, 'projected cost should fall as discount rises').toBeLessThan(prev.projectedTargetMonthlyCostUsd);
      expect(cur.monthlyDeltaUsd, 'monthly delta should rise as discount rises').toBeGreaterThan(prev.monthlyDeltaUsd);
    }
    // Flat baseline: 0% discount fabricates no saving.
    expect(ordered[0].view.monthlyDeltaUsd).toBe(0);
  });

  it('matches the local golden summary for all variants', async () => {
    const summary = {
      parsed,
      variants: runs.map(({ discountPercent, view, snapshot }) => ({
        discountPercent,
        currentRatePerTb: view.currentRatePerTb,
        targetRatePerTb: view.targetRatePerTb,
        currentMonthlyCostUsd: view.currentMonthlyCostUsd,
        projectedTargetMonthlyCostUsd: view.projectedTargetMonthlyCostUsd,
        monthlyDeltaUsd: view.monthlyDeltaUsd,
        growthLabel: view.growthLabel,
        snapshot: {
          monthlySavings: snapshot.monthlySavings,
          annualSavings: snapshot.annualSavings,
          savingsPercent: snapshot.savingsPercent,
          totalStorageGb: snapshot.totalStorageGb,
          b2PricePerTb: snapshot.b2PricePerTb,
          termMonths: snapshot.termMonths,
          b2ServiceTier: snapshot.b2ServiceTier,
        },
        projection: projectionEndpoints(view.projections),
      })),
    };
    await expect(summary).toMatchFileSnapshot(resolve(GOLDEN_DIR, 'ca004-commit-upsell.snap'));
  });
});
