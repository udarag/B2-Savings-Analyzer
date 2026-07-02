import type { B2UsageInput } from '@/types/analysis';
import type { ProjectionPoint, ReportSnapshot } from '@/types/model';
import { computeProjections, formatGrowthAssumption } from '@/lib/engine/projections';
import { getServiceTierSpec, type ServiceTierSpec } from '@/lib/pricing/service-levels';

// Compute path for the commit-upsell flow: an existing B2 Uncommitted (pay-as-you-go) customer being
// pitched to sign a contract and move to the Committed tier. There's no source-cloud bill here — the
// only "current" numbers are what the AE entered about the customer's own B2 usage — so this stays a
// small, separate function rather than being shoehorned through ParsedBill/computeCostModel.

export interface CommitUpsellView {
  currentSpec: ServiceTierSpec;
  targetSpec: ServiceTierSpec;
  /** The customer's current pay-as-you-go rate, implied from spend / storage. */
  currentRatePerTb: number;
  /** The Committed rate: the current implied rate minus the AE's contract discount. */
  targetRatePerTb: number;
  /** The contract discount the AE is modeling, as a %. */
  discountPercent: number;
  currentMonthlyCostUsd: number;
  projectedTargetMonthlyCostUsd: number;
  /** currentMonthlyCostUsd - projectedTargetMonthlyCostUsd. ~0 for Committed at no discount (flat
   *  $/TB); positive when the AE discounts to close the contract. Reported honestly, never hidden. */
  monthlyDeltaUsd: number;
  projections: ProjectionPoint[];
  growthLabel: string;
  /** Contract length in months the deal is sized for (AE-set; defaults to 12). Drives the projection
   *  term and the TCV, and is stated on the customer report so the commitment is named. */
  termMonths: number;
}

const PROJECTION_TERM_MONTHS = 12;

export function computeCommitUpsellView(usage: B2UsageInput): CommitUpsellView {
  const currentSpec = getServiceTierSpec('uncommitted');
  const targetSpec = getServiceTierSpec(usage.targetTier);

  const currentMonthlyCostUsd = round2(usage.currentMonthlySpendUsd);
  // The one real fact we have is the customer's current implied $/TB; the Committed rate is that same
  // rate minus any AE-negotiated discount (0 by default — Committed is typically flat $/TB vs
  // Uncommitted, so the value is the throughput headroom, not a lower bill).
  const impliedRatePerTb = usage.currentStorageTb > 0
    ? usage.currentMonthlySpendUsd / usage.currentStorageTb
    : 0;
  const targetRatePerTb = impliedRatePerTb * (1 - usage.committedDiscountPercent / 100);
  const projectedTargetMonthlyCostUsd = round2(targetRatePerTb * usage.currentStorageTb);
  const monthlyDeltaUsd = round2(currentMonthlyCostUsd - projectedTargetMonthlyCostUsd);

  // Contract length the AE sized the deal for; defaults to 12mo on legacy records without the field.
  const termMonths = usage.contractTermMonths && usage.contractTermMonths > 0
    ? Math.round(usage.contractTermMonths)
    : PROJECTION_TERM_MONTHS;

  const projections = computeProjections({
    currentMonthlyCost: currentMonthlyCostUsd,
    b2MonthlyCost: projectedTargetMonthlyCostUsd,
    migrationCostTotal: 0, // nothing is migrating providers — this is a tier change on B2 itself
    baseStorageGb: usage.currentStorageTb * 1000,
    growthMode: usage.dataGrowthMode,
    annualGrowthPercent: usage.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: usage.dataGrowthFixedTbPerMonth,
    termMonths,
  });

  const growthLabel = formatGrowthAssumption({
    growthMode: usage.dataGrowthMode,
    annualGrowthPercent: usage.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: usage.dataGrowthFixedTbPerMonth,
  });

  return {
    currentSpec,
    targetSpec,
    currentRatePerTb: round2(impliedRatePerTb),
    targetRatePerTb: round2(targetRatePerTb),
    discountPercent: usage.committedDiscountPercent,
    currentMonthlyCostUsd,
    projectedTargetMonthlyCostUsd,
    monthlyDeltaUsd,
    projections,
    growthLabel,
    termMonths,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build a durable report snapshot for a commit-upsell opportunity from its B2 usage input, so the
 * deal shows up in the pipeline rollups (potential TCV, storage modeled, reports-ready) the same way a
 * migration snapshot does — before this, commit-upsell opportunities never snapshotted and read as
 * "$0 potential / no report" forever. Pure: the caller supplies id + createdAt so this stays
 * side-effect-free (mirrors buildAnalysisSnapshot's injected `now`).
 *
 * There's no dollar-savings hero here (Committed is typically flat $/TB), so monthly/annual savings
 * reflect only a genuinely-negotiated contract discount (0 at a flat rate) and are never fabricated.
 * "TCV" is the committed storage value: the committed $/TB across the projection term with growth,
 * which the list's estimateStorageTcv derives from b2PricePerTb + totalStorageGb + term + growth.
 */
export function buildCommitUpsellSnapshot({
  analysisId,
  usage,
  trigger,
  snapshotId,
  createdAt,
}: {
  analysisId: string;
  usage: B2UsageInput;
  trigger: ReportSnapshot['trigger'];
  snapshotId: string;
  createdAt: string;
}): ReportSnapshot {
  const view = computeCommitUpsellView(usage);
  return {
    id: snapshotId,
    analysisId,
    createdAt,
    trigger,
    monthlySavings: view.monthlyDeltaUsd,
    annualSavings: round2(view.monthlyDeltaUsd * 12),
    savingsPercent: view.discountPercent,
    totalStorageGb: usage.currentStorageTb * 1000,
    // Not a tiered migration; there's a single storage pool, so record 1 rather than 0 tiers.
    migratedTierCount: 1,
    b2PricePerTb: view.targetRatePerTb,
    // The contract length the AE sized the deal for, so pipeline TCV reflects the real term.
    termMonths: view.termMonths,
    growthMode: usage.dataGrowthMode,
    growthRatePercent: usage.dataGrowthRatePercent,
    growthFixedTbPerMonth: usage.dataGrowthFixedTbPerMonth,
    udmEnabled: false,
    b2ServiceTier: usage.targetTier,
  };
}
