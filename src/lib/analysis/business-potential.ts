import type { TierInventoryRow } from '@/types/analysis';
import type { CostModelResult } from '@/types/model';
import b2Pricing from '@/lib/pricing/b2.json';

// "Business potential" reframes the same migration economics from cost-out (what you stop paying)
// into value-in (what the new economics let you do). Every figure here is derived from the
// customer's own bill plus their negotiated B2 rate — no outside assumptions — so the unlock
// numbers stay as defensible as the savings numbers they sit beside. The two headline figures are
// aimed at the technical/data buyer (capacity headroom, egress freedom); the redeployable-capital
// figure restates the savings for the financial buyer.

/** Below this, a capacity multiplier isn't worth claiming as an "unlock": a customer already on a
 *  cheap archive tier can sit at or below B2's flat storage rate, where the win is in egress,
 *  retrieval, and request fees rather than the storage rate itself. */
const MIN_CAPACITY_MULTIPLIER = 1.1;

export interface BusinessPotential {
  /** Blended storage-only $/TB-month across the migrated tiers (excludes egress/ops/retrieval). */
  currentStoragePerTb: number;
  /** The negotiated B2 storage rate the report models against, $/TB-month. */
  b2StoragePerTb: number;
  /** currentStoragePerTb ÷ b2StoragePerTb — "the same storage budget holds this many × the data". */
  capacityMultiplier: number;
  /** Whether the multiplier clears MIN_CAPACITY_MULTIPLIER and there is storage to model. */
  hasCapacityUnlock: boolean;
  /** B2's bundled free egress allowance = 3× migrated stored data, in GB/month. */
  freeEgressGbPerMonth: number;
  /** Internet + replication egress B2 removes for the migrated scope, $/month (0 if none on the bill). */
  eliminatedEgressMonthly: number;
  /** Share of the addressable storage spend the migration reclaims (costModel.savingsPercent). */
  reclaimedPercent: number;
  /** Annual recurring savings, $/year. */
  annualSavings: number;
  /** Cumulative savings across the full projection term — the redeployable-capital figure. */
  cumulativeSavings: number;
  /** Whether there is positive savings to reframe as redeployable capital. */
  hasReclaimableCapital: boolean;
}

export interface BusinessPotentialInput {
  migratedTiers: TierInventoryRow[];
  b2PricePerTb: number;
  costModel: CostModelResult;
  /** Cumulative savings over the projection term (the final projection point's cumulativeSavings). */
  cumulativeSavings: number;
}

/**
 * Derive the "business potential" headline figures from an already-computed analysis. Pure and
 * side-effect-free so the dashboard and customer report can share one source of truth.
 */
export function computeBusinessPotential({
  migratedTiers,
  b2PricePerTb,
  costModel,
  cumulativeSavings,
}: BusinessPotentialInput): BusinessPotential {
  const storageGb = migratedTiers.reduce((sum, tier) => sum + tier.gbStored, 0);
  // Storage-only spend (monthlyStorageCost), deliberately not all-in totalTrueCost: the capacity
  // multiplier is a like-for-like storage-rate comparison, and egress/operations/retrieval fees
  // don't scale linearly with stored TB, so folding them in would overstate the headroom.
  const storageCost = migratedTiers.reduce((sum, tier) => sum + tier.monthlyStorageCost, 0);
  const currentStoragePerTb = storageGb > 0 ? storageCost / (storageGb / 1000) : 0;
  const capacityMultiplier = b2PricePerTb > 0 ? currentStoragePerTb / b2PricePerTb : 0;
  const hasCapacityUnlock = storageGb > 0 && capacityMultiplier >= MIN_CAPACITY_MULTIPLIER;

  // B2 bundles free egress at 3× stored data per month (b2.egress.freeMultiplier).
  const freeEgressGbPerMonth = storageGb * b2Pricing.egress.freeMultiplier;

  // The internet + replication egress B2 removes for the migrated scope, used as the "what you pay
  // to move data today" anchor next to the free allowance. Read off the eliminated-fee breakdown so
  // it stays consistent with the savings math rather than re-summing the bill.
  const eliminatedEgressMonthly = costModel.eliminatedFees
    .filter((fee) => fee.category === 'egress')
    .reduce((sum, fee) => sum + fee.amountUsd, 0);

  return {
    currentStoragePerTb: round2(currentStoragePerTb),
    b2StoragePerTb: round2(b2PricePerTb),
    capacityMultiplier,
    hasCapacityUnlock,
    freeEgressGbPerMonth: round2(freeEgressGbPerMonth),
    eliminatedEgressMonthly: round2(eliminatedEgressMonthly),
    reclaimedPercent: costModel.savingsPercent,
    annualSavings: costModel.annualSavings,
    cumulativeSavings: round2(cumulativeSavings),
    hasReclaimableCapital: cumulativeSavings > 0,
  };
}

/**
 * Format a capacity multiplier for display: one decimal below 10× ("3.2×"), whole numbers above
 * ("14×"), and a trailing ".0" trimmed so it reads cleanly ("4×", not "4.0×"). Returns an em dash
 * for a non-positive/non-finite multiplier so callers never render "NaN×".
 */
export function formatCapacityMultiplier(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return '—';
  if (multiplier >= 10) return `${Math.round(multiplier)}×`;
  const oneDecimal = Math.round(multiplier * 10) / 10;
  return Number.isInteger(oneDecimal) ? `${oneDecimal}×` : `${oneDecimal.toFixed(1)}×`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
