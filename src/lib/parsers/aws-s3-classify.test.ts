import { describe, it, expect } from 'vitest';
import { classifySku } from './aws-cost-csv';
import { classifyAwsLine } from './aws-detail-pdf';
import { classifyS3Suffix } from './aws-s3-classify';
import type { Category } from '@/types/analysis';

const S3_SERVICE = 'Amazon Simple Storage Service';

type Expected = { category: Category; subcategory?: string; storageClass?: string };

// Suffixes both the CSV and detailed-PDF parsers classify identically. These are
// the rows that drive the operations/retrieval cost buckets, so locking them (and
// proving the two parsers agree) is the point of the shared classifier.
const SHARED: Array<{ sku: string; expected: Expected }> = [
  { sku: 'USE1-Requests-Tier1', expected: { category: 'operations', subcategory: 'PUT/COPY/POST/LIST' } },
  { sku: 'USE1-Requests-Tier2', expected: { category: 'operations', subcategory: 'GET/SELECT' } },
  { sku: 'USE1-Requests-INT-Tier1', expected: { category: 'operations', subcategory: 'PUT/COPY/POST/LIST' } },
  { sku: 'USE1-Requests-INT-Tier2', expected: { category: 'operations', subcategory: 'GET/SELECT' } },
  { sku: 'USE1-Requests-SIA1', expected: { category: 'operations', subcategory: 'Standard-IA Requests', storageClass: 'Standard-IA' } },
  { sku: 'USE1-Requests-ZIA1', expected: { category: 'operations', subcategory: 'One Zone-IA Requests', storageClass: 'One Zone-IA' } },
  { sku: 'USE1-Requests-GDA1', expected: { category: 'operations', subcategory: 'Glacier Deep Archive Requests', storageClass: 'Glacier Deep Archive' } },
  { sku: 'USE1-Requests-GIR1', expected: { category: 'operations', subcategory: 'Glacier IR Requests', storageClass: 'Glacier Instant Retrieval' } },
  { sku: 'USE1-Retrieval-SIA', expected: { category: 'retrieval', storageClass: 'Standard-IA' } },
  { sku: 'USE1-Retrieval-ZIA', expected: { category: 'retrieval', storageClass: 'One Zone-IA' } },
  { sku: 'USE1-Retrieval-GIR', expected: { category: 'retrieval', storageClass: 'Glacier Instant Retrieval' } },
];

describe('shared S3 suffixes: CSV and PDF classifiers agree and are stable', () => {
  for (const { sku, expected } of SHARED) {
    it(sku, () => {
      const csv = classifySku(sku);
      const pdf = classifyAwsLine(S3_SERVICE, sku, '');
      expect(csv).toEqual(expected);
      expect(pdf).toEqual(expected);
      expect(csv).toEqual(pdf);
    });
  }
});

describe('early-deletion fees (identical output in both parsers)', () => {
  const cases: Array<{ sku: string; storageClass: string }> = [
    { sku: 'USE1-EarlyDelete-SIA', storageClass: 'Standard-IA' },
    { sku: 'USE1-EarlyDelete-ZIA', storageClass: 'One Zone-IA' },
    { sku: 'USE1-EarlyDelete-GDA', storageClass: 'Glacier Deep Archive' },
  ];
  for (const { sku, storageClass } of cases) {
    it(sku, () => {
      const expected = { category: 'retrieval' as Category, subcategory: 'Early Deletion', storageClass };
      expect(classifySku(sku)).toEqual(expected);
      expect(classifyAwsLine(S3_SERVICE, sku, '')).toEqual(expected);
    });
  }
});

describe('TimedStorage is treated as storage by both parsers', () => {
  it('USE1-TimedStorage-ByteHrs', () => {
    expect(classifySku('USE1-TimedStorage-ByteHrs').category).toBe('storage');
    expect(classifyAwsLine(S3_SERVICE, 'USE1-TimedStorage-ByteHrs', '').category).toBe('storage');
  });
});

describe('detailed-PDF-only behavior is preserved', () => {
  it('classifies Glacier Instant Retrieval via the rate description', () => {
    expect(classifyAwsLine(S3_SERVICE, 'USE1-Misc-Thing', 'Glacier Instant Retrieval restore')).toEqual({
      category: 'retrieval',
      storageClass: 'Glacier Instant Retrieval',
    });
  });
  it('classifies S3 Tables/Vectors as storage', () => {
    expect(classifyAwsLine(S3_SERVICE, 'USE1-Tables-Requests', '')).toEqual({
      category: 'storage',
      subcategory: 'S3 Tables/Vectors',
    });
  });
  it('defaults unrecognized S3 suffixes to operations / Other S3', () => {
    expect(classifyAwsLine(S3_SERVICE, 'USE1-Totally-Unknown', '')).toEqual({
      category: 'operations',
      subcategory: 'Other S3',
    });
  });
});

describe('cost-CSV-only behavior is preserved (documents the remaining per-format drift)', () => {
  it('Requests-Tier4 → Lifecycle Transitions', () => {
    expect(classifySku('USE1-Requests-Tier4')).toEqual({ category: 'operations', subcategory: 'Lifecycle Transitions' });
  });
  it('S3RTC-Out-Bytes → S3 Replication egress', () => {
    expect(classifySku('USE1-S3RTC-Out-Bytes')).toEqual({ category: 'egress', subcategory: 'S3 Replication' });
  });
  it('Metadata- → Metadata operations', () => {
    expect(classifySku('USE1-Metadata-Storage')).toEqual({ category: 'operations', subcategory: 'Metadata' });
  });
});

describe('classifyS3Suffix (shared core, region prefix already stripped)', () => {
  it('classifies the shared request and retrieval suffixes', () => {
    expect(classifyS3Suffix('Requests-Tier1')).toEqual({ category: 'operations', subcategory: 'PUT/COPY/POST/LIST' });
    expect(classifyS3Suffix('Requests-SIA1')).toEqual({ category: 'operations', subcategory: 'Standard-IA Requests', storageClass: 'Standard-IA' });
    expect(classifyS3Suffix('Retrieval-SIA')).toEqual({ category: 'retrieval', storageClass: 'Standard-IA' });
  });

  it('returns null for suffixes left to each parser (early-delete, Tier4, storage, unknown)', () => {
    expect(classifyS3Suffix('EarlyDelete-SIA')).toBeNull();
    expect(classifyS3Suffix('Requests-Tier4')).toBeNull();
    expect(classifyS3Suffix('TimedStorage-ByteHrs')).toBeNull();
    expect(classifyS3Suffix('Totally-Unknown')).toBeNull();
  });
});
