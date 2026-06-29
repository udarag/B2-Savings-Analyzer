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

describe('parseGcpCsv confidence and false-flag guards', () => {
  it('does not assert list price when the Savings programs column is absent', () => {
    const headers = ['Service description', 'Service ID', 'SKU description', 'SKU ID', 'Usage amount', 'Usage unit', 'Cost ($)', 'Subtotal ($)'];
    const rows = [['Cloud Storage', '95FF', 'Standard Storage Multi-Region', 'AAAA', '1000', 'gibibyte month', '24.21', '24.21']];
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');

    const result = parseGcpCsv(csv);
    expect(result.parsedBill.commercialSignals).toBeUndefined();
    expect(result.parsedBill.parseConfidence).toBe(0.95);
    expect(result.parsedBill.warnings).toHaveLength(0);
  });

  it('flags recognized-but-non-storage rows without treating it as an extraction failure', () => {
    const headers = ['Service description', 'Service ID', 'SKU description', 'SKU ID', 'Usage amount', 'Usage unit', 'Cost ($)', 'Subtotal ($)'];
    const rows = [['Cloud Storage', '95FF', 'Autoclass Management Fee', 'ZZZZ', '1', 'count', '12.00', '12.00']];
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');

    const result = parseGcpCsv(csv);
    expect(result.parsedBill.lineItems).toHaveLength(1);
    expect(result.parsedBill.lineItems[0].category).toBe('out-of-scope');
    // Parse succeeded — confidence stays at baseline, not the empty floor.
    expect(result.parsedBill.parseConfidence).toBe(0.95);
    expect(result.parsedBill.warnings.some((w) => /no storage-scope spend/i.test(w))).toBe(true);
    expect(result.parsedBill.warnings.some((w) => /could not extract/i.test(w))).toBe(false);
  });

  it('collapses confidence and flags an unsupported layout when no rows are recognized', () => {
    const headers = ['Service description', 'Service ID', 'SKU description', 'SKU ID', 'Usage amount', 'Usage unit', 'Cost ($)', 'Savings programs ($)', 'Other savings ($)', 'Unrounded subtotal ($)', 'Subtotal ($)'];
    const csv = headers.join(',');

    const result = parseGcpCsv(csv);
    expect(result.parsedBill.lineItems).toHaveLength(0);
    expect(result.parsedBill.parseConfidence).toBe(0.1);
    expect(result.parsedBill.warnings.some((w) => /could not extract/i.test(w))).toBe(true);
  });

  it('runs total reconciliation when the trailer label sits in a non-watched column (real 12-col layout)', () => {
    // Real GCP exports put the "Subtotal"/"Filtered total" label in "Other savings ($)" (the
    // export here also carries the trailing "Percent change" column), not "Unrounded subtotal ($)".
    const headers = ['Service description', 'Service ID', 'SKU description', 'SKU ID', 'Usage amount', 'Usage unit', 'Cost ($)', 'Savings programs ($)', 'Other savings ($)', 'Unrounded subtotal ($)', 'Subtotal ($)', 'Percent change'];
    const rows = [
      ['Cloud Storage', 'S1', 'Standard Storage US Multi-region', 'K1', '1000', 'gibibyte month', '100', '0', '0', '100', '100', '5%'],
      // Reported subtotal is 200 but only 100 of line items parsed -> 50% under-capture.
      ['', '', '', '', '', '', '', '', 'Subtotal', '200', '200', ''],
    ];
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');

    const result = parseGcpCsv(csv);
    expect(result.parsedBill.lineItems).toHaveLength(1);
    expect(result.parsedBill.warnings.some((w) => /differs/i.test(w))).toBe(true);
    expect(result.parsedBill.parseConfidence).toBeCloseTo(0.8, 5); // baseline 0.95 minus blocking penalty
  });

  it('parses a European-formatted, BOM-prefixed, semicolon-delimited, aliased export', () => {
    // First header carries a BOM; columns are re-cased/renamed; cost is EU 1.234,56.
    const csv = [
      '﻿Service Description;SKU Description;Usage amount;Usage unit;Subtotal',
      'Cloud Storage;Standard Storage Multi-Region;1000;gibibyte month;1.234,56',
    ].join('\n');

    const result = parseGcpCsv(csv);
    expect(result.parsedBill.lineItems).toHaveLength(1);
    // The EU number must read as 1234.56, not 1.234.
    expect(result.parsedBill.grandTotal).toBeCloseTo(1234.56, 2);
    const storage = result.parsedBill.lineItems.find((i) => i.category === 'storage');
    expect(storage?.costUsd).toBeCloseTo(1234.56, 2);
  });
});
