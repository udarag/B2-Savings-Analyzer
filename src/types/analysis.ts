import b2Pricing from '@/lib/pricing/b2.json';

/** Source cloud the uploaded bill came from. 'r2' (Cloudflare R2) appears as a migration-target comparison. */
export type Provider = 'aws' | 'gcp' | 'azure' | 'r2';

/** Shape of the uploaded bill, which determines how much per-SKU detail the parser can recover. */
export type BillType = 'summary-invoice' | 'detailed-statement' | 'sku-export';

export type PipelineStatus = 'open' | 'closed-won' | 'closed-lost';

/** What kind of deal this is. Absent/undefined means 'migration' — every record created before
 *  this field existed is a migration analysis, so this default preserves full backward compatibility. */
export type OpportunityType = 'migration' | 'commit-upsell';

/** Which half of a linked Standard/Overdrive variant pair this analysis is, when one exists.
 *  Absent entirely means this analysis has no variant sibling. */
export type ServiceTierVariant = 'standard' | 'overdrive';

/**
 * Buckets a line item into the storage-economics model. Only 'storage' is migrated to B2;
 * 'egress'/'operations'/'retrieval' are storage-scope costs B2 changes, 'storage-adjacent' is
 * borderline, and 'out-of-scope' (compute, etc.) is excluded from addressable spend.
 */
export type Category =
  | 'storage'
  | 'egress'
  | 'operations'
  | 'retrieval'
  | 'storage-adjacent'
  | 'out-of-scope';

/** Kind of non-storage workload inferred from the bill, used to hint at egress that B2 migration would create. */
export type ComputeSignalType =
  | 'compute'
  | 'container'
  | 'serverless'
  | 'ai-ml'
  | 'analytics'
  | 'database'
  | 'delivery'
  | 'networking';

export type ComputeSignalConfidence = 'low' | 'medium' | 'high';

/** A saved customer analysis: bill metadata plus pipeline state, persisted per prospect. */
export interface Analysis {
  id: string;
  prospectName: string;
  companyName?: string;
  notes?: string;
  provider: Provider;
  billType: BillType;
  billingPeriod?: string;
  accountId?: string;
  /** Human-readable trail of how the parser decided the format; internal-only, never shown in the customer report. */
  detectionSignals?: string[];
  pipelineStatus?: PipelineStatus;
  /** Bidirectional pointer to this analysis's Standard/Overdrive twin, when one exists via the
   *  New Opportunity "also create an Overdrive variant" flow. A dangling pointer (sibling deleted)
   *  is expected and handled gracefully — never treated as a data-integrity error. */
  linkedAnalysisId?: string;
  /** Denormalized tag for list-page badging/linking without fetching the full ModelConfig; the
   *  actual pricing-engine input is ModelConfig.b2ServiceTier. Set only when this analysis is one
   *  half of a linked pair; absent means "not part of a variant pair." */
  serviceTierVariant?: ServiceTierVariant;
  /** Transient: set on step-1 create when the AE checked "also create an Overdrive variant",
   *  cleared once the upload route fulfills it after the first successful bill parse. */
  pendingOverdriveVariant?: boolean;
  /** Absent means 'migration' (the original flow: upload a hyperscaler bill). 'commit-upsell'
   *  analyses have no source bill and use B2UsageInput instead of ParsedBill. */
  opportunityType?: OpportunityType;
  createdAt: string;
  updatedAt: string;
}

/** One charge line recovered from the bill, normalized across providers and categorized for the model. */
export interface ParsedLineItem {
  id: string;
  provider: Provider;
  service: string;
  region: string;
  sku: string;
  description: string;
  category: Category;
  subcategory?: string;
  storageClass?: string;
  /** Per-unit price implied by the bill (provider's native basis, e.g. $/GB-month); used to assess list-vs-discount. */
  unitRate?: number;
  usageQuantity?: number;
  usageUnit?: string;
  costUsd: number;
  /** True when the quantity/rate was derived rather than read directly (e.g. summary invoices lacking per-SKU detail). */
  isEstimate: boolean;
  /** True once an AE has hand-corrected this line in the UI; protects it from re-parse overwrites. */
  isEdited: boolean;
}

/** Per-linked-account spend, for consolidated bills spanning multiple accounts. */
export interface AccountBreakdown {
  accountId: string;
  accountName: string;
  amountUsd: number;
}

