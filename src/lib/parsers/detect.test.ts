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

  it('parses an AWS CUR file (row-per-line-item), filtering to S3 by product code', () => {
    const text = [
      'lineItem/ProductCode,lineItem/UsageType,lineItem/UnblendedCost',
      'AmazonS3,USE1-TimedStorage-ByteHrs,100.00',
      'AmazonS3,USE1-Requests-Tier1,5.00',
      'AmazonEC2,BoxUsage:t3.large,999.00',
    ].join('\n');
    const r = detectAndParse(csv(text));
    expect(r.provider).toBe('aws');
    expect(r.billType).toBe('sku-export');
    expect(r.parsedBill.lineItems.some((i) => i.category === 'storage')).toBe(true);
    // The EC2 row is excluded by the product filter, so only the S3 storage + request rows count.
    expect(r.parsedBill.grandTotal).toBeCloseTo(105, 2);
  });

  it('parses a long-format Cost Explorer export (usage-type rows + a single cost column)', () => {
    const text = [
      'Usage type,Cost($)',
      'USW2-TimedStorage-ByteHrs,200.00',
      'USW2-DataTransfer-Out-Bytes,50.00',
    ].join('\n');
    const r = detectAndParse(csv(text));
    expect(r.provider).toBe('aws');
    expect(r.parsedBill.grandTotal).toBeCloseTo(250, 2);
    expect(r.parsedBill.lineItems.some((i) => i.category === 'storage')).toBe(true);
    expect(r.parsedBill.lineItems.some((i) => i.category === 'egress')).toBe(true);
  });

  it('still throws on a non-billing junk CSV', () => {
    const text = ['Name,Score', 'Alice,90'].join('\n');
    expect(() => detectAndParse(csv(text))).toThrow(/Could not detect CSV format/i);
  });

  it('picks the billing data sheet of an Excel workbook by content, not a prose cover sheet', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    // A prose cover sheet first — the old name/first-sheet heuristic would pick this and 422.
    const cover = XLSX.utils.aoa_to_sheet([['Billing Summary'], ['Prepared for ACME'], ['See the next tab for detail']]);
    XLSX.utils.book_append_sheet(wb, cover, 'Cover');
    const data = XLSX.utils.aoa_to_sheet([
      ['Service description', 'SKU description', 'SKU ID', 'Subtotal ($)'],
      ['Cloud Storage', 'Standard Storage US Multi-region', 'AAA', '100.00'],
    ]);
    XLSX.utils.book_append_sheet(wb, data, 'Sheet2');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const r = detectAndParse({ filename: 'bill.xlsx', content: buf as Buffer, mimeType: '' });
    expect(r.provider).toBe('gcp');
    expect(r.parsedBill.grandTotal).toBeCloseTo(100, 2);
  });
});
