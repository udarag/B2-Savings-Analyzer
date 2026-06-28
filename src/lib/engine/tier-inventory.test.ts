import { describe, it, expect } from 'vitest';
import { buildTierInventory } from './tier-inventory';
import type { ParsedLineItem } from '@/types/analysis';

function storageLine(
  storageClass: string,
  region: string,
  gbStored: number,
  costUsd: number,
): ParsedLineItem {
  return {
    id: `${storageClass}-${region}-${costUsd}`,
    provider: 'aws',
    service: 'Amazon S3',
    region,
    sku: '',
    description: storageClass,
    category: 'storage',
    storageClass,
    usageQuantity: gbStored,
    usageUnit: 'GB-Mo',
    costUsd,
    isEstimate: false,
    isEdited: false,
  };
}

describe('buildTierInventory', () => {
  it('groups storage line items by storage class and region', () => {
    const rows = buildTierInventory(
      [
        storageLine('Standard', 'us-east-1', 1000, 23),
        storageLine('Standard', 'us-east-1', 500, 11.5),
        storageLine('Glacier Flexible Retrieval', 'us-east-1', 2000, 8),
      ],
      6,
    );

    const standard = rows.find((r) => r.storageClass === 'Standard');
    expect(standard?.gbStored).toBe(1500);
    expect(standard?.monthlyStorageCost).toBe(34.5);
    expect(standard?.effectivePerTb).toBe(23); // 34.5 / 1500 * 1000
    expect(rows).toHaveLength(2);
  });

  it('defaults a hot tier priced above B2 to migrate', () => {
    const rows = buildTierInventory([storageLine('Standard', 'us-east-1', 1000, 23)], 6);
    expect(rows[0].migrateToB2).toBe(true);
  });

  it('sorts rows by monthly storage cost descending', () => {
    const rows = buildTierInventory(
      [
        storageLine('Standard', 'us-east-1', 100, 5),
        storageLine('Standard-IA', 'us-east-1', 5000, 50),
      ],
      6,
    );
    expect(rows[0].monthlyStorageCost).toBeGreaterThanOrEqual(rows[1].monthlyStorageCost);
  });
});