/** Spend rolled up by (account, service) for the account-level drill-down view. */
export interface AccountServiceBreakdown {
  accountId: string;
  accountName: string;
  serviceName: string;
  serviceKey: string;
  costUsd: number;
}

/** Evidence of a non-storage workload on the bill, surfaced so the AE can reason about egress B2 would introduce. */
export interface ComputeSignal {
  provider: Provider;
  service: string;
  signalType: ComputeSignalType;
  costUsd: number;
  regions?: string[];
  /** Bill lines / SKUs that triggered this signal, for AE-facing justification. */
  evidence: string[];
  /** Plain-language note on how this workload likely affects egress after migration. */
  egressHint: string;
  confidence: ComputeSignalConfidence;
}

export interface EgressProfileMetric {
  label: string;
  value: string;
  detail: string;
}

/**
 * A pre-filled egress-model proposal inferred from compute signals, for the AE to accept or adjust.
 * `suggestedConfig` patches the default EgressConfig; `assumptions`/`questions` keep the inference honest.
 */
export interface EgressProfileSuggestion {
  confidence: ComputeSignalConfidence;
  summary: string;
  suggestedConfig: Partial<EgressConfig>;
  metrics: EgressProfileMetric[];
  evidence: string[];
  assumptions: string[];
  questions: string[];
}

/** Full parser output for one bill: normalized line items plus rollups, signals, and parse-quality metadata. */
export interface ParsedBill {
  lineItems: ParsedLineItem[];
  accounts?: AccountBreakdown[];
  accountServiceBreakdowns?: AccountServiceBreakdown[];
  computeSignals?: ComputeSignal[];
  egressProfileSuggestion?: EgressProfileSuggestion;
  /** Sum of the whole bill (all categories), not just addressable storage scope. */
  grandTotal: number;
  /** 0–1 self-assessed confidence in the parse; low values prompt AE review before sharing. */
  parseConfidence: number;
  /** Internal-only parser caveats; must never reach the customer report. */
  warnings: string[];
  /** Notable contract/commitment hints (e.g. EDP, committed-use) spotted in the bill. */
  commercialSignals?: string[];
  discounts?: NamedDiscount[];
}

/** A named credit/discount line (e.g. EDP, private pricing). Storage-scoped fields isolate the part relevant to B2 comparison. */
export interface NamedDiscount {
  name: string;
  service?: string;
  amountUsd: number;
  /** Portion of the discount attributable to storage charges, when separable. */
  storageAmountUsd?: number;
  /** Gross (pre-discount) storage charges the discount applied against, for back-computing the effective rate. */
  storageGrossCharges?: number;
  estimatedPercent?: number;
}

/**
 * One row of the per-tier migration ledger: the customer's true all-in cost for a storage class
 * versus its modeled B2 cost, and whether the AE has flagged it to migrate.
 */
export interface TierInventoryRow {
  id: string;
  storageClass: string;
  provider: Provider;
  region: string;
  gbStored: number;
  monthlyStorageCost: number;
  /** Blended effective $/TB-month for this tier, used to compare like-for-like against B2's per-TB price. */
  effectivePerTb: number;
  retrievalFees: number;
  earlyDeletionFees: number;
  monitoringFees: number;
  operationsFees: number;
  /** All-in current cost: storage plus every storage-scope fee above; the honest number to beat. */
  totalTrueCost: number;
  modeledB2Cost: number;
  /** totalTrueCost − modeledB2Cost; positive means B2 is cheaper for this tier. */
  delta: number;
  migrateToB2: boolean;
}

/**
 * AE-tunable assumptions about how data moves after migration, which drive the egress side of the model.
 * The boolean flags form a decision tree (see normalizeEgressConfig) that gates which numeric fields matter.
 */
