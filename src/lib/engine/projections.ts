import type { ProjectionPoint } from '@/types/model';
import type { EgressConfig } from '@/types/analysis';

// Projects cost and cumulative savings over the contract term, growing storage (and therefore
// both current and B2 spend) month by month. Drives the savings-over-time chart in the report.

export interface ProjectionConfig {
  /** Total month-0 spend in the addressable storage scope (current provider). */
  currentMonthlyCost: number;
  b2MonthlyCost: number;
  /** One-time migration cost, seeded as negative cumulative savings in month 1 (skip if UDM-covered). */
  migrationCostTotal: number;
  baseStorageGb: number;
  growthMode: EgressConfig['dataGrowthMode'];
  /** Compound annual growth %, used when growthMode is 'percent'. */
  annualGrowthPercent: number;
  /** Linear TB added per month, used when growthMode is 'fixed-tb'. */
  fixedGrowthTbPerMonth: number;
  termMonths: number;
}

/** Build a per-month projection series (1..termMonths) of current vs B2 cost and cumulative savings. */
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
  // Start the running total in the red by the migration cost; break-even is where it crosses zero.
  let cumulativeSavings = -migrationCostTotal;

  for (let month = 1; month <= termMonths; month++) {
    const projectedStorageGb = projectStorageGbForMonth({
      baseStorageGb,
      fixedGrowthTbPerMonth,
      annualGrowthPercent,
      growthMode,
      month,
    });
    // Scale both current and B2 monthly cost by the storage-growth factor — costs are assumed to
    // grow with stored data, so the per-month savings rate stays proportional rather than fixed.
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

/** Human-readable one-liner describing the growth assumption, for the report's methodology note. */
export function formatGrowthAssumption(config: Pick<ProjectionConfig, 'growthMode' | 'annualGrowthPercent' | 'fixedGrowthTbPerMonth'>): string {
  if (config.growthMode === 'fixed-tb') {
    return `${config.fixedGrowthTbPerMonth.toLocaleString(undefined, { maximumFractionDigits: 2 })} TB/month fixed growth`;
  }

  return `${config.annualGrowthPercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% annual growth`;
}

/** Projected stored GB at a given month (month 1 = base). Exported so callers can size end-of-term storage. */
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
    // TB input is decimal-TB (x1000), matching the app's GB basis — not GiB/TiB.
    const fixedGrowthGbPerMonth = fixedGrowthTbPerMonth * 1000;
    return baseStorageGb + fixedGrowthGbPerMonth * (month - 1);
  }

  // Convert the annual rate to an equivalent monthly compounding rate (12th root), then compound
  // from month 1 — so the stated annual % is hit exactly at month 13, not applied linearly.
  const monthlyGrowthRate = Math.pow(1 + annualGrowthPercent / 100, 1 / 12) - 1;
  return baseStorageGb * Math.pow(1 + monthlyGrowthRate, month - 1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
