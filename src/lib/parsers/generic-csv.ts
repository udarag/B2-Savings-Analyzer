import Papa from 'papaparse';
import { v4 as uuid } from 'uuid';
import type { Category, ParsedLineItem } from '@/types/analysis';
import type { ParseResult } from './types';
import { parseLocaleNumber } from './normalize';
import { transformHeader, resolveColumn } from './csv-utils';
import { detectProviderFromContent } from './provider-detection';
import {
  computeParseConfidence,
  classifyParseOutcome,
  sumAddressableCost,
  NO_STORAGE_SCOPE_WARNING,
} from './confidence';

const GENERIC_BASELINE_CONFIDENCE = 0.4;

const COST_HEADER = /cost|amount|charge|total|price|spend/i;
const DESC_HEADER = /desc|sku|service|item|usage|product|meter|resource|name/i;

// Signals that a table is plausibly a cloud-storage/billing export. The fallback refuses to
// guess on anything without at least one of these (or a provider-specific signal).
const BILLING_KEYWORDS =
  /storage|egress|bucket|object|operation|request|retrieval|transfer|glacier|nearline|coldline|blob|bandwidth|download|cloud storage|\bs3\b|\bgcs\b|provisioned/i;

function classifyGenericCategory(description: string): { category: Category; storageClass?: string } {
  const l = description.toLowerCase();
  if (/retriev|restore|early delet/.test(l)) return { category: 'retrieval' };
  if (/egress|download|bandwidth|data transfer|transfer out|network/.test(l)) return { category: 'egress' };
  if (/operation|request|\bput\b|\bget\b|\blist\b|class [ab]|\bapi\b/.test(l)) return { category: 'operations' };
  if (/storage|bucket|object|stored|capacity|glacier|nearline|coldline|archive|blob/.test(l)) {
    return { category: 'storage' };
  }
  if (/\bcdn\b|cloudfront|cache|block storage|file system|\bebs\b|\befs\b/.test(l)) {
    return { category: 'storage-adjacent' };
  }
  return { category: 'out-of-scope' };
}

function positiveNumericCount(rows: Record<string, string>[], col: string): number {
  let count = 0;
  for (const row of rows) if (parseLocaleNumber(row[col] ?? '') > 0) count++;
  return count;
}

function nonNumericTextCount(rows: Record<string, string>[], col: string): number {
  let count = 0;
  for (const row of rows) {
    const value = (row[col] ?? '').trim();
    if (value && parseLocaleNumber(value) === 0 && !/^[\d(.,$€£\s-]+$/.test(value)) count++;
  }
  return count;
}

// Pick the cost column: among headers that look like a cost (by name or a currency token), the
// one with the most positive-numeric cells. Falls back to the most-numeric column overall.
function pickCostColumn(fields: string[], rows: Record<string, string>[]): string | undefined {
  const named = fields.filter((h) => COST_HEADER.test(h) || /\$|usd/i.test(h));
  const pool = named.length > 0 ? named : fields;
  let best: string | undefined;
  let bestCount = 0;
  for (const col of pool) {
    const count = positiveNumericCount(rows, col);
    if (count > bestCount) {
      bestCount = count;
      best = col;
    }
  }
  return bestCount > 0 ? best : undefined;
}

// Pick the description column: a name match first, else the most text-heavy non-cost column.
function pickDescriptionColumn(
  fields: string[],
  rows: Record<string, string>[],
  costCol: string,
): string | undefined {
  const named = resolveColumn(
    fields.filter((f) => f !== costCol),
    fields.filter((f) => f !== costCol && DESC_HEADER.test(f)),
  );
  if (named) return named;
  let best: string | undefined;
  let bestCount = 0;
  for (const col of fields) {
    if (col === costCol) continue;
    const count = nonNumericTextCount(rows, col);
    if (count > bestCount) {
      bestCount = count;
      best = col;
    }
  }
  return bestCount > 0 ? best : undefined;
}

/**
 * Last-resort parser for a CSV that matched none of the known provider shapes. Deliberately
 * conservative: it only returns a result when the table genuinely looks like a billing export
 * (a cost column, a description column, nonzero spend, and a storage/billing/provider signal).
 * Otherwise it returns null so the caller keeps throwing rather than guessing. Confidence is a
 * low 0.4 baseline and the result always carries a best-effort warning.
 */
export function parseGenericTabularCsv(text: string): ParseResult | null {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader,
  });
  const fields = parsed.meta.fields ?? [];
  const rows = parsed.data;
  if (fields.length === 0 || rows.length === 0) return null;

  const costCol = pickCostColumn(fields, rows);
  if (!costCol) return null;
  const descCol = pickDescriptionColumn(fields, rows, costCol);
  if (!descCol) return null;

  const detection = detectProviderFromContent(text);
  const hasBillingSignal = detection.confidence > 0 || BILLING_KEYWORDS.test(text);
  // Refuse to default to a provider for a table with no billing/storage/provider signal at all.
  if (!hasBillingSignal) return null;

  const provider = detection.confidence > 0 ? detection.provider : 'aws';
  const lineItems: ParsedLineItem[] = [];
  let totalSpend = 0;

  for (const row of rows) {
    const description = (row[descCol] ?? '').trim();
    const costUsd = parseLocaleNumber(row[costCol] ?? '0');
    if (!description && costUsd === 0) continue;

    const { category, storageClass } = classifyGenericCategory(description);
    lineItems.push({
      id: uuid(),
      provider,
      service: description || 'Unknown',
      region: 'Unknown',
      sku: '',
      description: description || '(no description)',
      category,
      storageClass,
      costUsd: Math.round(costUsd * 100) / 100,
      isEstimate: false,
      isEdited: false,
    });
    totalSpend += costUsd;
  }

  // Require real spend — an all-zero or non-monetary table is not a billing export.
  if (totalSpend <= 0) return null;

  const addressableTotal = sumAddressableCost(lineItems);
  const outcome = classifyParseOutcome(lineItems.length > 0, addressableTotal);
  const warnings = ['Unrecognized billing format — parsed best-effort; verify categorization before use.'];
  if (outcome === 'no-addressable') warnings.push(NO_STORAGE_SCOPE_WARNING);

  return {
    provider,
    billType: 'sku-export',
    detectionSignals: [],
    parsedBill: {
      lineItems,
      grandTotal: Math.round(totalSpend * 100) / 100,
      parseConfidence: computeParseConfidence({
        baseline: GENERIC_BASELINE_CONFIDENCE,
        outcome,
        hasBlockingWarning: false,
      }),
      warnings,
    },
  };
}
