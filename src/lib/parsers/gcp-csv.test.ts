import { describe, it, expect } from 'vitest';
import { parseGcpCsv } from './gcp-csv';

// Built from arrays so column counts always line up with the header.
const HEADERS = [
  'Service description',
  'Service ID',
  'SKU description',
  'SKU ID',
  'Usage amount',
  'Usage unit',
  'Cost ($)',
  'Savings programs ($)',
  'Other savings ($)',
  'Unrounded subtotal ($)',
  'Subtotal ($)',
];

const ROWS = [
  ['Cloud Storage', '95FF', 'Standard Storage Multi-Region', 'AAAA', '1000', 'gibibyte month', '24.21', '0', '0', '24.21', '24.21'],
  ['Cloud Storage', '95FF', 'Download Worldwide Destinations', 'BBBB', '50', 'gibibyte', '5.00', '0', '0', '5.00', '5.00'],
  ['Cloud Storage', '95FF', 'Class A Operations', 'CCCC', '10000', 'count', '1.50', '0', '0', '1.50', '1.50'],
  ['', '', '', '', '', '', '', '', '', 'Subtotal', '30.71'],
];

const CSV = [HEADERS, ...ROWS].map((r) => r.join(',')).join('\n');

describe('parseGcpCsv', () => {
  const result = parseGcpCsv(CSV);

  it('parses billable rows and skips the subtotal row', () => {
    expect(result.parsedBill.lineItems).toHaveLength(3);
  });

  it('sums the grand total', () => {
    expect(result.parsedBill.grandTotal).toBeCloseTo(30.71, 2);
  });

  it('classifies storage, egress, and operations', () => {
    const categories = result.parsedBill.lineItems.map((i) => i.category).sort();
    expect(categories).toEqual(['egress', 'operations', 'storage']);
  });

  it('flags all-zero Savings programs as a list-price commercial signal, not a warning', () => {
    expect(result.parsedBill.commercialSignals?.some((s) => /list price/i.test(s))).toBe(true);
    expect(result.parsedBill.warnings).toHaveLength(0);
  });

  it('normalizes gibibyte-month storage usage onto the GB basis', () => {
    const storage = result.parsedBill.lineItems.find((i) => i.category === 'storage');
    expect(storage?.storageClass).toBe('Standard');
    expect(storage?.usageQuantity).toBeGreaterThan(1000); // 1000 GiB ≈ 1073.7 GB
  });
});
