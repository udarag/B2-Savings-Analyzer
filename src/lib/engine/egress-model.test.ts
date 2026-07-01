import { describe, it, expect } from 'vitest';
import { computeEgressModel } from './egress-model';
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

function egressLine(): ParsedLineItem {
  return {
    id: 'li-egress',
    provider: 'aws',
    service: 'Amazon S3',
    region: 'us-east-1',
    sku: 'egress',
    description: 'Internet Egress',
    category: 'egress',
    subcategory: 'Internet Egress',
    usageQuantity: 500,
    usageUnit: 'GB',
    costUsd: 45,
    isEstimate: false,
    isEdited: false,
  };
}

// 1000 GB stored, so the free allowance is 3000 GB/mo (b2.egress.freeMultiplier). Serving well over
// that volume gives every test a real overage to observe unless unlimitedEgress short-circuits it.
const heavyUsageConfig = { ...DEFAULT_EGRESS_CONFIG, gbPerMonthServedToUsers: 100_000 };

describe('unlimitedEgress parameter', () => {
  it('defaults to metered egress when omitted', () => {
    const result = computeEgressModel([egressLine()], [storageTier()], heavyUsageConfig);
    expect(result.unlimitedEgress).toBe(false);
    expect(result.b2EgressCost).toBeGreaterThan(0);
  });

  it('zeroes b2EgressCost when true, regardless of volume', () => {
    const result = computeEgressModel([egressLine()], [storageTier()], heavyUsageConfig, true);
    expect(result.b2EgressCost).toBe(0);
  });

  it('echoes unlimitedEgress on the result', () => {
    const withUnlimited = computeEgressModel([egressLine()], [storageTier()], heavyUsageConfig, true);
    const withoutUnlimited = computeEgressModel([egressLine()], [storageTier()], heavyUsageConfig, false);
    expect(withUnlimited.unlimitedEgress).toBe(true);
    expect(withoutUnlimited.unlimitedEgress).toBe(false);
  });

  it('does not affect eliminatedEgressCost / migrationEgressCost (source-side costs are independent of destination tier)', () => {
    const withUnlimited = computeEgressModel([egressLine()], [storageTier()], heavyUsageConfig, true);
    const withoutUnlimited = computeEgressModel([egressLine()], [storageTier()], heavyUsageConfig, false);
    expect(withUnlimited.eliminatedEgressCost).toBe(withoutUnlimited.eliminatedEgressCost);
    expect(withUnlimited.migrationEgressCost).toBe(withoutUnlimited.migrationEgressCost);
  });
});
