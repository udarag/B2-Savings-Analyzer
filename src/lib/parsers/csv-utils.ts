// Tolerant CSV header handling shared by the CSV parsers, so a renamed, re-cased, BOM-prefixed,
// or whitespace-padded column still binds to the value the parser expects.

// Normalize a header (or alias) for tolerant comparison: strip a leading BOM, lowercase, and
// collapse all whitespace runs to a single space.
export function normalizeHeader(header: string): string {
  return header.replace(/^﻿/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Papa `transformHeader`: strip a leading BOM and trim surrounding whitespace while preserving
// the header's original casing/interior spacing (so canonical exports are untouched).
export function transformHeader(header: string): string {
  return header.replace(/^﻿/, '').trim();
}

// Find the actual field name in `fields` that matches any of `aliases` (case/whitespace/BOM
// insensitive). Returns the original field name so the caller can index rows with it.
export function resolveColumn(fields: string[], aliases: string[]): string | undefined {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const field of fields) {
    if (normalizedAliases.includes(normalizeHeader(field))) return field;
  }
  return undefined;
}
