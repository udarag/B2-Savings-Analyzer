import type { ParsedLineItem } from '@/types/analysis';
import { getColdTierAccessSummary, isColdTierAccessItem, type AccessCostSummary } from './access-costs';

// Categorizes the operations/request charges on a bill so the dashboard can show what those fees
// would become on B2, where all standard transactions are free. The hyperscaler "class" taxonomy
// (PUT-class, GET-class, etc.) is mapped to B2's own transaction classes for an apples-to-apples
// framing; event-notification (class-d) and review-only ops are deliberately excluded.

/** B2 transaction class a hyperscaler request maps to. 'class-a-c' is a blended PUT/LIST bucket
 *  (AWS lumps PUT/COPY/POST/LIST together); 'other' means unclassified. */
export type B2TransactionClassId = 'class-a' | 'class-b' | 'class-c' | 'class-a-c' | 'class-d' | 'other';

/** Cost/usage roll-up for one action group (PUT-related or GET-related). */
export interface ActionCostDetail {
  currentCost: number;
  lineCount: number;
  usageQuantity: number;
  /** Set only when every line in the group shares one unit. */
  usageUnit?: string;
}

/** Operations spend split into the buckets the dashboard renders. `distinct*` de-dupes the lines
 *  that appear in more than one bucket so the totals don't double-count. */
export interface OperationActionCostSummary {
  putRelated: ActionCostDetail;
  getRelated: ActionCostDetail;
  coldTierAccess: AccessCostSummary;
  distinctCurrentCost: number;
  distinctLineCount: number;
}

/** Build the operations summary for a bill: PUT/GET action groups, cold-tier access, and a
 *  de-duplicated total across all three. */
export function getOperationActionCostSummary(lineItems: ParsedLineItem[]): OperationActionCostSummary {
  const putItems = lineItems.filter(isPutRelatedStandardOperation);
  const getItems = lineItems.filter(isGetRelatedStandardOperation);
  const coldTierAccess = getColdTierAccessSummary(lineItems);
  // Keyed by item id so a line counted as both (e.g. PUT-related and cold-tier) is totalled once.
  const distinctItems = new Map<string, ParsedLineItem>();

  for (const item of lineItems) {
    if (
      isPutRelatedStandardOperation(item) ||
      isGetRelatedStandardOperation(item) ||
      isColdTierAccessItem(item)
    ) {
      distinctItems.set(item.id, item);
    }
  }

  return {
    putRelated: summarizeActionCost(putItems),
    getRelated: summarizeActionCost(getItems),
    coldTierAccess,
    distinctCurrentCost: round2(
      Array.from(distinctItems.values()).reduce((sum, item) => sum + item.costUsd, 0),
    ),
    distinctLineCount: distinctItems.size,
  };
}

/** A "standard" PUT-class operation: a classifiable request that maps to a B2 transaction class.
 *  Excludes review-only ops and event notifications (class-d), which B2 doesn't make free. */
export function isPutRelatedStandardOperation(item: ParsedLineItem): boolean {
  if (item.category !== 'operations') return false;

  const classId = isReviewOnlyOperation(item.subcategory)
    ? 'other'
    : classifyTransactionClass(item);

  return classId !== 'other' && classId !== 'class-d' && isPutRelatedTransaction(item);
}

/** GET-class counterpart of isPutRelatedStandardOperation. */
export function isGetRelatedStandardOperation(item: ParsedLineItem): boolean {
  if (item.category !== 'operations') return false;

  const classId = isReviewOnlyOperation(item.subcategory)
    ? 'other'
    : classifyTransactionClass(item);

  return classId !== 'other' && classId !== 'class-d' && isGetRelatedTransaction(item);
}

/** Whether a line is a write-side request (PUT/COPY/DELETE/upload, etc.). Matches the structured
 *  subcategory first, then falls back to keyword signals in description/SKU since providers name
 *  these inconsistently across exports. */
export function isPutRelatedTransaction(item: ParsedLineItem): boolean {
  const subcategory = (item.subcategory || '').toLowerCase();
  const description = `${item.description} ${item.sku}`.toLowerCase();
  const text = `${subcategory} ${description}`;

  if (subcategory === 'put/copy/post/list' || subcategory === 'class a') return true;

  return [
    'put',
    'putobject',
    'post',
    'copyobject',
    'copy object',
    'upload',
    'write',
    'delete',
    'insert',
    'compose',
  ].some((signal) => text.includes(signal));
}

/** Read-side counterpart of isPutRelatedTransaction (GET/HEAD/download/select, etc.). */
export function isGetRelatedTransaction(item: ParsedLineItem): boolean {
  const subcategory = (item.subcategory || '').toLowerCase();
  const description = `${item.description} ${item.sku}`.toLowerCase();
  const text = `${subcategory} ${description}`;

  if (subcategory === 'get/select' || subcategory === 'class b') return true;

  return [
    'get',
    'getobject',
    'download',
    'read',
    'select',
    'headobject',
    'head object',
    'file information',
  ].some((signal) => text.includes(signal));
}

/** Map a hyperscaler operation line to its B2 transaction class. Exact subcategory matches win over
 *  keyword fallbacks; order matters because a single line can mention several signals (e.g. a "copy"
 *  line should land as class-c list/copy, not class-a). */
export function classifyTransactionClass(item: ParsedLineItem): B2TransactionClassId {
  const subcategory = (item.subcategory || '').toLowerCase();
  const description = `${item.description} ${item.sku}`.toLowerCase();
  const text = `${subcategory} ${description}`;

  // Event notifications are a separate B2 class-d charge, so they must not be folded into PUT/GET.
  if (text.includes('event notification')) return 'class-d';
  if (subcategory === 'class a') return 'class-a';
  if (subcategory === 'class b') return 'class-b';
  if (subcategory === 'put/copy/post/list') return 'class-a-c';
  if (subcategory === 'get/select') return 'class-b';

  if (text.includes('put') || text.includes('post') || text.includes('upload') || text.includes('write') || text.includes('delete')) {
    return 'class-a';
  }

  if (
    text.includes('get') ||
    text.includes('download') ||
    text.includes('read') ||
    text.includes('headobject') ||
    text.includes('head object') ||
    text.includes('file information')
  ) {
    return 'class-b';
  }

  if (text.includes('list') || text.includes('copyobject') || text.includes('copy object') || text.includes('bucket')) {
    return 'class-c';
  }

  return 'other';
}

/** Operation subcategories that need a human to review rather than auto-mapping to a B2 class —
 *  things like monitoring/analytics, inventory, lifecycle transitions, and metadata that don't
 *  cleanly become free B2 transactions. Excluded from the PUT/GET standard-operation buckets. */
export function isReviewOnlyOperation(subcategory?: string): boolean {
  const key = (subcategory || '').toLowerCase();
  return [
    'monitoring/analytics',
    's3 inventory',
    'lifecycle transitions',
    'lifecycle/copy',
    'tag storage',
    'metadata',
    's3 select',
    'other requests',
    'other s3',
  ].includes(key);
}

function summarizeActionCost(items: ParsedLineItem[]): ActionCostDetail {
  const units = new Set(items.map((item) => item.usageUnit).filter(Boolean));

  return {
    currentCost: round2(items.reduce((sum, item) => sum + item.costUsd, 0)),
    lineCount: items.length,
    usageQuantity: round2(items.reduce((sum, item) => sum + (item.usageQuantity || 0), 0)),
    usageUnit: units.size === 1 ? Array.from(units)[0] : undefined,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
