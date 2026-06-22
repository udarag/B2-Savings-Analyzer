import type { ProjectionPoint } from '@/types/model';
import type { EgressConfig } from '@/types/analysis';

export interface ProjectionConfig {
  currentMonthlyCost: number;
  b2MonthlyCost: number;
  migrationCostTotal: number;
  baseStorageGb: number;
  growthMode: EgressConfig['dataGrowthMode'];
  annualGrowthPercent: number;
  fixedGrowthTbPerMonth: number;
  termMonths: number;
}

export function computeProjections(config: ProjectionConfig): ProjectionPoint[] {
  const {
    currentMonthlyCost,
    b2MonthlyCost,
    migrationCostTotal,
    baseStorageGb,
    growthMode,
    annualGrowthPercent,
    fixedGrowthTbPerMonth,
    termMonths,
  } = config;

  const points: ProjectionPoint[] = [];
  let cumulativeSavings = -migrationCostTotal;

  for (let month = 1; month <= termMonths; month++) {
    const projectedStorageGb = projectStorageGbForMonth({
      baseStorageGb,
      fixedGrowthTbPerMonth,
      annualGrowthPercent,
      growthMode,
      month,
    });
    const growthFactor = baseStorageGb > 0 ? projectedStorageGb / baseStorageGb : 1;
    const currentCost = round2(currentMonthlyCost * growthFactor);
    const b2Cost = round2(b2MonthlyCost * growthFactor);
    const monthlySavings = round2(currentCost - b2Cost);
    cumulativeSavings += monthlySavings;

    points.push({
      month,
      storageGb: round2(projectedStorageGb),
      currentCost,
      b2Cost,
      monthlySavings,
      cumulativeSavings: round2(cumulativeSavings),
    });
  }

  return points;
}

export function formatGrowthAssumption(config: Pick<ProjectionConfig, 'growthMode' | 'annualGrowthPercent' | 'fixedGrowthTbPerMonth'>): string {
  if (config.growthMode === 'fixed-tb') {
    return `${config.fixedGrowthTbPerMonth.toLocaleString(undefined, { maximumFractionDigits: 2 })} TB/month fixed growth`;
  }

  return `${config.annualGrowthPercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% annual growth`;
}

export function projectStorageGbForMonth({
  baseStorageGb,
  fixedGrowthTbPerMonth,
  annualGrowthPercent,
  growthMode,
  month,
}: {
  baseStorageGb: number;
  fixedGrowthTbPerMonth: number;
  annualGrowthPercent: number;
  growthMode: EgressConfig['dataGrowthMode'];
  month: number;
}): number {
  if (growthMode === 'fixed-tb') {
    const fixedGrowthGbPerMonth = fixedGrowthTbPerMonth * 1000;
    return baseStorageGb + fixedGrowthGbPerMonth * (month - 1);
  }

  const monthlyGrowthRate = Math.pow(1 + annualGrowthPercent / 100, 1 / 12) - 1;
  return baseStorageGb * Math.pow(1 + monthlyGrowthRate, month - 1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
