import { describe, it, expect } from 'vitest';
import type { ParsedLineItem } from '@/types/analysis';
import { detectCustomPricing } from './detection';

// A storage line cheap enough per GB to read as a deep discount against AWS Standard list.
function deepDiscountStorage(region: string): ParsedLineItem {
  return {
    id: 'x',
    provider: 'aws',
    service: 'Amazon Simple Storage Service',
    region,
    sku: 'X-TimedStorage-ByteHrs',
    description: 'd',
    category: 'storage',
    storageClass: 'Standard',
    usageQuantity: 1000,
    usageUnit: 'GB-Mo',
    costUsd: 1.0,
    isEstimate: false,
    isEdited: false,
  };
}

describe('detectCustomPricing region-fallback guard', () => {
  it('emits a per-tier discount verdict for a resolved region', () => {
    const results = detectCustomPricing([deepDiscountStorage('us-east-1')]);
    const storage = results.filter((r) => r.category === 'storage');
    expect(storage).toHaveLength(1);
    expect(storage[0].assessment).toBe('custom-agreement');
  });

  it('emits NO per-tier verdict when the region is a fallback sentinel (no phantom discount)', () => {
    for (const region of ['GLOBAL', 'All Regions', 'Unknown', 'unknown']) {
      const results = detectCustomPricing([deepDiscountStorage(region)]);
      expect(results.filter((r) => r.category === 'storage')).toHaveLength(0);
    }
  });

  it('still emits named discount-program results regardless of fallback region', () => {
    const results = detectCustomPricing(
      [deepDiscountStorage('GLOBAL')],
      [{ name: 'Enterprise Discount Program', amountUsd: 500 }],
    );
    expect(results.some((r) => r.category === 'discount-program')).toBe(true);
    expect(results.filter((r) => r.category === 'storage')).toHaveLength(0);
  });
});
