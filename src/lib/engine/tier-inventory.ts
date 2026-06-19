import type { ParsedLineItem, TierInventoryRow } from '@/types/analysis';
import { v4 as uuid } from 'uuid';
import b2Pricing from '../pricing/b2.json';

const COLD_TIERS = new Set([
  'Glacier Instant Retrieval',
  'Glacier Flexible Retrieval',
  'Glacier Deep Archive',
  'Archive',
  'Coldline',
]);

const LIST_RATE_PER_GB: Record<string, number> = {
  'Standard': 0.023,
  'S3 (Summary)': 0.023,
  'Standard-IA': 0.0125,
  'One Zone-IA': 0.01,
  'Intelligent-Tiering (Frequent)': 0.023,
  'Intelligent-Tiering (Infrequent)': 0.0125,
  'Intelligent-Tiering (Archive Instant)': 0.004,
  'Glacier Instant Retrieval': 0.004,
  'Glacier Flexible Retrieval': 0.0036,
  'Glacier Deep Archive': 0.00099,
  'Glacier': 0.004,
  'Nearline': 0.010,
  'Coldline': 0.004,
  'Archive': 0.0012,
};

const EXCLUDED_TIERS = new Set([
  'Glacier Staging',
  'GDA Staging',
  'Reduced Redundancy',
  'Express One Zone',
]);

export function buildTierInventory(
  lineItems: ParsedLineItem[],
  b2PricePerTb: number = b2Pricing.storage.perTbMonth
): TierInventoryRow[] {
  const tiers = new Map<string, {
    storageClass: string;
    provider: ParsedLineItem['provider'];
    region: string;
    gbStored: number;
    monthlyStorageCost: number;
    retrievalFees: number;
    earlyDeletionFees: number;
    monitoringFees: number;
    operationsFees: number;
  }>();

  for (const item of lineItems) {
    if (!item.storageClass || EXCLUDED_TIERS.has(item.storageClass)) continue;

    const key = `${item.storageClass}|${item.region}`;

    if (!tiers.has(key)) {
      tiers.set(key, {
        storageClass: item.storageClass,
        provider: item.provider,
        region: item.region,
        gbStored: 0,
        monthlyStorageCost: 0,
        retrievalFees: 0,
        earlyDeletionFees: 0,
        monitoringFees: 0,
        operationsFees: 0,
      });
    }

    const tier = tiers.get(key)!;

    if (item.category === 'storage') {
      tier.gbStored += item.usageQuantity || 0;
      tier.monthlyStorageCost += item.costUsd;
    } else if (item.category === 'retrieval') {
      if (item.subcategory === 'Early Deletion') {
        tier.earlyDeletionFees += item.costUsd;
      } else {
        tier.retrievalFees += item.costUsd;
      }
    } else if (item.category === 'operations') {
      if (item.subcategory?.includes('Monitoring') || item.subcategory?.includes('Analytics')) {
        tier.monitoringFees += item.costUsd;
      } else {
        tier.operationsFees += item.costUsd;
      }
    }
  }

  // Also assign unattributed operations/retrieval to tiers proportionally
  const unattributed = {
    operations: 0,
    retrieval: 0,
  };

  for (const item of lineItems) {
    if (!item.storageClass && item.category === 'operations') {
      unattributed.operations += item.costUsd;
    }
    if (!item.storageClass && item.category === 'retrieval') {
      unattributed.retrieval += item.costUsd;
    }
  }

  const totalStorage = Array.from(tiers.values()).reduce((s, t) => s + t.monthlyStorageCost, 0);

  const rows: TierInventoryRow[] = [];

  for (const tier of tiers.values()) {
    if (tier.gbStored <= 0 && tier.monthlyStorageCost <= 0) continue;

    // If no usage quantity was parsed (summary invoices), estimate from cost
    if (tier.gbStored <= 0 && tier.monthlyStorageCost > 0) {
      const listRate = LIST_RATE_PER_GB[tier.storageClass];
      if (listRate) {
        tier.gbStored = Math.round(tier.monthlyStorageCost / listRate);
      }
    }

    const proportion = totalStorage > 0 ? tier.monthlyStorageCost / totalStorage : 0;
    tier.operationsFees += unattributed.operations * proportion;
    tier.retrievalFees += unattributed.retrieval * proportion;

    const effectivePerTb = tier.gbStored > 0
      ? (tier.monthlyStorageCost / tier.gbStored) * 1000
      : 0;
    const totalTrueCost = tier.monthlyStorageCost + tier.retrievalFees +
      tier.earlyDeletionFees + tier.monitoringFees + tier.operationsFees;
    const modeledB2Cost = tier.gbStored * (b2PricePerTb / 1000);
    const delta = totalTrueCost - modeledB2Cost;

    const isCold = COLD_TIERS.has(tier.storageClass);
    const defaultToggle = !isCold && effectivePerTb > b2PricePerTb;

    rows.push({
      id: uuid(),
      storageClass: tier.storageClass,
      provider: tier.provider,
      region: tier.region,
      gbStored: Math.round(tier.gbStored * 100) / 100,
      monthlyStorageCost: Math.round(tier.monthlyStorageCost * 100) / 100,
      effectivePerTb: Math.round(effectivePerTb * 100) / 100,
      retrievalFees: Math.round(tier.retrievalFees * 100) / 100,
      earlyDeletionFees: Math.round(tier.earlyDeletionFees * 100) / 100,
      monitoringFees: Math.round(tier.monitoringFees * 100) / 100,
      operationsFees: Math.round(tier.operationsFees * 100) / 100,
      totalTrueCost: Math.round(totalTrueCost * 100) / 100,
      modeledB2Cost: Math.round(modeledB2Cost * 100) / 100,
      delta: Math.round(delta * 100) / 100,
      migrateToB2: defaultToggle,
    });
  }

  return rows.sort((a, b) => b.monthlyStorageCost - a.monthlyStorageCost);
}
