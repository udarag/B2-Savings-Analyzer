import b2Pricing from '../pricing/b2.json';
import { getListRate } from '../pricing/lookup';
import type { ParsedLineItem, TierInventoryRow } from '@/types/analysis';
import { getDefaultTierMigration, makeTierInventoryId } from './tier-selection';

// Collapses the flat list of parsed bill lines into one row per storage tier (storage class +
// region), rolling each tier's storage, retrieval, ops and other fees into a single "true cost"
// the AE can compare against B2 and toggle for migration.

// Tiers we never present as migration candidates: transient staging buckets that aren't real
// stored data, and classes whose durability/semantics don't map cleanly to B2 standard storage.
const EXCLUDED_TIERS = new Set([
  'Glacier Staging',
  'GDA Staging',
  'Reduced Redundancy',
  'Express One Zone',
]);

// Drop sub-half-cent / sub-0.005 GB rows so rounding dust from the bill doesn't clutter the table.
const MIN_DISPLAYABLE_COST_USD = 0.005;
const MIN_DISPLAYABLE_GB = 0.005;

/**
 * Aggregate parsed line items into per-tier inventory rows, default-selected for migration.
 * @param b2PricePerTb B2 storage rate ($/TB-month) used to model each tier's B2 cost and delta.
 */
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

    // Same storage class in two regions is two distinct tiers (different rates, durability).
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

  // Bills often carry account-level operations/retrieval lines with no storage class. Pool them
  // here and spread across tiers by storage-cost share below, so these real fees still count
  // toward each tier's true cost instead of being dropped.
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

    // Summary invoices give a dollar amount but no GB. Back into stored GB from cost / list rate
    // so the tier still has a size to migrate and project; skip if no list rate is known.
    if (tier.gbStored <= 0 && tier.monthlyStorageCost > 0) {
      const listRate = getListRate(tier.provider, tier.storageClass, tier.region);
      if (listRate) {
        tier.gbStored = Math.round(tier.monthlyStorageCost / listRate);
      }
    }

    // Distribute the pooled account-level fees by this tier's share of total storage cost.
    const proportion = totalStorage > 0 ? tier.monthlyStorageCost / totalStorage : 0;
    tier.operationsFees += unattributed.operations * proportion;
    tier.retrievalFees += unattributed.retrieval * proportion;

    // Blended effective rate in $/TB-month (x1000 from the $/GB basis), used for the B2 comparison
    // and the default-migrate decision. For AWS Standard this blends its volume tiers into one rate.
    const effectivePerTb = tier.gbStored > 0
      ? (tier.monthlyStorageCost / tier.gbStored) * 1000
      : 0;
    const totalTrueCost = tier.monthlyStorageCost + tier.retrievalFees +
      tier.earlyDeletionFees + tier.monitoringFees + tier.operationsFees;
    if (Math.abs(tier.monthlyStorageCost) < MIN_DISPLAYABLE_COST_USD && Math.abs(totalTrueCost) < MIN_DISPLAYABLE_COST_USD) {
      continue;
    }
    if (tier.gbStored < MIN_DISPLAYABLE_GB && Math.abs(totalTrueCost) < MIN_DISPLAYABLE_COST_USD) {
      continue;
    }

    // delta vs B2 compares the tier's full true cost (storage + all fees) to B2 storage alone,
    // since B2's transactions are free and it has no retrieval/early-deletion fees to add back.
    const modeledB2Cost = tier.gbStored * (b2PricePerTb / 1000);
    const delta = totalTrueCost - modeledB2Cost;

    const defaultToggle = getDefaultTierMigration(tier.storageClass, effectivePerTb, b2PricePerTb);

    rows.push({
      id: makeTierInventoryId(tier.provider, tier.storageClass, tier.region),
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

  // Largest storage spend first, so the biggest savings opportunities lead the table.
  return rows.sort((a, b) => b.monthlyStorageCost - a.monthlyStorageCost);
}