export interface EgressConfig {
  hasHyperscalerCompute: boolean;
  /** Whether that compute reads/writes the storage being migrated (the "data gravity" case that creates B2↔hyperscaler egress). */
  hyperscalerComputeFeedsStorage: boolean;
  /** Legacy flag kept for back-compat; superseded by hasHyperscalerCompute && hyperscalerComputeFeedsStorage. */
  computeStaysInHyperscaler: boolean;
  computeMovingToPartner: boolean;
  /** Monthly bytes pulled from the hyperscaler into B2 (GB, app's GB basis), i.e. ongoing cross-cloud read traffic. */
  gbPerMonthHyperscalerToB2: number;
  /** Monthly bytes served from B2 out to end users (GB). For training workflows this is derived, not entered directly. */
  gbPerMonthServedToUsers: number;
  trainingRunsPerMonth: number;
  trainingDataTbPerRun: number;
  /** Whether egress to users rides a partner CDN (changes the egress cost basis); forced off for training workflows. */
  usesPartnerCdn: boolean;
  dataGrowthMode: 'percent' | 'fixed-tb';
  dataGrowthRatePercent: number;
  dataGrowthFixedTbPerMonth: number;
  dataGrowthPeriod: 'monthly' | 'yearly';
  /** Universal Data Migration: Backblaze covers migration egress, modeled as a one-time cost to Backblaze rather than the customer. */
  udmEnabled: boolean;
}

/** B2 service level the analysis models: uncommitted (pay-as-you-go), committed (contracted), or
 *  overdrive (premium high-throughput). Throughput/RPS ceilings and egress/fee treatment differ by
 *  tier; storage $/TB does not, except Overdrive's which is separately negotiated. */
export type B2ServiceTier = 'uncommitted' | 'committed' | 'overdrive';

/** The complete saved model state for an analysis: tier selections, egress assumptions, and B2 pricing inputs. */
export interface ModelConfig {
  /** Per-tier migrate on/off, keyed by tier id; gated/normalized against tierSelectionVersion. */
  tierToggles: Record<string, boolean>;
  /** Version this config's toggles were computed under; if behind TIER_SELECTION_VERSION the toggles get re-derived. */
  tierSelectionVersion?: number;
  egressConfig: EgressConfig;
  /** B2 storage price the model quotes against, in $/TB-month (overridable for negotiated pricing). */
  b2PricePerTb: number;
  /** B2 service tier this analysis models; drives throughput/RPS spec display and Overdrive's unlimited-egress treatment. */
  b2ServiceTier: B2ServiceTier;
  projectionTermMonths: number;
  /** AE has confirmed the quoted B2 discount is real, gating any below-list pricing in the customer report. */
  pricingDiscountConfirmed?: boolean;
}

/**
 * AE-entered facts about an existing B2 customer's current usage, for the commit-upsell flow.
 * This is the commit-upsell analog of ParsedBill — but there's no bill, so it's hand-entered (or,
 * in the future, extracted from a dashboard screenshot; see `source`).
 */
export interface B2UsageInput {
  /** Current stored volume, decimal TB (the app's usual GB x 1000 basis, matching every other TB figure). */
  currentStorageTb: number;
  /** Current all-in monthly B2 spend in USD, as the AE observed it. */
  currentMonthlySpendUsd: number;
  /** Reuses the exact EgressConfig growth vocabulary/semantics so the projection helpers in
   *  engine/projections.ts need no adapter. */
  dataGrowthMode: 'percent' | 'fixed-tb';
  dataGrowthRatePercent: number;
  dataGrowthFixedTbPerMonth: number;
  dataGrowthPeriod: 'monthly' | 'yearly';
  /** The commit-upsell pitch is always toward the Committed tier — moving an existing pay-as-you-go
   *  customer onto a contract. (Overdrive is a separate, custom-negotiated motion, not this flow.) */
  targetTier: 'committed';
  /** AE-entered committed-tier discount off the customer's current implied $/TB, if one has been
   *  negotiated (0 if not — Committed is typically flat $/TB vs Uncommitted). Percent, e.g. 5 = 5% off. */
  committedDiscountPercent: number;
  /** How this record was populated; surfaces on the dashboard as a provenance note. */
  source: 'manual' | 'screenshot-stub';
  createdAt: string;
  updatedAt: string;
}

// Bump when the tier auto-selection heuristic changes; saved configs below this re-derive their
// toggles instead of trusting stale selections from an older heuristic.
export const TIER_SELECTION_VERSION = 2;

export const DEFAULT_EGRESS_CONFIG: EgressConfig = {
  hasHyperscalerCompute: false,
  hyperscalerComputeFeedsStorage: false,
  computeStaysInHyperscaler: false,
  computeMovingToPartner: false,
  gbPerMonthHyperscalerToB2: 0,
  gbPerMonthServedToUsers: 0,
  trainingRunsPerMonth: 0,
  trainingDataTbPerRun: 0,
  usesPartnerCdn: false,
  dataGrowthMode: 'percent',
  dataGrowthRatePercent: 10,
  dataGrowthFixedTbPerMonth: 0,
  dataGrowthPeriod: 'yearly',
  udmEnabled: false,
};

