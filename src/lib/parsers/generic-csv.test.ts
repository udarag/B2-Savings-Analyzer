import { describe, it, expect } from 'vitest';
import { parseGenericTabularCsv } from './generic-csv';

describe('parseGenericTabularCsv', () => {
  it('parses a plausible-billing unknown table at low confidence with a best-effort warning', () => {
    const csv = [
      'Item,Spend',
      'Object storage (GB-month),500.00',
      'Random platform fee,10.00',
    ].join('\n');

    const r = parseGenericTabularCsv(csv);
    expect(r).not.toBeNull();
    expect(r!.parsedBill.parseConfidence).toBe(0.4);
    expect(r!.parsedBill.grandTotal).toBeCloseTo(510, 2);
    expect(r!.parsedBill.warnings.some((w) => /best-effort/i.test(w))).toBe(true);
    expect(r!.parsedBill.lineItems.some((i) => i.category === 'storage')).toBe(true);
  });

  it('parses European-formatted spend in the generic path', () => {
    const csv = ['Service;Cost', 'Bucket storage;1.234,56'].join('\n');
    const r = parseGenericTabularCsv(csv);
    expect(r).not.toBeNull();
    expect(r!.parsedBill.grandTotal).toBeCloseTo(1234.56, 2);
  });

  it('returns null for a non-billing junk table (no keywords, no provider signal)', () => {
    const csv = ['Name,Score', 'Alice,90', 'Bob,85'].join('\n');
    expect(parseGenericTabularCsv(csv)).toBeNull();
  });

  it('returns null for a header-only / empty sheet', () => {
    expect(parseGenericTabularCsv('Item,Spend')).toBeNull();
  });

  it('returns null when there is no positive spend even with billing keywords', () => {
    const csv = ['Item,Spend', 'Object storage,0', 'Bucket fee,0'].join('\n');
    expect(parseGenericTabularCsv(csv)).toBeNull();
  });
});
