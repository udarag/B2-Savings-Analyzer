const GIB_TO_GB = 1.073741824;

export function gibibytesToGigabytes(gib: number): number {
  return gib * GIB_TO_GB;
}

export function gibibyteMonthsToGbMonths(gibMonths: number): number {
  return gibMonths * GIB_TO_GB;
}

export function parseFormattedNumber(s: string): number {
  const cleaned = s.replace(/,/g, '').replace(/\s/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function parseUsdAmount(s: string): number {
  const cleaned = s.replace(/[USD$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export type NormalizedUnit = 'GB-Mo' | 'GB' | 'requests' | 'objects' | 'tags' | 'other';

export function normalizeUnit(rawUnit: string): { unit: NormalizedUnit; multiplier: number } {
  const lower = rawUnit.toLowerCase().trim();

  if (lower === 'gibibyte month' || lower === 'gib-mo') {
    return { unit: 'GB-Mo', multiplier: GIB_TO_GB };
  }
  if (lower === 'gb-mo' || lower === 'gb-month') {
    return { unit: 'GB-Mo', multiplier: 1 };
  }
  if (lower === 'gibibyte' || lower === 'gib') {
    return { unit: 'GB', multiplier: GIB_TO_GB };
  }
  if (lower === 'gb') {
    return { unit: 'GB', multiplier: 1 };
  }
  if (lower === 'count' || lower === 'requests') {
    return { unit: 'requests', multiplier: 1 };
  }
  if (lower.includes('tag')) {
    return { unit: 'tags', multiplier: 1 };
  }

  return { unit: 'other', multiplier: 1 };
}
