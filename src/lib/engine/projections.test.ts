import { describe, it, expect } from 'vitest';
import { computeProjections } from './projections';

describe('computeProjections', () => {
  it('keeps savings flat under 0% growth and nets migration cost into cumulative', () => {
    const points = computeProjections({
      currentMonthlyCost: 100,
      b2MonthlyCost: 10,
      migrationCostTotal: 50,
      baseStorageGb: 1000,
      growthMode: 'percent',
      annualGrowthPercent: 0,
      fixedGrowthTbPerMonth: 0,
      termMonths: 12,
    });

    expect(points).toHaveLength(12);
    expect(points[0].storageGb).toBe(1000);
    expect(points[0].monthlySavings).toBe(90);
    expect(points[0].cumulativeSavings).toBe(40); // -50 migration + 90
    expect(points[11].cumulativeSavings).toBe(1030); // -50 + 90 * 12
  });

  it('scales cost with storage under fixed-TB growth', () => {
    const points = computeProjections({
      currentMonthlyCost: 100,
      b2MonthlyCost: 10,
      migrationCostTotal: 0,
      baseStorageGb: 1000,
      growthMode: 'fixed-tb',
      annualGrowthPercent: 0,
      fixedGrowthTbPerMonth: 1,
      termMonths: 3,
    });

    expect(points[0].storageGb).toBe(1000);
    expect(points[1].storageGb).toBe(2000); // +1 TB/month = +1000 GB
    expect(points[1].monthlySavings).toBe(180); // 2x scale of (100 - 10)
  });

  it('compounds storage under percent growth', () => {
    const points = computeProjections({
      currentMonthlyCost: 100,
      b2MonthlyCost: 0,
      migrationCostTotal: 0,
      baseStorageGb: 1000,
      growthMode: 'percent',
      annualGrowthPercent: 100,
      fixedGrowthTbPerMonth: 0,
      termMonths: 13,
    });

    // 100% annual growth ⇒ storage roughly doubles after 12 months.
    expect(points[12].storageGb).toBeCloseTo(2000, -1);
  });
});
