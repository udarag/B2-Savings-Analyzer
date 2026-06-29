import { describe, it, expect } from 'vitest';
import { parseLocaleNumber, parseFormattedNumber } from './normalize';

describe('parseLocaleNumber', () => {
  it('is byte-identical to parseFormattedNumber on US-format input (zero regression)', () => {
    for (const s of ['1,234.56', '1234.56', '1,234', '1,234,567', '0', '42', '0.99', '']) {
      expect(parseLocaleNumber(s)).toBe(parseFormattedNumber(s));
    }
  });

  it('parses European thousands/decimal convention', () => {
    expect(parseLocaleNumber('1.234,56')).toBeCloseTo(1234.56, 2);
    expect(parseLocaleNumber('1,5')).toBeCloseTo(1.5, 5);
    expect(parseLocaleNumber('1.234.567')).toBe(1234567);
  });

  it('strips currency symbols', () => {
    expect(parseLocaleNumber('€1.234,56')).toBeCloseTo(1234.56, 2);
    expect(parseLocaleNumber('$1,234.56')).toBeCloseTo(1234.56, 2);
    expect(parseLocaleNumber('£1,234.56')).toBeCloseTo(1234.56, 2);
    expect(parseLocaleNumber('1234.56 USD')).toBeCloseTo(1234.56, 2);
  });

  it('handles exported negatives: parentheses, leading minus, Unicode minus', () => {
    expect(parseLocaleNumber('(1,234.56)')).toBeCloseTo(-1234.56, 2);
    expect(parseLocaleNumber('($1,234.56)')).toBeCloseTo(-1234.56, 2);
    expect(parseLocaleNumber('$-1,234.56')).toBeCloseTo(-1234.56, 2);
    expect(parseLocaleNumber('−1,234.56')).toBeCloseTo(-1234.56, 2); // U+2212 minus
  });

  it('treats NBSP and narrow-NBSP as thousands grouping', () => {
    expect(parseLocaleNumber('1 234,56')).toBeCloseTo(1234.56, 2); // NBSP + comma decimal
    expect(parseLocaleNumber('1 234.56')).toBeCloseTo(1234.56, 2); // narrow NBSP + dot decimal
  });

  it('keeps the US ambiguity default: a single comma with 3 trailing digits is thousands', () => {
    expect(parseLocaleNumber('1,234')).toBe(1234);
  });

  it('returns 0 for unparseable or empty input', () => {
    expect(parseLocaleNumber('abc')).toBe(0);
    expect(parseLocaleNumber('')).toBe(0);
    expect(parseLocaleNumber(null)).toBe(0);
    expect(parseLocaleNumber(undefined)).toBe(0);
  });

  it('parses scientific notation like the old parseFloat path (regression — AWS/GCP exports use it)', () => {
    expect(parseLocaleNumber('9.941e-7')).toBeCloseTo(9.941e-7, 12);
    expect(parseLocaleNumber('9.48e-8')).toBeCloseTo(9.48e-8, 12);
    expect(parseLocaleNumber('1.2E-5')).toBeCloseTo(0.000012, 10);
    expect(parseLocaleNumber('1.5e3')).toBe(1500);
    expect(parseLocaleNumber('-9.941e-7')).toBeCloseTo(-9.941e-7, 12);
    for (const s of ['9.941e-7', '9.48e-8', '1.2E-5', '1.5e3']) {
      expect(parseLocaleNumber(s)).toBe(parseFormattedNumber(s));
    }
  });

  it('only a leading sign is negative — an embedded hyphen does not flip the sign', () => {
    // A leaked SKU/date string should not become a large negative number.
    expect(parseLocaleNumber('2025-08-01')).toBeGreaterThanOrEqual(0);
    expect(parseLocaleNumber('1e-7')).toBeGreaterThan(0); // exponent minus, value is positive
    expect(parseLocaleNumber('+1,234.56')).toBeCloseTo(1234.56, 2);
  });
});
