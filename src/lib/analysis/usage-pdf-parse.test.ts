import { describe, it, expect } from 'vitest';
import { parseUsagePdfText } from './usage-pdf-parse';

// Synthetic fixture (no real customer data) mirroring the pdftotext -layout output of a Bzadmin
// "Usage" page print: a title with a date range, daily rows whose "total stored" column holds the
// large cumulative GB values, per-day upload/download volumes, $ money columns, and a summary row
// whose last dollar amount is the period grand total.
const USAGE_PDF_TEXT = `
          Priced Usage Days for account testacct12
          (2026-01-01 to 2026-01-31)

          > 2026-01-31          6,000.00                    900.00  10.00  560,000.00
            ESTIMATE  99.9995   GB      -   1.00 GB          GB      GB     GB          $9.00   $130.00  -  $150.00
          > 2026-01-15  99.99   5,500.00 GB  -  1.00 GB      850.00 GB  10.00 GB  530,000.00 GB  $8.50  $123.00  -  $140.00
          > 2026-01-01  100     5,000.00 GB  -  1.00 GB      800.00 GB  10.00 GB  500,000.00 GB  $8.00  $116.00  -  $130.00
          summary               150,000.00   -   30.00 GB   20,000.00  -  -  $250.00  $3,500.00  -  $4,321.00
`;

describe('parseUsagePdfText', () => {
  const parsed = parseUsagePdfText(USAGE_PDF_TEXT);

  it('reads the monthly spend from the summary row grand total (last dollar amount)', () => {
    expect(parsed?.currentMonthlySpendUsd).toBe(4321);
  });

  it('reads current storage from the largest total-stored value, converted to TB', () => {
    expect(parsed?.currentStorageTb).toBe(560); // 560,000 GB / 1000
  });

  it('derives a positive, clamped annual growth from the total-stored trend', () => {
    expect(parsed?.dataGrowthMode).toBe('percent');
    expect(parsed?.dataGrowthPeriod).toBe('yearly');
    expect(parsed?.dataGrowthRatePercent).toBeGreaterThan(0);
    expect(parsed?.dataGrowthRatePercent).toBeLessThanOrEqual(300);
  });

  it('ignores per-day upload/download volumes when picking current storage', () => {
    // 6,000 / 20,000 etc. must not be mistaken for the cumulative total-stored figure.
    expect(parsed?.currentStorageTb).not.toBe(6); // would be 6,000 GB → 6 TB if upload leaked in
  });

  it('returns null when there is no summary row', () => {
    const noSummary = USAGE_PDF_TEXT.split('\n').filter((l) => !/summary/i.test(l)).join('\n');
    expect(parseUsagePdfText(noSummary)).toBeNull();
  });

  it('returns null on unrelated text', () => {
    expect(parseUsagePdfText('This is not a usage report.')).toBeNull();
  });
});
