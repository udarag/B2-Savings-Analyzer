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
});
