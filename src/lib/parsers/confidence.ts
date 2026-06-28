import type { Category, ParsedLineItem } from '@/types/analysis';

// Parser confidence reflects *parse fidelity* — did we actually read the file — and is kept
// separate from commercial usefulness, which `assessReadiness` owns. Each parser classifies
// its own result into one of these outcomes and decides which (if any) of its warnings is
// "blocking" for confidence; confidence is never derived from `warnings.length`, because some
// warnings are purely advisory (e.g. a summary-invoice estimate notice) and must not dock it.
export type ParseOutcome = 'ok' | 'empty' | 'no-addressable';

// Floor for a genuinely unreadable parse. Low enough to read as "couldn't parse this" without
// being literally zero. Readiness already zeroes its granularity score when there are no line
// items, so this mainly keeps the displayed "Parser confidence" honest.
export const EMPTY_PARSE_CONFIDENCE = 0.1;

// Flat reduction applied when a parser flags a genuinely blocking warning (a real parse
// anomaly, e.g. an over-capture total mismatch). Matches the historical 0.95→0.8 / 0.85→0.7
// downgrades so clean-bill calibration is preserved.
const BLOCKING_WARNING_PENALTY = 0.15;

// The B2-addressable categories. Spend outside this set (storage-adjacent, out-of-scope) is
// correctly parsed but is not part of the storage savings story.
const ADDRESSABLE_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'storage',
  'egress',
  'operations',
  'retrieval',
]);

export interface ParseConfidenceInput {
  /** The parser's clean-parse baseline (e.g. 0.95 GCP, 0.85 AWS detail/SKU, 0.5 summary). */
  baseline: number;
  /** Parser-decided classification of the result. */
  outcome: ParseOutcome;
  /** Parser-decided: did a genuinely blocking (non-advisory) warning fire? */
  hasBlockingWarning: boolean;
}

export function computeParseConfidence({
  baseline,
  outcome,
  hasBlockingWarning,
}: ParseConfidenceInput): number {
  if (outcome === 'empty') return EMPTY_PARSE_CONFIDENCE;
  if (hasBlockingWarning) {
    return Math.max(EMPTY_PARSE_CONFIDENCE, Math.round((baseline - BLOCKING_WARNING_PENALTY) * 100) / 100);
  }
  // 'ok' and 'no-addressable' both keep the baseline: a non-storage bill parsed correctly,
  // so its parse fidelity is unchanged. Readiness, not confidence, flags it as not useful.
  return baseline;
}

export function sumAddressableCost(lineItems: ParsedLineItem[]): number {
  return lineItems.reduce(
    (sum, item) => (ADDRESSABLE_CATEGORIES.has(item.category) ? sum + item.costUsd : sum),
    0,
  );
}

/**
 * Classify a parse outcome from two parser-supplied signals:
 * - `recognizedStructure`: did the parser find the structure it expects (rows/columns)?
 * - `addressableTotal`: summed storage-scope spend.
 *
 * `empty` (no recognized structure) is a genuine extraction failure; `no-addressable`
 * (structure found, but zero storage-scope spend) is a successfully parsed non-storage bill —
 * the two must not be conflated.
 */
export function classifyParseOutcome(recognizedStructure: boolean, addressableTotal: number): ParseOutcome {
  if (!recognizedStructure) return 'empty';
  if (addressableTotal <= 0) return 'no-addressable';
  return 'ok';
}

export function unsupportedLayoutWarning(format: string): string {
  return `Could not extract recognizable line items from this ${format}; the layout may be unsupported or the file may be incomplete.`;
}

export const NO_STORAGE_SCOPE_WARNING =
  'No storage-scope spend (storage, egress, operations, or retrieval) was found in this bill.';
