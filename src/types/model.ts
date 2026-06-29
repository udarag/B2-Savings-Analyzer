/** Current monthly storage-scope cost split by category (USD). Excludes out-of-scope/compute spend. */
export interface CostBreakdown {
  storage: number;
  egress: number;
  operations: number;
  retrieval: number;
  otherFees: number;
  total: number;
}

/** Modeled monthly cost on B2 (USD). No operations line because B2 standard transactions are free; egress is modeled separately. */
export interface B2CostBreakdown {
  storage: number;
  egress: number;
  transactions: number;
  total: number;
}

/** A fee that disappears after migrating to B2 (e.g. retrieval/early-deletion charges), itemized for the report. */
export interface EliminatedFee {
  description: string;
  category: string;
  amountUsd: number;
}

/** One-time cost to get data onto B2: egress out of the source cloud plus any archive-restore charges. */
export interface MigrationCost {
  egressCost: number;
  restoreCost: number;
  total: number;
}

/** Upside when the customer's compute moves to a B2 partner cloud, so storage↔compute egress is avoided. */
export interface PartnerComputeScenario {
  monthlyEgressAvoided: number;
  monthlySavings: number;
  annualSavings: number;
}

/** Full output of the cost model: current vs. B2 monthly economics plus migration and savings rollups. */
export interface CostModelResult {
  currentMonthly: CostBreakdown;
  b2Monthly: B2CostBreakdown;
  eliminatedFees: EliminatedFee[];
  /** Costs B2 introduces that the customer didn't have before (e.g. ongoing egress), itemized for honesty. */
  newCosts: { description: string; amountUsd: number }[];
  partnerComputeScenario: PartnerComputeScenario | null;
  migrationCost: MigrationCost;
  udmEnabled: boolean;
  /** Migration egress Backblaze absorbs under UDM; a cost to Backblaze, not the customer (see EgressConfig.udmEnabled). */
  udmCostToBackblaze: number;
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  /** Months until cumulative savings repay one-time migration cost; null if it never breaks even. */
  breakEvenMonth: number | null;
}

/** One month on the projection curve, accounting for data growth over the term. */
export interface ProjectionPoint {
  month: number;
  storageGb: number;
  currentCost: number;
  b2Cost: number;
  monthlySavings: number;
  cumulativeSavings: number;
}

/**
 * Verdict on how a customer's observed rate compares to provider list pricing, used to flag
 * whether they already hold a negotiated deal that B2's quote must beat.
 */
export interface PricingDetectionResult {
  category: string;
  storageClass?: string;
  region?: string;
  /** Rate implied by the bill (cost ÷ usage), compared against listRate to size the existing discount. */
  effectiveRate: number;
  listRate: number;
  discountPercent: number;
  assessment: 'list-price' | 'small-discount' | 'custom-agreement';
  details: string;
  programName?: string;
  totalAmountUsd?: number;
  storageAmountUsd?: number;
  storagePercentOff?: number;
}

/** Immutable record of the savings numbers at a point in time, captured on report/PDF events for an audit trail. */
export interface ReportSnapshot {
  id: string;
  analysisId: string;
  createdAt: string;
  /** What caused the snapshot, so reruns can be distinguished from actual customer-facing outputs. */
  trigger: 'pdf-download' | 'report-view' | 'analysis-rerun';
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  totalStorageGb: number;
  migratedTierCount: number;
  b2PricePerTb: number;
  termMonths: number;
  growthMode: 'percent' | 'fixed-tb';
  growthRatePercent: number;
  growthFixedTbPerMonth: number;
  udmEnabled: boolean;
}
