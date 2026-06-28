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
});
