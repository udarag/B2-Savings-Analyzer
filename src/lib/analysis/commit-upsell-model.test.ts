import { describe, it, expect } from 'vitest';
import { computeCommitUpsellView } from './commit-upsell-model';
import type { B2UsageInput } from '@/types/analysis';

function usage(overrides: Partial<B2UsageInput> = {}): B2UsageInput {
  return {
    currentStorageTb: 100,
    currentMonthlySpendUsd: 695, // implies $6.95/TB, matching B2 list price
    dataGrowthMode: 'percent',
    dataGrowthRatePercent: 10,
    dataGrowthFixedTbPerMonth: 0,
    dataGrowthPeriod: 'yearly',
    targetTier: 'committed',
    committedDiscountPercent: 0,
    source: 'manual',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('computeCommitUpsellView', () => {
  it('reads current/target throughput specs from the tier data', () => {
    const view = computeCommitUpsellView(usage());
    expect(view.currentSpec.tier).toBe('uncommitted');
    expect(view.targetSpec.tier).toBe('committed');
    expect(view.currentSpec.throughputGbitPut).toBe(4);
    expect(view.targetSpec.throughputGbitPut).toBe(50);
  });

  it('models Committed as flat $/TB when no discount is entered', () => {
    const view = computeCommitUpsellView(usage());
    expect(view.projectedTargetMonthlyCostUsd).toBeCloseTo(695, 2);
    expect(view.monthlyDeltaUsd).toBeCloseTo(0, 2);
  });

  it('applies an AE-entered Committed discount off the implied current rate', () => {
    const view = computeCommitUpsellView(usage({ committedDiscountPercent: 10 }));
    expect(view.projectedTargetMonthlyCostUsd).toBeCloseTo(625.5, 2); // 695 * 0.9
    expect(view.monthlyDeltaUsd).toBeCloseTo(69.5, 2);
  });

  it('targets Overdrive using its starting rate, not the customer implied rate', () => {
    const view = computeCommitUpsellView(usage({ targetTier: 'overdrive' }));
    expect(view.targetSpec.tier).toBe('overdrive');
    expect(view.projectedTargetMonthlyCostUsd).toBeCloseTo(1500, 2); // 100 TB * $15/TB
    expect(view.monthlyDeltaUsd).toBeLessThan(0); // honestly reported as a cost increase
  });

  it('produces a 12-month projection series honoring the growth assumption', () => {
    const view = computeCommitUpsellView(usage());
    expect(view.projections).toHaveLength(12);
    expect(view.projections[0].storageGb).toBeCloseTo(100 * 1000, 2);
    expect(view.projections[11].storageGb).toBeGreaterThan(view.projections[0].storageGb);
  });

  it('does not divide by zero when current storage is zero', () => {
    const view = computeCommitUpsellView(usage({ currentStorageTb: 0, currentMonthlySpendUsd: 0 }));
    expect(view.projectedTargetMonthlyCostUsd).toBe(0);
    expect(Number.isFinite(view.monthlyDeltaUsd)).toBe(true);
  });
});
