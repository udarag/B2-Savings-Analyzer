import b2Pricing from '@/lib/pricing/b2.json';

export type Provider = 'aws' | 'gcp' | 'azure' | 'r2';

export type BillType = 'summary-invoice' | 'detailed-statement' | 'sku-export';

export type PipelineStatus = 'open' | 'closed-won' | 'closed-lost';

export type Category =
  | 'storage'
  | 'egress'
  | 'operations'
  | 'retrieval'
  | 'storage-adjacent'
  | 'out-of-scope';

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

export interface Analysis {
  id: string;
  prospectName: string;
  companyName?: string;
  notes?: string;
  provider: Provider;
  billType: BillType;
  billingPeriod?: string;
  accountId?: string;
  detectionSignals?: string[];
  pipelineStatus?: PipelineStatus;
  createdAt: string;
  updatedAt: string;
}

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
  unitRate?: number;
  usageQuantity?: number;
  usageUnit?: string;
  costUsd: number;
  isEstimate: boolean;
  isEdited: boolean;
}

export interface AccountBreakdown {
  accountId: string;
  accountName: string;
  amountUsd: number;
}

export interface AccountServiceBreakdown {
  accountId: string;
  accountName: string;
  serviceName: string;
  serviceKey: string;
  costUsd: number;
}

export interface ComputeSignal {
  provider: Provider;
  service: string;
  signalType: ComputeSignalType;
  costUsd: number;
  regions?: string[];
  evidence: string[];
  egressHint: string;
  confidence: ComputeSignalConfidence;
}

export interface EgressProfileMetric {
  label: string;
  value: string;
  detail: string;
}

export interface EgressProfileSuggestion {
  confidence: ComputeSignalConfidence;
  summary: string;
  suggestedConfig: Partial<EgressConfig>;
  metrics: EgressProfileMetric[];
  evidence: string[];
  assumptions: string[];
  questions: string[];
}

export interface ParsedBill {
  lineItems: ParsedLineItem[];
  accounts?: AccountBreakdown[];
  accountServiceBreakdowns?: AccountServiceBreakdown[];
  computeSignals?: ComputeSignal[];
  egressProfileSuggestion?: EgressProfileSuggestion;
  grandTotal: number;
  parseConfidence: number;
  warnings: string[];
  commercialSignals?: string[];
  discounts?: NamedDiscount[];
}

export interface NamedDiscount {
  name: string;
  service?: string;
  amountUsd: number;
  storageAmountUsd?: number;
  storageGrossCharges?: number;
  estimatedPercent?: number;
}

export interface TierInventoryRow {
  id: string;
  storageClass: string;
  provider: Provider;
  region: string;
  gbStored: number;
  monthlyStorageCost: number;
  effectivePerTb: number;
  retrievalFees: number;
  earlyDeletionFees: number;
  monitoringFees: number;
  operationsFees: number;
  totalTrueCost: number;
  modeledB2Cost: number;
  delta: number;
  migrateToB2: boolean;
}

export interface EgressConfig {
  hasHyperscalerCompute: boolean;
  hyperscalerComputeFeedsStorage: boolean;
  computeStaysInHyperscaler: boolean;
  computeMovingToPartner: boolean;
  gbPerMonthHyperscalerToB2: number;
  gbPerMonthServedToUsers: number;
  trainingRunsPerMonth: number;
  trainingDataTbPerRun: number;
  usesPartnerCdn: boolean;
  dataGrowthMode: 'percent' | 'fixed-tb';
  dataGrowthRatePercent: number;
  dataGrowthFixedTbPerMonth: number;
  dataGrowthPeriod: 'monthly' | 'yearly';
  udmEnabled: boolean;
}

export interface ModelConfig {
  tierToggles: Record<string, boolean>;
  tierSelectionVersion?: number;
  egressConfig: EgressConfig;
  b2PricePerTb: number;
  projectionTermMonths: number;
  pricingDiscountConfirmed?: boolean;
}

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

export function normalizeEgressConfig(config?: Partial<EgressConfig> | null): EgressConfig {
  const legacyPipeline = config?.computeStaysInHyperscaler ?? DEFAULT_EGRESS_CONFIG.computeStaysInHyperscaler;
  const hasHyperscalerCompute = config?.hasHyperscalerCompute ?? legacyPipeline;
  const hyperscalerComputeFeedsStorage = hasHyperscalerCompute
    ? config?.hyperscalerComputeFeedsStorage ?? legacyPipeline
    : false;
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
  b2PricePerTb: b2Pricing.storage.perTbMonth,
  projectionTermMonths: 12,
  pricingDiscountConfirmed: false,
};
