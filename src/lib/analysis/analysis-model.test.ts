import { describe, it, expect } from 'vitest';
import { buildTierState, computeAnalysisView } from './analysis-model';
import { buildAnalysisSnapshot } from './rerun';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { applyTierSelectionConfig } from '@/lib/engine/tier-selection';
import {
  computeCostModel,
  getStorageScopeCurrentMonthly,
  getStorageScopeReplacementMonthly,
} from '@/lib/engine/cost-model';
import { computeProjections } from '@/lib/engine/projections';
import { detectCustomPricing } from '@/lib/pricing/detection';
import {
  DEFAULT_EGRESS_CONFIG,
  TIER_SELECTION_VERSION,
  normalizeEgressConfig,
} from '@/types/analysis';
import type { EgressConfig, ModelConfig, ParsedBill, ParsedLineItem } from '@/types/analysis';

// ---- Representative synthetic bill (no customer data) ----
function lineItem(
  o: Partial<ParsedLineItem> & Pick<ParsedLineItem, 'sku' | 'category' | 'costUsd'>,
): ParsedLineItem {
  return {
    id: `li-${o.sku}`,
    provider: 'aws',
    service: 'Amazon S3',
    region: 'us-east-1',
    description: '',
    usageUnit: 'GB-Mo',
    isEstimate: false,
    isEdited: false,
    ...o,
  };
}

const PARSED: ParsedBill = {
  lineItems: [
    lineItem({ sku: 'std', category: 'storage', storageClass: 'Standard', usageQuantity: 10000, costUsd: 230 }),
    lineItem({ sku: 'sia', category: 'storage', storageClass: 'Standard-IA', usageQuantity: 5000, costUsd: 62.5 }),
    lineItem({ sku: 'gla', category: 'storage', storageClass: 'Glacier Flexible Retrieval', usageQuantity: 20000, costUsd: 72 }),
    lineItem({ sku: 'egr', category: 'egress', subcategory: 'Internet Egress', usageQuantity: 1000, costUsd: 90 }),
    lineItem({ sku: 'put', category: 'operations', subcategory: 'PUT/COPY/POST/LIST', costUsd: 12 }),
    lineItem({ sku: 'ret', category: 'retrieval', storageClass: 'Standard-IA', costUsd: 4 }),
  ],
  grandTotal: 470.5,
  parseConfidence: 0.95,
  warnings: [],
  discounts: [{ name: 'EDP', amountUsd: 50, storageAmountUsd: 40 }],
};

function modelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    tierToggles: {},
    tierSelectionVersion: TIER_SELECTION_VERSION,
    egressConfig: { ...DEFAULT_EGRESS_CONFIG, dataGrowthMode: 'percent', dataGrowthRatePercent: 20 },
    b2PricePerTb: 6,
    b2ServiceTier: 'committed',
    projectionTermMonths: 36,
    pricingDiscountConfirmed: false,
    ...overrides,
  };
}

// Replicates the exact chain the dashboard & report run today.
function legacyView(parsed: ParsedBill, cfg: ModelConfig) {
  const tiers = applyTierSelectionConfig(buildTierInventory(parsed.lineItems, cfg.b2PricePerTb), cfg);
  const egressConfig = normalizeEgressConfig(cfg.egressConfig);
  const costModel = computeCostModel(parsed.lineItems, tiers, egressConfig, cfg.b2PricePerTb, cfg.b2ServiceTier);
  const baseStorageGb = tiers.filter((t) => t.migrateToB2).reduce((s, t) => s + t.gbStored, 0);
  const projections = computeProjections({
    currentMonthlyCost: getStorageScopeCurrentMonthly(costModel),
    b2MonthlyCost: getStorageScopeReplacementMonthly(costModel),
    migrationCostTotal: costModel.migrationCost.total,
    baseStorageGb,
    growthMode: egressConfig.dataGrowthMode,
    annualGrowthPercent: egressConfig.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: egressConfig.dataGrowthFixedTbPerMonth,
    termMonths: cfg.projectionTermMonths,
  });
  const pricingDetection = detectCustomPricing(parsed.lineItems, parsed.discounts);
  return { tiers, costModel, projections, pricingDetection, baseStorageGb };
}

