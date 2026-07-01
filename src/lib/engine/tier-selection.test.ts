import { describe, it, expect } from 'vitest';
import {
  applyTierSelectionConfig,
  getDefaultTierMigration,
  isHotStorageTier,
} from './tier-selection';
import { TIER_SELECTION_VERSION } from '@/types/analysis';
import type { ModelConfig, TierInventoryRow } from '@/types/analysis';

function tier(overrides: Partial<TierInventoryRow> = {}): TierInventoryRow {
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
    migrateToB2: false,
    ...overrides,
  };
}

function config(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    tierToggles: {},
    tierSelectionVersion: TIER_SELECTION_VERSION,
    egressConfig: {} as ModelConfig['egressConfig'],
    b2PricePerTb: 6,
    b2ServiceTier: 'committed',
    projectionTermMonths: 12,
    ...overrides,
  };
}

describe('isHotStorageTier / getDefaultTierMigration', () => {
  it('treats Standard as hot and Glacier as cold', () => {
    expect(isHotStorageTier('Standard')).toBe(true);
    expect(isHotStorageTier('Glacier Deep Archive')).toBe(false);
  });

  it('migrates a hot tier priced above B2 by default', () => {
    expect(getDefaultTierMigration('Standard', 23, 6)).toBe(true);
  });

  it('does not migrate a hot tier priced at/below B2', () => {
    expect(getDefaultTierMigration('Standard', 4, 6)).toBe(false);
  });

  it('does not migrate a cold tier by default even if pricey', () => {
    expect(getDefaultTierMigration('Glacier Deep Archive', 50, 6)).toBe(false);
  });
});

describe('applyTierSelectionConfig', () => {
  it('returns tiers unchanged when no config is supplied', () => {
    const tiers = [tier()];
    expect(applyTierSelectionConfig(tiers, null)).toEqual(tiers);
  });

  it('honors a saved boolean toggle at the current selection version', () => {
    const result = applyTierSelectionConfig(
      [tier({ migrateToB2: true })],
      config({ tierToggles: { 'aws|Standard|us-east-1': false } }),
    );
    expect(result[0].migrateToB2).toBe(false);
  });

  it('falls back to default migration when there is no saved toggle', () => {
    const result = applyTierSelectionConfig([tier()], config({ tierToggles: {} }));
    expect(result[0].migrateToB2).toBe(true); // hot + above B2 price
  });
});
