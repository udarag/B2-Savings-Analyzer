import type {
  EgressConfig,
  ModelConfig,
  NamedDiscount,
  ParsedBill,
  ParsedLineItem,
  TierInventoryRow,
} from '@/types/analysis';
import {
  DEFAULT_MODEL_CONFIG,
  TIER_SELECTION_VERSION,
  normalizeEgressConfig,
} from '@/types/analysis';
import type { CostModelResult, ProjectionPoint, PricingDetectionResult } from '@/types/model';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { applyTierSelectionConfig } from '@/lib/engine/tier-selection';
import {
  computeCostModel,
  getStorageScopeCurrentMonthly,
  getStorageScopeReplacementMonthly,
} from '@/lib/engine/cost-model';
import { computeProjections } from '@/lib/engine/projections';
import { detectCustomPricing } from '@/lib/pricing/detection';

// Single, pure source of truth for assembling an analysis model and computing its
// outputs. Importable by both client components (dashboard, report) and server
// code (rerun, upload) — it pulls in only pure engine/pricing helpers, never
// storage or other server-only modules. Keeping this here prevents the cost-model
// /projection/pricing chain from being hand-duplicated (and drifting) per surface.

export interface AnalysisTierState {
  tiers: TierInventoryRow[];
  /** The stored config, normalized: defaults filled, toggles re-derived from the
   *  selected tiers, and stamped to the current tier-selection version. */
  modelConfig: ModelConfig;
}

export interface AnalysisViewInput {
  lineItems: ParsedLineItem[];
  discounts?: NamedDiscount[];
  tiers: TierInventoryRow[];
  /** Expected already-normalized (callers hold a normalized EgressConfig). */
  egressConfig: EgressConfig;
  b2PricePerTb: number;
  termMonths: number;
}

export interface AnalysisView {
  costModel: CostModelResult;
  projections: ProjectionPoint[];
  pricingDetection: PricingDetectionResult[];
  migratedTiers: TierInventoryRow[];
  migratedStorageGb: number;
}

/** Fill defaults and coerce a stored (possibly partial/legacy) ModelConfig to a
 *  complete, current-version one. Previously private to rerun.ts. */
export function normalizeModelConfig(modelConfig?: ModelConfig | null): ModelConfig {
  return {
    ...DEFAULT_MODEL_CONFIG,
    ...modelConfig,
    tierToggles: modelConfig?.tierToggles ?? {},
    egressConfig: normalizeEgressConfig(modelConfig?.egressConfig),
    b2PricePerTb: readPositiveNumber(modelConfig?.b2PricePerTb, DEFAULT_MODEL_CONFIG.b2PricePerTb),
    projectionTermMonths: readPositiveNumber(
      modelConfig?.projectionTermMonths,
      DEFAULT_MODEL_CONFIG.projectionTermMonths,
    ),
    pricingDiscountConfirmed: Boolean(modelConfig?.pricingDiscountConfirmed),
  };
}

/** Build the tier inventory with the stored selection applied, plus the normalized
 *  config (toggles re-derived from the resulting tiers). Used for initial dashboard
 *  state, the report, rerun, and new uploads. */
export function buildTierState(
  parsed: ParsedBill,
  storedModelConfig?: ModelConfig | null,
): AnalysisTierState {
  const modelConfig = normalizeModelConfig(storedModelConfig);
  const tiers = applyTierSelectionConfig(
    buildTierInventory(parsed.lineItems, modelConfig.b2PricePerTb),
    modelConfig,
  );
  // Re-derive toggles from the tiers that selection actually produced (a stored toggle for a tier
  // that no longer exists is dropped), and stamp the current version so future loads skip
  // re-normalization. See TIER_SELECTION_VERSION for the gate.
  const nextModelConfig: ModelConfig = {
    ...modelConfig,
    tierToggles: Object.fromEntries(tiers.map((tier) => [tier.id, tier.migrateToB2])),
    tierSelectionVersion: TIER_SELECTION_VERSION,
  };
  return { tiers, modelConfig: nextModelConfig };
}

/** Compute every output the dashboard and customer report render from the current
 *  inputs: cost model, projections, pricing detection, and migrated-storage rollup.
 *  This is the chain that was copy-pasted across the dashboard, report, and rerun. */
export function computeAnalysisView({
  lineItems,
  discounts,
  tiers,
  egressConfig,
  b2PricePerTb,
  termMonths,
}: AnalysisViewInput): AnalysisView {
  const costModel = computeCostModel(lineItems, tiers, egressConfig, b2PricePerTb);
  const migratedTiers = tiers.filter((tier) => tier.migrateToB2);
  const migratedStorageGb = migratedTiers.reduce((sum, tier) => sum + tier.gbStored, 0);
  const projections = computeProjections({
    currentMonthlyCost: getStorageScopeCurrentMonthly(costModel),
    b2MonthlyCost: getStorageScopeReplacementMonthly(costModel),
    migrationCostTotal: costModel.migrationCost.total,
    baseStorageGb: migratedStorageGb,
    growthMode: egressConfig.dataGrowthMode,
    annualGrowthPercent: egressConfig.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: egressConfig.dataGrowthFixedTbPerMonth,
    termMonths,
  });
  const pricingDetection = detectCustomPricing(lineItems, discounts);
  return { costModel, projections, pricingDetection, migratedTiers, migratedStorageGb };
}

// Coerce a stored value to a positive number, falling back when it's missing, non-numeric, zero, or
// negative. Guards against legacy/corrupt configs feeding a 0 price or term into the cost model.
function readPositiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
