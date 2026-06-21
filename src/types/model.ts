export interface CostBreakdown {
  storage: number;
  egress: number;
  operations: number;
  retrieval: number;
  otherFees: number;
  total: number;
}

export interface B2CostBreakdown {
  storage: number;
  egress: number;
  transactions: number;
  total: number;
}

export interface EliminatedFee {
  description: string;
  category: string;
  amountUsd: number;
}

export interface MigrationCost {
  egressCost: number;
  restoreCost: number;
  total: number;
}

export interface CostModelResult {
  currentMonthly: CostBreakdown;
  b2Monthly: B2CostBreakdown;
  eliminatedFees: EliminatedFee[];
  newCosts: { description: string; amountUsd: number }[];
  migrationCost: MigrationCost;
  udmEnabled: boolean;
  udmCostToBackblaze: number;
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  breakEvenMonth: number | null;
}

export interface ProjectionPoint {
  month: number;
  currentCost: number;
  b2Cost: number;
  monthlySavings: number;
  cumulativeSavings: number;
}

export interface PricingDetectionResult {
  category: string;
  storageClass?: string;
  region?: string;
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

export interface DealSizing {
  monthlyB2Revenue: number;
  annualB2Revenue: number;
  termContractValue: number;
  termMonths: number;
}

export interface ReportSnapshot {
  id: string;
  analysisId: string;
  createdAt: string;
  trigger: 'pdf-download' | 'report-view';
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  totalStorageGb: number;
  migratedTierCount: number;
  b2PricePerTb: number;
  termMonths: number;
  udmEnabled: boolean;
}
