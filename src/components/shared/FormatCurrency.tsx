'use client';

// Shared en-US/USD display formatters. All bill and B2 figures are modeled in USD,
// so currency output is fixed to USD rather than locale-derived.

/** Formats a USD amount for display (e.g. 1234.5 -> "$1,234.50"). */
export function formatCurrency(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Formats a plain number with thousands separators (e.g. GB-stored counts). */
export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Formats an already-scaled percentage value (pass 42.5, not 0.425) as "42.5%". */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}
