import type { ParsedLineItem, EgressConfig, TierInventoryRow } from '@/types/analysis';
import b2Pricing from '../pricing/b2.json';
import { getRetrievalRate, getDefaultEgressRate } from '../pricing/lookup';

export interface EgressModelResult {
  eliminatedEgressCost: number;
  newEgressCost: number;
  b2EgressCost: number;
  migrationEgressCost: number;
  migrationRestoreCost: number;
  netEgressSavings: number;
  details: {
    currentInternetEgress: number;
    currentInterRegion: number;
    currentReplication: number;
    b2FreeAllowanceGb: number;
    b2EgressOverageGb: number;
  };
}

export function computeEgressModel(
  lineItems: ParsedLineItem[],
  tiers: TierInventoryRow[],
  config: EgressConfig,
  b2PricePerTb: number
): EgressModelResult {
  const migratedTiers = tiers.filter((t) => t.migrateToB2);
  const totalStorageGb = migratedTiers.reduce((s, t) => s + t.gbStored, 0);
  const totalStorageCost = migratedTiers.reduce((s, t) => s + t.monthlyStorageCost, 0);
  const allStorageCost = tiers.reduce((s, t) => s + t.monthlyStorageCost, 0);
  const migratedProportion = allStorageCost > 0 ? totalStorageCost / allStorageCost : 0;

  // Current egress costs from the bill
  let currentInternetEgress = 0;
  let currentInterRegion = 0;
  let currentReplication = 0;

  for (const item of lineItems) {
    if (item.category !== 'egress') continue;
    const sub = item.subcategory || '';
    if (sub.includes('Internet Egress')) {
      currentInternetEgress += item.costUsd;
    } else if (sub.includes('Inter-region') || sub.includes('Inter Region')) {
      currentInterRegion += item.costUsd;
    } else if (sub.includes('Replication') || sub.includes('Multi-region')) {
      currentReplication += item.costUsd;
    } else {
      // Summary invoices have generic egress entries — treat as internet egress
      currentInternetEgress += item.costUsd;
    }
  }

  // Eliminated egress: proportional to migrated storage
  const eliminatedEgressCost = (currentInternetEgress + currentReplication) * migratedProportion;

  // Determine provider for egress rate
  const provider = migratedTiers[0]?.provider || 'aws';
  const providerEgressRate = getDefaultEgressRate(provider);

  // New egress: hyperscaler → B2 if compute stays in hyperscaler
  let newEgressCost = 0;
  if (config.computeStaysInHyperscaler && !config.computeMovingToPartner) {
    newEgressCost = config.gbPerMonthHyperscalerToB2 * providerEgressRate;
  }

  // B2 egress cost
  const b2FreeAllowanceGb = totalStorageGb * b2Pricing.egress.freeMultiplier;
  const totalEgressGb = config.gbPerMonthServedToUsers;
  let b2EgressCost = 0;

  if (config.usesPartnerCdn) {
    b2EgressCost = 0; // Partner CDN = free egress
  } else {
    const overageGb = Math.max(0, totalEgressGb - b2FreeAllowanceGb);
    b2EgressCost = overageGb * b2Pricing.egress.overagePerGb;
  }

  // Migration egress (one-time)
  // Estimate average egress rate from the bill data
  let totalEgressGbFromBill = 0;
  for (const item of lineItems) {
    if (item.category === 'egress' && item.subcategory?.includes('Internet') && item.usageQuantity) {
      totalEgressGbFromBill += item.usageQuantity;
    }
  }
  const avgEgressRate = totalEgressGbFromBill > 0 && currentInternetEgress > 0
    ? currentInternetEgress / totalEgressGbFromBill
    : providerEgressRate;

  const migrationEgressCost = totalStorageGb * avgEgressRate;

  // Restore costs for cold tiers
  let migrationRestoreCost = 0;
  for (const tier of migratedTiers) {
    const restoreRate = getRetrievalRate(tier.provider, tier.storageClass);
    migrationRestoreCost += tier.gbStored * restoreRate;
  }

  return {
    eliminatedEgressCost: round2(eliminatedEgressCost),
    newEgressCost: round2(newEgressCost),
    b2EgressCost: round2(b2EgressCost),
    migrationEgressCost: round2(migrationEgressCost),
    migrationRestoreCost: round2(migrationRestoreCost),
    netEgressSavings: round2(eliminatedEgressCost - newEgressCost - b2EgressCost),
    details: {
      currentInternetEgress: round2(currentInternetEgress),
      currentInterRegion: round2(currentInterRegion),
      currentReplication: round2(currentReplication),
      b2FreeAllowanceGb: round2(b2FreeAllowanceGb),
      b2EgressOverageGb: round2(Math.max(0, totalEgressGb - b2FreeAllowanceGb)),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
