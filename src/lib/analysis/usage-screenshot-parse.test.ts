import { describe, it, expect } from 'vitest';
import { parseRawExtraction, deriveUsageFields } from './usage-screenshot-parse';

// Numbers taken from the real B2 usage summary an AE would upload (2026-06-02 → 2026-07-01):
// latest total stored 1,248,846.32 GB, earliest 1,108,200.04 GB, ~30 daily rows, $8,267.95 total.

describe('parseRawExtraction', () => {
  it('parses a clean JSON object', () => {
    const raw = parseRawExtraction('{"latestTotalStoredGb": 1248846.32, "earliestTotalStoredGb": 1108200.04, "daysInPeriod": 30, "monthlyTotalSpendUsd": 8267.95}');
    expect(raw).toEqual({
      latestTotalStoredGb: 1248846.32,
      earliestTotalStoredGb: 1108200.04,
      daysInPeriod: 30,
      monthlyTotalSpendUsd: 8267.95,
    });
  });

  it('tolerates surrounding prose and code fences', () => {
    const raw = parseRawExtraction('Here are the values:\n```json\n{"latestTotalStoredGb": 1000, "monthlyTotalSpendUsd": 500}\n```\nHope that helps.');
    expect(raw?.latestTotalStoredGb).toBe(1000);
    expect(raw?.monthlyTotalSpendUsd).toBe(500);
  });

  it('falls back earliest→latest and days→30 when those are null', () => {
    const raw = parseRawExtraction('{"latestTotalStoredGb": 1000, "earliestTotalStoredGb": null, "daysInPeriod": null, "monthlyTotalSpendUsd": 500}');
    expect(raw?.earliestTotalStoredGb).toBe(1000);
    expect(raw?.daysInPeriod).toBe(30);
  });

  it('returns null when a load-bearing field (storage or spend) is missing', () => {
    expect(parseRawExtraction('{"monthlyTotalSpendUsd": 500}')).toBeNull();
    expect(parseRawExtraction('{"latestTotalStoredGb": 1000}')).toBeNull();
  });

  it('returns null on non-JSON text', () => {
    expect(parseRawExtraction("I couldn't read the screenshot.")).toBeNull();
  });
});

describe('deriveUsageFields', () => {
  it('converts GB storage to decimal TB and passes spend through', () => {
    const fields = deriveUsageFields({
      latestTotalStoredGb: 1248846.32,
      earliestTotalStoredGb: 1248846.32,
      daysInPeriod: 30,
      monthlyTotalSpendUsd: 8267.95,
    });
    expect(fields.currentStorageTb).toBeCloseTo(1248.85, 2);
    expect(fields.currentMonthlySpendUsd).toBe(8267.95);
    expect(fields.dataGrowthMode).toBe('percent');
    expect(fields.dataGrowthPeriod).toBe('yearly');
    expect(fields.dataGrowthRatePercent).toBe(0); // no change over the window → 0% growth
  });

  it('annualizes an observed upward trend and clamps it to a sane ceiling', () => {
    const fields = deriveUsageFields({
      latestTotalStoredGb: 1248846.32,
      earliestTotalStoredGb: 1108200.04,
      daysInPeriod: 30,
      monthlyTotalSpendUsd: 8267.95,
    });
    // ~12.7%/month compounds to a very large annual figure; clamped to the 300% ceiling.
    expect(fields.dataGrowthRatePercent).toBe(300);
  });

  it('defaults growth to 10% when the trend cannot be derived', () => {
    const fields = deriveUsageFields({
      latestTotalStoredGb: 1000,
      earliestTotalStoredGb: 0,
      daysInPeriod: 1,
      monthlyTotalSpendUsd: 500,
    });
    expect(fields.dataGrowthRatePercent).toBe(10);
  });
});
