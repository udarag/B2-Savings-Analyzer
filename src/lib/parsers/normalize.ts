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

// Resolve a value that contains exactly one kind of separator (only ',' or only '.').
function resolveSingleSeparator(value: string, sep: ',' | '.'): string {
  const occurrences = value.split(sep).length - 1;
  if (occurrences > 1) {
    // Repeated separator can only be a thousands grouping (e.g. 1,234,567 or 1.234.567).
    return value.split(sep).join('');
  }
  if (sep === '.') {
    // A single dot is the decimal point under the US/parseFloat convention.
    return value;
  }
  // A single comma: decimal unless it groups exactly three trailing digits, which is the one
  // genuinely ambiguous shape (1,234). Default that to thousands to match US billing exports —
  // this keeps parseLocaleNumber byte-identical to parseFormattedNumber on US-format input.
  const trailing = value.length - value.indexOf(sep) - 1;
  return trailing === 3 ? value.replace(sep, '') : value.replace(sep, '.');
}

/**
 * Parse a human/locale-formatted money or quantity string from a CSV/Excel cell. Handles
 * thousands/decimal separators in either US (1,234.56) or European (1.234,56) convention,
 * currency symbols ($ € £ USD), spaces incl. NBSP/narrow-NBSP grouping, and negatives written
 * with a leading/Unicode minus or accounting parentheses. Returns 0 for unparseable input.
 *
 * Designed so any US-format string returns exactly what parseFormattedNumber would — the locale
 * handling only changes the previously-wrong cases. CSV-path only; the PDF parsers keep their
 * regex-fed US parsing.
 */
export function parseLocaleNumber(raw: string | null | undefined): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (s === '') return 0;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/[-−]/.test(s)) negative = true;

  // Drop everything except digits and the two possible separators (removes currency symbols,
  // regular/NBSP/narrow-NBSP spaces, and the already-captured sign/parentheses).
  const digitsOnly = s.replace(/[^0-9.,]/g, '');
  if (digitsOnly === '') return 0;

  const hasComma = digitsOnly.includes(',');
  const hasDot = digitsOnly.includes('.');

  let normalized: string;
  if (hasComma && hasDot) {
    // The later-occurring separator is the decimal; the earlier one is the thousands grouping.
    const decimalSep = digitsOnly.lastIndexOf(',') > digitsOnly.lastIndexOf('.') ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    normalized = digitsOnly.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (hasComma) {
    normalized = resolveSingleSeparator(digitsOnly, ',');
  } else if (hasDot) {
    normalized = resolveSingleSeparator(digitsOnly, '.');
  } else {
    normalized = digitsOnly;
  }

  const num = parseFloat(normalized);
  if (isNaN(num)) return 0;
  return negative ? -num : num;
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