/**
 * Coerce a partial/legacy egress config into a fully-specified, internally-consistent one.
 * Enforces the flag decision tree so impossible combinations can't reach the model: if there's no
 * hyperscaler compute (or it doesn't touch the storage) the dependent egress numbers are zeroed,
 * and a training workflow (compute that doesn't feed storage) derives served-GB from run volume.
 */
export function normalizeEgressConfig(config?: Partial<EgressConfig> | null): EgressConfig {
  // Migrate the old single computeStaysInHyperscaler flag forward to the newer two-flag model.
  const legacyPipeline = config?.computeStaysInHyperscaler ?? DEFAULT_EGRESS_CONFIG.computeStaysInHyperscaler;
  const hasHyperscalerCompute = config?.hasHyperscalerCompute ?? legacyPipeline;
  const hyperscalerComputeFeedsStorage = hasHyperscalerCompute
    ? config?.hyperscalerComputeFeedsStorage ?? legacyPipeline
    : false;
  // Compute that exists but doesn't read the migrated storage ≈ a training/batch consumer:
  // its data movement is modeled as per-run egress rather than ongoing storage-fed traffic.
  const isTrainingWorkflow = hasHyperscalerCompute && !hyperscalerComputeFeedsStorage;
  const trainingRunsPerMonth = config?.trainingRunsPerMonth ?? DEFAULT_EGRESS_CONFIG.trainingRunsPerMonth;
  const trainingDataTbPerRun = config?.trainingDataTbPerRun ?? DEFAULT_EGRESS_CONFIG.trainingDataTbPerRun;

  return {
    ...DEFAULT_EGRESS_CONFIG,
    ...config,
    hasHyperscalerCompute,
    hyperscalerComputeFeedsStorage,
    computeStaysInHyperscaler: hasHyperscalerCompute && hyperscalerComputeFeedsStorage,
    computeMovingToPartner: hasHyperscalerCompute && hyperscalerComputeFeedsStorage
      ? config?.computeMovingToPartner ?? DEFAULT_EGRESS_CONFIG.computeMovingToPartner
      : false,
    gbPerMonthHyperscalerToB2: hasHyperscalerCompute && hyperscalerComputeFeedsStorage
      ? config?.gbPerMonthHyperscalerToB2 ?? DEFAULT_EGRESS_CONFIG.gbPerMonthHyperscalerToB2
      : 0,
    // Training workflows derive served GB from run volume (×1000 converts TB→GB to the app's GB basis);
    // otherwise honor the AE-entered figure.
    gbPerMonthServedToUsers: isTrainingWorkflow
      ? trainingRunsPerMonth * trainingDataTbPerRun * 1000
      : config?.gbPerMonthServedToUsers ?? DEFAULT_EGRESS_CONFIG.gbPerMonthServedToUsers,
    trainingRunsPerMonth,
    trainingDataTbPerRun,
    usesPartnerCdn: isTrainingWorkflow
      ? false
      : config?.usesPartnerCdn ?? DEFAULT_EGRESS_CONFIG.usesPartnerCdn,
    dataGrowthMode: config?.dataGrowthMode ?? DEFAULT_EGRESS_CONFIG.dataGrowthMode,
    dataGrowthRatePercent: config?.dataGrowthRatePercent ?? DEFAULT_EGRESS_CONFIG.dataGrowthRatePercent,
    dataGrowthFixedTbPerMonth: config?.dataGrowthFixedTbPerMonth ?? DEFAULT_EGRESS_CONFIG.dataGrowthFixedTbPerMonth,
  };
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  tierToggles: {},
  tierSelectionVersion: TIER_SELECTION_VERSION,
  egressConfig: DEFAULT_EGRESS_CONFIG,
  // Seed from B2's published list price so a fresh analysis quotes list until an AE overrides it.
  b2PricePerTb: b2Pricing.storage.perTbMonth,
  // Committed is today's implicit baseline — every analysis saved before this field existed
  // modeled these economics, so defaulting here keeps their behavior unchanged.
  b2ServiceTier: 'committed',
  projectionTermMonths: 12,
  pricingDiscountConfirmed: false,
};