describe('buildTierState matches the legacy tier build (current-version config)', () => {
  const cfg = modelConfig({
    tierToggles: { 'aws|Standard|us-east-1': true, 'aws|Standard-IA|us-east-1': false },
  });

  it('produces identical tiers', () => {
    expect(buildTierState(PARSED, cfg).tiers).toEqual(legacyView(PARSED, cfg).tiers);
  });

  it('re-derives tierToggles from the selected tiers and stamps the version', () => {
    const { tiers, modelConfig: norm } = buildTierState(PARSED, cfg);
    expect(norm.tierSelectionVersion).toBe(TIER_SELECTION_VERSION);
    expect(norm.tierToggles).toEqual(Object.fromEntries(tiers.map((t) => [t.id, t.migrateToB2])));
  });
});

describe('computeAnalysisView matches the legacy dashboard/report chain', () => {
  const scenarios: Array<{ name: string; cfg: ModelConfig }> = [
    { name: 'percent growth, default toggles', cfg: modelConfig() },
    {
      name: 'fixed-tb growth',
      cfg: modelConfig({
        egressConfig: { ...DEFAULT_EGRESS_CONFIG, dataGrowthMode: 'fixed-tb', dataGrowthFixedTbPerMonth: 2 } as EgressConfig,
      }),
    },
    {
      name: 'explicit toggles incl. cold tiers',
      cfg: modelConfig({
        tierToggles: {
          'aws|Standard|us-east-1': true,
          'aws|Standard-IA|us-east-1': true,
          'aws|Glacier Flexible Retrieval|us-east-1': false,
        },
      }),
    },
    {
      name: 'hyperscaler egress',
      cfg: modelConfig({
        egressConfig: normalizeEgressConfig({
          ...DEFAULT_EGRESS_CONFIG,
          hasHyperscalerCompute: true,
          hyperscalerComputeFeedsStorage: true,
          gbPerMonthHyperscalerToB2: 500,
          gbPerMonthServedToUsers: 2000,
        }),
      }),
    },
    {
      name: 'overdrive tier (unlimited egress)',
      cfg: modelConfig({
        b2ServiceTier: 'overdrive',
        b2PricePerTb: 15,
        egressConfig: normalizeEgressConfig({ ...DEFAULT_EGRESS_CONFIG, gbPerMonthServedToUsers: 200000 }),
      }),
    },
  ];

  for (const { name, cfg } of scenarios) {
    it(name, () => {
      const legacy = legacyView(PARSED, cfg);
      // Feed the legacy tiers so this isolates the view-chain equivalence.
      const view = computeAnalysisView({
        lineItems: PARSED.lineItems,
        discounts: PARSED.discounts,
        tiers: legacy.tiers,
        egressConfig: normalizeEgressConfig(cfg.egressConfig),
        b2PricePerTb: cfg.b2PricePerTb,
        b2ServiceTier: cfg.b2ServiceTier,
        termMonths: cfg.projectionTermMonths,
      });
      expect(view.costModel).toEqual(legacy.costModel);
      expect(view.projections).toEqual(legacy.projections);
      expect(view.pricingDetection).toEqual(legacy.pricingDetection);
      expect(view.migratedStorageGb).toBe(legacy.baseStorageGb);
    });
  }
});

describe('buildAnalysisSnapshot stays consistent with the shared computeAnalysisView', () => {
  it('derives its numbers from the same path', () => {
    const cfg = modelConfig();
    const { tiers, modelConfig: norm } = buildTierState(PARSED, cfg);
    const view = computeAnalysisView({
      lineItems: PARSED.lineItems,
      discounts: PARSED.discounts,
      tiers,
      egressConfig: norm.egressConfig,
      b2PricePerTb: norm.b2PricePerTb,
      b2ServiceTier: norm.b2ServiceTier,
      termMonths: norm.projectionTermMonths,
    });

    const { snapshot } = buildAnalysisSnapshot({
      analysisId: 'fixed-id',
      parsed: PARSED,
      modelConfig: cfg,
      trigger: 'report-view',
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(snapshot.monthlySavings).toBe(view.costModel.monthlySavings);
    expect(snapshot.annualSavings).toBe(view.costModel.annualSavings);
    expect(snapshot.savingsPercent).toBe(view.costModel.savingsPercent);
    expect(snapshot.totalStorageGb).toBe(view.migratedStorageGb);
    expect(snapshot.migratedTierCount).toBe(view.migratedTiers.length);
  });
});
