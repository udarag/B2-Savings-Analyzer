import type { ParsedLineItem, Provider } from '@/types/analysis';

// Surfaces the cold-tier access fees (retrieval, early-deletion, lifecycle/restore ops) that B2
// eliminates entirely. These are part of a customer's true storage cost but are easy to overlook
// because they don't show up as plain "storage" lines on the bill.

/** A roll-up of one kind of cold-tier access fee (e.g. retrieval) for a given storage class/unit. */
export interface AccessCostGroup {
  id: string;
  label: string;
  storageClass?: string;
  cost: number;
  /** Number of bill line items folded into this group. */
  count: number;
  usageQuantity: number;
  usageUnit?: string;
}

/** Aggregate view of all cold-tier access fees on a bill, broken out by group. */
export interface AccessCostSummary {
  totalCost: number;
  lineCount: number;
  usageQuantity: number;
  /** Set only when every group shares one unit; left undefined for mixed units. */
  usageUnit?: string;
  groups: AccessCostGroup[];
}

// Storage classes that carry retrieval / early-deletion economics. Used to decide whether request
// and access fees on a line are "cold-tier" (eliminated on B2) versus ordinary hot-tier activity.
const AWS_COLD_STORAGE_CLASSES = new Set([
  'Standard-IA',
  'One Zone-IA',
  'Glacier',
  'Glacier Instant Retrieval',
  'Glacier Flexible Retrieval',
  'Glacier Deep Archive',
  'Intelligent-Tiering-IA',
  'Intelligent-Tiering-AIA',
  'Intelligent-Tiering-AA',
  'Intelligent-Tiering-DAA',
]);

const GCS_COLD_STORAGE_CLASSES = new Set([
  'Nearline',
  'Coldline',
  'Archive',
]);

/** Whether a storage class is a cold/archive tier for the given provider (Azure/R2 have no
 *  cold-tier access model here, so they return false). */
export function isColdStorageClass(provider: Provider, storageClass?: string): boolean {
  if (!storageClass) return false;
  if (provider === 'aws') return AWS_COLD_STORAGE_CLASSES.has(storageClass);
  if (provider === 'gcp') return GCS_COLD_STORAGE_CLASSES.has(storageClass);
  return false;
}

/** Roll up every cold-tier access fee on a bill into labelled groups, sorted by cost descending. */
export function getColdTierAccessSummary(lineItems: ParsedLineItem[]): AccessCostSummary {
  const groups = new Map<string, AccessCostGroup>();

  for (const item of lineItems) {
    const label = getColdTierAccessLabel(item);
    if (!label) continue;

    // Group by label + storage class + unit so mixed units never get summed into one quantity.
    const key = `${label}|${item.storageClass || 'Unattributed'}|${item.usageUnit || ''}`;
    const usageQuantity = item.usageQuantity || 0;
    const existing = groups.get(key);

    if (existing) {
      existing.cost += item.costUsd;
      existing.count++;
      existing.usageQuantity += usageQuantity;
    } else {
      groups.set(key, {
        id: key,
        label,
        storageClass: item.storageClass,
        cost: item.costUsd,
        count: 1,
        usageQuantity,
        usageUnit: item.usageUnit,
      });
    }
  }

  const sortedGroups = Array.from(groups.values())
    .map((group) => ({
      ...group,
      cost: round2(group.cost),
      usageQuantity: round2(group.usageQuantity),
    }))
    .sort((a, b) => b.cost - a.cost);

  const usageUnits = new Set(sortedGroups.map((group) => group.usageUnit).filter(Boolean));
  const usageUnit = usageUnits.size === 1 ? Array.from(usageUnits)[0] : undefined;

  return {
    totalCost: round2(sortedGroups.reduce((sum, group) => sum + group.cost, 0)),
    lineCount: sortedGroups.reduce((sum, group) => sum + group.count, 0),
    usageQuantity: round2(sortedGroups.reduce((sum, group) => sum + group.usageQuantity, 0)),
    usageUnit,
    groups: sortedGroups,
  };
}

/** Whether a single line is a cold-tier access fee (mirrors the grouping in the summary). */
export function isColdTierAccessItem(item: ParsedLineItem): boolean {
  return getColdTierAccessLabel(item) !== null;
}

// Classify a line into a cold-tier access label, or null if it isn't one. Only AWS/GCP carry these
// tier economics; we match on subcategory first, falling back to free-text in description/SKU
// because providers don't expose a consistent structured field for these fee types.
function getColdTierAccessLabel(item: ParsedLineItem): string | null {
  if (item.provider !== 'aws' && item.provider !== 'gcp') return null;

  const subcategory = (item.subcategory || '').toLowerCase();
  const text = `${item.subcategory || ''} ${item.description} ${item.sku}`.toLowerCase();
  const isColdTier = isColdStorageClass(item.provider, item.storageClass);

  if (item.category === 'retrieval') {
    if (
      subcategory.includes('early deletion') ||
      text.includes('earlydelete') ||
      text.includes('early delete') ||
      text.includes('minimum storage duration')
    ) {
      return 'Early deletion and minimum-duration fees';
    }
    return 'Retrieval and cold-data access fees';
  }

  if (item.category !== 'operations') return null;

  // Lifecycle/restore/transition ops are tier-management work that disappears on B2's flat model,
  // regardless of which storage class the line is tagged with.
  if (
    subcategory.includes('lifecycle') ||
    text.includes('restore') ||
    text.includes('transition') ||
    text.includes('tiering')
  ) {
    return 'Tiering, restore, and lifecycle operations';
  }

  // Plain request ops only count as cold-tier access when the line is actually a cold class —
  // hot-tier requests are ordinary operations handled elsewhere, not an access-fee saving.
  if (isColdTier && (
    subcategory.includes('request') ||
    subcategory === 'class a' ||
    subcategory === 'class b' ||
    subcategory.includes('get/select') ||
    subcategory.includes('put/copy/post/list')
  )) {
    return 'Cold-tier request operations';
  }

  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
