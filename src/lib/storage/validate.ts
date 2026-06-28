import type { Analysis, ParsedBill, ModelConfig } from '@/types/analysis';
import type { ReportSnapshot } from '@/types/model';

// Lenient validation at the storage read boundary. Durable B2/Postgres JSON is
// written by older code versions, so reads should not blindly cast JSON.parse
// output to a domain type. These guards only reject objects that are structurally
// unusable (bad JSON, wrong type, or missing a long-standing required field) and
// otherwise pass the object through untouched, so evolving optional fields never
// cause a valid record to be dropped.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Parse stored JSON without throwing. Returns null (and logs) on invalid JSON. */
export function safeJsonParse(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Ignoring malformed stored JSON (${label}):`, error);
    return null;
  }
}

export function parseStoredAnalysis(raw: string): Analysis | null {
  const v = safeJsonParse(raw, 'analysis meta');
  if (!isRecord(v)) return null;
  if (
    !isStr(v.id) ||
    !isStr(v.prospectName) ||
    !isStr(v.provider) ||
    !isStr(v.billType) ||
    !isStr(v.createdAt) ||
    !isStr(v.updatedAt)
  ) {
    console.warn(`Ignoring analysis meta with unexpected shape (id=${String(v.id)})`);
    return null;
  }
  return v as unknown as Analysis;
}

export function parseStoredParsedBill(raw: string): ParsedBill | null {
  const v = safeJsonParse(raw, 'parsed bill');
  if (!isRecord(v)) return null;
  if (
    !Array.isArray(v.lineItems) ||
    !isNum(v.grandTotal) ||
    !isNum(v.parseConfidence) ||
    !Array.isArray(v.warnings)
  ) {
    console.warn('Ignoring parsed bill with unexpected shape');
    return null;
  }
  return v as unknown as ParsedBill;
}

export function parseStoredModelConfig(raw: string): ModelConfig | null {
  const v = safeJsonParse(raw, 'model config');
  if (!isRecord(v)) return null;
  if (
    !isRecord(v.tierToggles) ||
    !isRecord(v.egressConfig) ||
    !isNum(v.b2PricePerTb) ||
    !isNum(v.projectionTermMonths)
  ) {
    console.warn('Ignoring model config with unexpected shape');
    return null;
  }
  return v as unknown as ModelConfig;
}

export function parseStoredSnapshot(raw: string): ReportSnapshot | null {
  const v = safeJsonParse(raw, 'report snapshot');
  if (!isRecord(v)) return null;
  if (!isStr(v.id) || !isStr(v.analysisId) || !isStr(v.createdAt) || !isStr(v.trigger)) {
    console.warn('Ignoring report snapshot with unexpected shape');
    return null;
  }
  return v as unknown as ReportSnapshot;
}
