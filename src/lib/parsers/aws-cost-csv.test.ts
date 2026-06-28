import { describe, it, expect } from 'vitest';
import { parseAwsCostCsv } from './aws-cost-csv';

describe('parseAwsCostCsv', () => {
  it('parses comma-formatted dollar amounts without truncating (regression)', () => {
    // Quoted so the embedded thousands-separator comma stays inside one field.
    const csv = [
      'Usage type,USE1-TimedStorage-ByteHrs($),Total costs($)',
      '2026-03-01,"1,234.56","1,234.56"',
      'Usage type total,"1,234.56","1,234.56"',
    ].join('\n');

    const result = parseAwsCostCsv(csv);

    // Under the old raw parseFloat, "1,234.56" truncated to 1.
    expect(result.parsedBill.grandTotal).toBeCloseTo(1234.56, 2);
    const storage = result.parsedBill.lineItems.find((i) => i.sku === 'USE1-TimedStorage-ByteHrs');
    expect(storage?.costUsd).toBeCloseTo(1234.56, 2);
  });

  it('flags a recognized non-storage export without collapsing confidence', () => {
    // A real, parseable export whose only SKU column is out-of-scope (data transfer in).
    const csv = [
      'Usage type,USE1-DataTransfer-In-Bytes($),Total costs($)',
      '2026-03-01,"100.00","100.00"',
      'Usage type total,"100.00","100.00"',
    ].join('\n');

    const result = parseAwsCostCsv(csv);
    expect(result.parsedBill.lineItems).toHaveLength(1);
    expect(result.parsedBill.lineItems[0].category).toBe('out-of-scope');
    // Parse succeeded — baseline confidence, not the empty floor.
    expect(result.parsedBill.parseConfidence).toBe(0.85);
    expect(result.parsedBill.warnings.some((w) => /no storage-scope spend/i.test(w))).toBe(true);
    expect(result.parsedBill.warnings.some((w) => /could not extract/i.test(w))).toBe(false);
  });
});
