import { describe, it, expect } from 'vitest';
import { computeBusinessPotential, formatCapacityMultiplier } from './business-potential';
import type { TierInventoryRow } from '@/types/analysis';
import type { CostModelResult } from '@/types/model';

// ---- Synthetic fixtures (no customer data) ----

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
    modeledB2Cost: 6.95,
    delta: 16.05,
    migrateToB2: true,
    ...overrides,
  };
}

function costModel(overrides: Partial<CostModelResult> = {}): CostModelResult {
  return {
    currentMonthly: { storage: 0, egress: 0, operations: 0, retrieval: 0, otherFees: 0, total: 0 },
    b2Monthly: { storage: 0, egress: 0, transactions: 0, total: 0 },
    eliminatedFees: [],
    newCosts: [],
    partnerComputeScenario: null,
    migrationCost: { egressCost: 0, restoreCost: 0, total: 0 },
    udmEnabled: false,
    udmCostToBackblaze: 0,
    monthlySavings: 0,
    annualSavings: 0,
    savingsPercent: 0,
    breakEvenMonth: null,
    ...overrides,
  };
}

describe('computeBusinessPotential', () => {
  it('derives the capacity multiplier from the blended storage rate, not all-in cost', () => {
    // $23/TB storage even though totalTrueCost is higher; multiplier must use storage-only.
    const tiers = [storageTier({ gbStored: 1000, monthlyStorageCost: 23, totalTrueCost: 40 })];
    const result = computeBusinessPotential({
      migratedTiers: tiers,
      b2PricePerTb: 6.95,
      costModel: costModel({ savingsPercent: 70, annualSavings: 12000 }),
      cumulativeSavings: 36000,
    });

    expect(result.currentStoragePerTb).toBe(23);
    expect(result.b2StoragePerTb).toBe(6.95);
    expect(result.capacityMultiplier).toBeCloseTo(23 / 6.95, 4);
    expect(result.hasCapacityUnlock).toBe(true);
  });

  it('blends storage rate across multiple tiers by GB stored', () => {
    const tiers = [
      storageTier({ id: 'a', gbStored: 1000, monthlyStorageCost: 23 }),
      storageTier({ id: 'b', gbStored: 3000, monthlyStorageCost: 30 }),
    ];
    const result = computeBusinessPotential({
      migratedTiers: tiers,
      b2PricePerTb: 6.95,
      costModel: costModel(),
      cumulativeSavings: 0,
    });
    // (23 + 30) / (4000/1000) = 53 / 4 = 13.25 $/TB blended.
    expect(result.currentStoragePerTb).toBe(13.25);
  });

  it('does not claim a capacity unlock when the storage rate is at or below B2', () => {
    // Deep-archive style: $1/TB storage, below B2's flat rate — the win is elsewhere.
    const tiers = [storageTier({ gbStored: 5000, monthlyStorageCost: 5 })];
    const result = computeBusinessPotential({
      migratedTiers: tiers,
      b2PricePerTb: 6.95,
      costModel: costModel(),
      cumulativeSavings: 0,
    });
    expect(result.currentStoragePerTb).toBe(1);
    expect(result.capacityMultiplier).toBeLessThan(1);
    expect(result.hasCapacityUnlock).toBe(false);
  });

  it('sizes the free egress allowance at 3x migrated stored data', () => {
    const tiers = [
      storageTier({ id: 'a', gbStored: 1000 }),
      storageTier({ id: 'b', gbStored: 500 }),
    ];
    const result = computeBusinessPotential({
      migratedTiers: tiers,
      b2PricePerTb: 6.95,
      costModel: costModel(),
      cumulativeSavings: 0,
    });
    expect(result.freeEgressGbPerMonth).toBe(4500);
  });

  it('reads eliminated egress only from the egress-category fees', () => {
    const result = computeBusinessPotential({
      migratedTiers: [storageTier()],
      b2PricePerTb: 6.95,
      costModel: costModel({
        eliminatedFees: [
          { description: 'Storage costs for migrated tiers', category: 'storage', amountUsd: 23 },
          { description: 'Internet egress and replication fees', category: 'egress', amountUsd: 410.5 },
        ],
      }),
      cumulativeSavings: 0,
    });
    expect(result.eliminatedEgressMonthly).toBe(410.5);
  });

  it('reports no eliminated egress when the bill has none', () => {
    const result = computeBusinessPotential({
      migratedTiers: [storageTier()],
      b2PricePerTb: 6.95,
      costModel: costModel({
        eliminatedFees: [{ description: 'Storage', category: 'storage', amountUsd: 23 }],
      }),
      cumulativeSavings: 0,
    });
    expect(result.eliminatedEgressMonthly).toBe(0);
  });

  it('passes through reclaimed percent, annual, and cumulative savings as the capital figures', () => {
    const result = computeBusinessPotential({
      migratedTiers: [storageTier()],
      b2PricePerTb: 6.95,
      costModel: costModel({ savingsPercent: 68.4, annualSavings: 9876.54 }),
      cumulativeSavings: 29629.62,
    });
    expect(result.reclaimedPercent).toBe(68.4);
    expect(result.annualSavings).toBe(9876.54);
    expect(result.cumulativeSavings).toBe(29629.62);
    expect(result.hasReclaimableCapital).toBe(true);
  });

  it('degrades safely with no migrated tiers', () => {
    const result = computeBusinessPotential({
      migratedTiers: [],
      b2PricePerTb: 6.95,
      costModel: costModel(),
      cumulativeSavings: 0,
    });
    expect(result.currentStoragePerTb).toBe(0);
    expect(result.capacityMultiplier).toBe(0);
    expect(result.hasCapacityUnlock).toBe(false);
    expect(result.freeEgressGbPerMonth).toBe(0);
    expect(result.hasReclaimableCapital).toBe(false);
  });

  it('flags no reclaimable capital when cumulative savings are not positive', () => {
    const result = computeBusinessPotential({
      migratedTiers: [storageTier()],
      b2PricePerTb: 6.95,
      costModel: costModel(),
      cumulativeSavings: 0,
    });
    expect(result.hasReclaimableCapital).toBe(false);
  });
});

describe('formatCapacityMultiplier', () => {
  it('shows one decimal below 10x', () => {
    expect(formatCapacityMultiplier(3.31)).toBe('3.3×');
  });

  it('trims a trailing .0 to a whole number', () => {
    expect(formatCapacityMultiplier(4)).toBe('4×');
    expect(formatCapacityMultiplier(3.98)).toBe('4×');
  });

  it('rounds to whole numbers at or above 10x', () => {
    expect(formatCapacityMultiplier(12.4)).toBe('12×');
  });

  it('returns an em dash for non-positive or non-finite input', () => {
    expect(formatCapacityMultiplier(0)).toBe('—');
    expect(formatCapacityMultiplier(Number.NaN)).toBe('—');
  });
});
