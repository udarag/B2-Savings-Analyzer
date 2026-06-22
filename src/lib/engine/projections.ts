import type { ProjectionPoint } from '@/types/model';

export interface ProjectionConfig {
  currentMonthlyCost: number;
  b2MonthlyCost: number;
  migrationCostTotal: number;
  annualGrowthPercent: number;
  termMonths: number;
}

export function computeProjections(config: ProjectionConfig): ProjectionPoint[] {
  const {
    currentMonthlyCost,
    b2MonthlyCost,
    migrationCostTotal,
    annualGrowthPercent,
    termMonths,
  } = config;

  const monthlyGrowthRate = Math.pow(1 + annualGrowthPercent / 100, 1 / 12) - 1;
  const points: ProjectionPoint[] = [];
  let cumulativeSavings = -migrationCostTotal;

  for (let month = 1; month <= termMonths; month++) {
    const growthFactor = Math.pow(1 + monthlyGrowthRate, month - 1);
    const currentCost = round2(currentMonthlyCost * growthFactor);
    const b2Cost = round2(b2MonthlyCost * growthFactor);
    const monthlySavings = round2(currentCost - b2Cost);
    cumulativeSavings += monthlySavings;

    points.push({
      month,
      currentCost,
      b2Cost,
      monthlySavings,
      cumulativeSavings: round2(cumulativeSavings),
    });
  }

  return points;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
