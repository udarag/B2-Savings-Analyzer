import { describe, it, expect } from 'vitest';
import type { ParsedLineItem } from '@/types/analysis';
import {
  computeParseConfidence,
  classifyParseOutcome,
  sumAddressableCost,
  EMPTY_PARSE_CONFIDENCE,
} from './confidence';

function item(category: ParsedLineItem['category'], costUsd: number): ParsedLineItem {
  return {
    id: 'x',
    provider: 'aws',
    service: 's',
    region: 'us-east-1',
    sku: 'SKU',
    description: 'd',
    category,
    costUsd,
    isEstimate: false,
    isEdited: false,
  };
}

describe('computeParseConfidence', () => {
  it('keeps each clean-parse baseline for an ok outcome with no blocking warning', () => {
    for (const baseline of [0.95, 0.85, 0.5]) {
      expect(computeParseConfidence({ baseline, outcome: 'ok', hasBlockingWarning: false })).toBe(baseline);
    }
  });

  it('collapses to the empty floor regardless of baseline', () => {
    expect(computeParseConfidence({ baseline: 0.95, outcome: 'empty', hasBlockingWarning: false }))
      .toBe(EMPTY_PARSE_CONFIDENCE);
    expect(computeParseConfidence({ baseline: 0.85, outcome: 'empty', hasBlockingWarning: true }))
      .toBe(EMPTY_PARSE_CONFIDENCE);
  });

  it('keeps the baseline for a recognized-but-non-storage bill (NOT the empty floor)', () => {
    expect(computeParseConfidence({ baseline: 0.95, outcome: 'no-addressable', hasBlockingWarning: false }))
      .toBe(0.95);
    expect(computeParseConfidence({ baseline: 0.85, outcome: 'no-addressable', hasBlockingWarning: false }))
      .toBe(0.85);
  });

  it('docks a blocking warning by a fixed penalty (0.85 -> 0.70, 0.95 -> 0.80)', () => {
    expect(computeParseConfidence({ baseline: 0.85, outcome: 'ok', hasBlockingWarning: true })).toBeCloseTo(0.7, 5);
    expect(computeParseConfidence({ baseline: 0.95, outcome: 'ok', hasBlockingWarning: true })).toBeCloseTo(0.8, 5);
  });

  it('advisory (non-blocking) warnings never dock confidence — summary stays 0.50, cost-CSV stays 0.85', () => {
    expect(computeParseConfidence({ baseline: 0.5, outcome: 'ok', hasBlockingWarning: false })).toBe(0.5);
    expect(computeParseConfidence({ baseline: 0.85, outcome: 'ok', hasBlockingWarning: false })).toBe(0.85);
  });
});

describe('classifyParseOutcome', () => {
  it('returns empty when no structure was recognized', () => {
    expect(classifyParseOutcome(false, 0)).toBe('empty');
    expect(classifyParseOutcome(false, 1000)).toBe('empty');
  });

  it('returns no-addressable when structure was recognized but storage-scope spend is zero', () => {
    expect(classifyParseOutcome(true, 0)).toBe('no-addressable');
  });

  it('returns ok when structure and addressable spend are present', () => {
    expect(classifyParseOutcome(true, 12.5)).toBe('ok');
  });
});

describe('sumAddressableCost', () => {
  it('sums only storage, egress, operations, and retrieval', () => {
    const items = [
      item('storage', 100),
      item('egress', 10),
      item('operations', 5),
      item('retrieval', 2),
      item('storage-adjacent', 999),
      item('out-of-scope', 888),
    ];
    expect(sumAddressableCost(items)).toBeCloseTo(117, 5);
  });

  it('is zero when only non-addressable categories are present', () => {
    expect(sumAddressableCost([item('storage-adjacent', 50), item('out-of-scope', 60)])).toBe(0);
  });
});
