import { describe, it, expect } from 'vitest';
import { detectAndParse } from './detect';

function csv(text: string) {
  return { filename: 'bill.csv', content: text, mimeType: 'text/csv' };
}

describe('detectAndParse — CSV routing', () => {
  it('routes a GCP export with re-cased / aliased headers to the GCP parser', () => {
    // Misses the literal "Service description"/"SKU ID" checks; caught by alias detection.
    const text = [
      'Service,SKU desc,Subtotal',
      'Cloud Storage,Standard Storage Multi-Region,10.00',
    ].join('\n');
    const r = detectAndParse(csv(text));
    expect(r.provider).toBe('gcp');
    expect(r.parsedBill.grandTotal).toBeCloseTo(10, 2);
  });

  it('routes an aliased AWS cost export (space before currency suffix) to the AWS cost parser', () => {
    const text = [
      'Usage Type;USE1-TimedStorage-ByteHrs ($);Total costs ($)',
      '2026-03-01;1.234,56;1.234,56',
      'Usage type total;1.234,56;1.234,56',
    ].join('\n');
    const r = detectAndParse(csv(text));
    expect(r.provider).toBe('aws');
    expect(r.billType).toBe('sku-export');
    expect(r.parsedBill.grandTotal).toBeCloseTo(1234.56, 2);
  });

  it('routes a plausible-billing unknown CSV to the generic fallback instead of throwing', () => {
    const text = ['Item,Spend', 'Object storage,500.00'].join('\n');
    const r = detectAndParse(csv(text));
    expect(r.parsedBill.lineItems.length).toBeGreaterThan(0);
    expect(r.parsedBill.parseConfidence).toBe(0.4);
  });

  it('still hard-fails an AWS CUR file (not implemented)', () => {
    const text = ['lineItem/UsageType,lineItem/BlendedCost', 'USE1-TimedStorage-ByteHrs,1.00'].join('\n');
    expect(() => detectAndParse(csv(text))).toThrow(/CUR/i);
  });

  it('still throws on a non-billing junk CSV', () => {
    const text = ['Name,Score', 'Alice,90'].join('\n');
    expect(() => detectAndParse(csv(text))).toThrow(/Could not detect CSV format/i);
  });
});
