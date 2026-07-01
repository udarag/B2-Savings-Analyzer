import type { B2UsageInput } from '@/types/analysis';
import type { ProjectionPoint } from '@/types/model';
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

  const projections = computeProjections({
    currentMonthlyCost: currentMonthlyCostUsd,
    b2MonthlyCost: projectedTargetMonthlyCostUsd,
    migrationCostTotal: 0, // nothing is migrating providers — this is a tier change on B2 itself
    baseStorageGb: usage.currentStorageTb * 1000,
    growthMode: usage.dataGrowthMode,
    annualGrowthPercent: usage.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: usage.dataGrowthFixedTbPerMonth,
    termMonths: PROJECTION_TERM_MONTHS,
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
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
