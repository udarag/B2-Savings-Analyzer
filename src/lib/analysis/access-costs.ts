import type { ParsedLineItem, Provider } from '@/types/analysis';

export interface AccessCostGroup {
  id: string;
  label: string;
  storageClass?: string;
  cost: number;
  count: number;
  usageQuantity: number;
  usageUnit?: string;
}

export interface AccessCostSummary {
  totalCost: number;
  lineCount: number;
  usageQuantity: number;
  usageUnit?: string;
  groups: AccessCostGroup[];
}

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

export function isColdStorageClass(provider: Provider, storageClass?: string): boolean {
  if (!storageClass) return false;
  if (provider === 'aws') return AWS_COLD_STORAGE_CLASSES.has(storageClass);
  if (provider === 'gcp') return GCS_COLD_STORAGE_CLASSES.has(storageClass);
  return false;
}

export function getColdTierAccessSummary(lineItems: ParsedLineItem[]): AccessCostSummary {
  const groups = new Map<string, AccessCostGroup>();

  for (const item of lineItems) {
    const label = getColdTierAccessLabel(item);
    if (!label) continue;

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

export function isColdTierAccessItem(item: ParsedLineItem): boolean {
  return getColdTierAccessLabel(item) !== null;
}

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

  if (
    subcategory.includes('lifecycle') ||
    text.includes('restore') ||
    text.includes('transition') ||
    text.includes('tiering')
  ) {
    return 'Tiering, restore, and lifecycle operations';
  }

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
