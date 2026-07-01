// Shared, dependency-free helpers for turning a customer's B2 usage export (PDF or screenshot) into
// the fields B2UsageForm pre-fills. Both the deterministic PDF parser and the Claude-vision image
// parser read a few raw cells into a RawExtraction, then call deriveUsageFields — so the GB→TB,
// spend, and growth logic lives in exactly one place. No SDK/Node imports here, so the client can
// `import type { ParsedUsageFields }` from it without pulling anything into the bundle.
import type { B2UsageInput } from '@/types/analysis';

/** What the AE-facing form needs pre-filled — a subset of B2UsageInput. `source` is stamped by the caller. */
export type ParsedUsageFields = Pick<
  B2UsageInput,
  'currentStorageTb' | 'currentMonthlySpendUsd' | 'dataGrowthMode' | 'dataGrowthRatePercent' | 'dataGrowthPeriod'
>;

/** The raw cell readings both parsers produce; deriveUsageFields turns these into ParsedUsageFields. */
export interface RawExtraction {
  /** Most recent (or estimate) row's "total stored", in GB. */
  latestTotalStoredGb: number;
  /** Oldest row's "total stored", in GB — used with latest to derive the growth trend. */
  earliestTotalStoredGb: number;
  /** Number of days the table spans. */
  daysInPeriod: number;
  /** The summary-row grand "total" spend for the whole period, in USD. */
  monthlyTotalSpendUsd: number;
}

/** Turn the raw cell readings into the form's fields. */
export function deriveUsageFields(raw: RawExtraction): ParsedUsageFields {
  // App basis is decimal TB (1 TB = 1000 GB), matching every other TB figure in the app.
  const currentStorageTb = round2(raw.latestTotalStoredGb / 1000);

  // Annualize the observed storage trend by compounding the per-day growth over a year. Clamped to a
  // sane ceiling so a short, noisy window can't seed an absurd default; the AE reviews and edits it.
  let dataGrowthRatePercent = 10;
  if (raw.earliestTotalStoredGb > 0 && raw.daysInPeriod > 1 && raw.latestTotalStoredGb > 0) {
    const dailyRate = Math.pow(raw.latestTotalStoredGb / raw.earliestTotalStoredGb, 1 / raw.daysInPeriod) - 1;
    const annualPercent = (Math.pow(1 + dailyRate, 365) - 1) * 100;
    dataGrowthRatePercent = Math.round(Math.min(Math.max(annualPercent, 0), 300));
  }

  return {
    currentStorageTb,
    currentMonthlySpendUsd: round2(raw.monthlyTotalSpendUsd),
    dataGrowthMode: 'percent',
    dataGrowthRatePercent,
    dataGrowthPeriod: 'yearly',
  };
}

/** Coerce a value to a finite positive number, else null. */
export function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
