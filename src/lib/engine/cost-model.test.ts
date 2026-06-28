import { describe, it, expect } from 'vitest';
import {
  computeCostModel,
  getStorageScopeCurrentMonthly,
  getStorageScopeReplacementMonthly,
} from './cost-model';
import { DEFAULT_EGRESS_CONFIG } from '@/types/analysis';
import type { ParsedLineItem, TierInventoryRow } from '@/types/analysis';

function storageTier(overrides: Partial<TierInventoryRow> = {}): TierInventoryRow {
  return {
    id: 'aws|Standard|us-east-1',
    storageClass: 'Standard',
    provider: 'aws',
    region: 'us-east-1',
    gbStored: 1000,
    monthlyStorageCost: 23,
    effectivePerTb: 23,
    retrievalFees: 0,
    earlyDeletionFees: 0,
    monitoringFees: 0,
    operationsFees: 0,
    totalTrueCost: 23,
    modeledB2Cost: 6,
    delta: 17,
    migrateToB2: true,
    ...overrides,
  };
}

function storageLine(): ParsedLineItem {
  return {
    id: 'li-1',
    provider: 'aws',
    service: 'Amazon S3',
    region: 'us-east-1',
    sku: 'USE1-TimedStorage-ByteHrs',
    description: 'Standard storage',
    category: 'storage',
    storageClass: 'Standard',
    usageQuantity: 1000,
    usageUnit: 'GB-Mo',
    costUsd: 23,
    isEstimate: false,
    isEdited: false,
  };
}

describe('computeCostModel', () => {
  // $6/TB B2 price; one migrated Standard tier of 1000 GB costing $23/mo.
  const result = computeCostModel([storageLine()], [storageTier()], DEFAULT_EGRESS_CONFIG, 6);

  it('models B2 storage at price-per-TB / 1000 per GB', () => {
    expect(result.b2Monthly.storage).toBe(6);
  });

  it('derives monthly and annual savings (eliminated minus B2)', () => {
    expect(result.monthlySavings).toBe(17);
    expect(result.annualSavings).toBe(204);
  });

  it('computes savings percent against addressable spend', () => {
    expect(result.savingsPercent).toBeCloseTo(73.91, 1); // 17 / 23 * 100
  });

  it('reports the eliminated storage fee', () => {
    const storageFee = result.eliminatedFees.find((f) => f.category === 'storage');
    expect(storageFee?.amountUsd).toBe(23);
  });

  it('excludes non-migrated tiers entirely', () => {
    const noMigrate = computeCostModel(
      [storageLine()],
      [storageTier({ migrateToB2: false })],
      DEFAULT_EGRESS_CONFIG,
      6,
    );
    expect(noMigrate.monthlySavings).toBe(0);
    expect(noMigrate.b2Monthly.storage).toBe(0);
  });
});

describe('storage-scope helpers', () => {
  const result = computeCostModel([storageLine()], [storageTier()], DEFAULT_EGRESS_CONFIG, 6);

  it('current monthly equals the sum of eliminated fees', () => {
    expect(getStorageScopeCurrentMonthly(result)).toBe(23);
  });

  it('replacement monthly equals B2 total plus new costs', () => {
    expect(getStorageScopeReplacementMonthly(result)).toBe(result.b2Monthly.total);
  });
});
