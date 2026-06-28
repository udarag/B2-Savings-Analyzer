import { describe, it, expect } from 'vitest';
import { getListRate, getDefaultEgressRate, getBlendedListRate } from './lookup';

describe('getListRate — GCP location classification', () => {
  // Regression: a case-sensitive .includes('multi'/'dual') in getListRate used to
  // collapse capitalized 'US Multi-region' / 'US Dual-region' labels to the cheaper
  // regional rate. They must resolve to their own (pricier) tiers.
  const regional = getListRate('gcp', 'Standard', 'US Regional');
  const multi = getListRate('gcp', 'Standard', 'US Multi-region');
  const dual = getListRate('gcp', 'Standard', 'US Dual-region');

  it('returns a numeric rate for each location type', () => {
    expect(regional).toBeTypeOf('number');
    expect(multi).toBeTypeOf('number');
    expect(dual).toBeTypeOf('number');
  });

  it('prices multi-region and dual-region above regional (the bug made them equal)', () => {
    expect(multi).not.toBe(regional);
    expect(dual).not.toBe(regional);
    expect(multi as number).toBeGreaterThan(regional as number);
    expect(dual as number).toBeGreaterThan(multi as number);
  });

  it('matches the location label case-insensitively', () => {
    expect(getListRate('gcp', 'Standard', 'us multi-region')).toBe(multi);
  });

  it('resolves the asia multi-region label distinctly from regional', () => {
    const asiaMulti = getListRate('gcp', 'Standard', 'Asia Multi-region');
    expect(asiaMulti).toBeTypeOf('number');
    expect(asiaMulti).not.toBe(regional);
  });
});

describe('getListRate — AWS', () => {
  it('returns a positive Standard rate for a known region', () => {
    const rate = getListRate('aws', 'Standard', 'us-east-1');
    expect(rate).toBeTypeOf('number');
    expect(rate as number).toBeGreaterThan(0);
  });
});

describe('getDefaultEgressRate', () => {
  // Regression: AWS branch used to read a hardcoded tier index; it must select the
  // first PAID tier (tier 0 is the free allowance) and be region-aware.
  it('returns the first paid tier rate, not the free tier', () => {
    expect(getDefaultEgressRate('aws')).toBeGreaterThan(0);
  });

  it('is region-aware: ap-southeast-1 egress is pricier than us-east-1', () => {
    expect(getDefaultEgressRate('aws', 'ap-southeast-1')).toBeGreaterThan(
      getDefaultEgressRate('aws', 'us-east-1'),
    );
  });

  it('falls back to us-east-1 for a region absent from the table', () => {
    expect(getDefaultEgressRate('aws', 'eu-west-1')).toBe(getDefaultEgressRate('aws'));
  });
});

describe('getBlendedListRate', () => {
  it('returns a positive blended AWS Standard rate for a large volume', () => {
    const rate = getBlendedListRate('aws', 'Standard', 'us-east-1', 100_000);
    expect(rate).toBeTypeOf('number');
    expect(rate as number).toBeGreaterThan(0);
  });
});
