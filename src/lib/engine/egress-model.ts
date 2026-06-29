import type { ParsedLineItem, EgressConfig, TierInventoryRow } from '@/types/analysis';
import b2Pricing from '../pricing/b2.json';
import { getRetrievalRate, getDefaultEgressRate } from '../pricing/lookup';

// Egress economics — the trickiest part of the comparison, because B2's egress story
// (free up to 3x stored data, free over partner CDNs) differs in kind from hyperscaler
// per-GB egress. Splits into ongoing monthly egress and one-time migration egress.

/** Result of the egress comparison. All money values are monthly USD unless named "migration*" (one-time). */
export interface EgressModelResult {
  /** Hyperscaler egress/replication fees migration removes, scaled to the migrated share of storage. */
  eliminatedEgressCost: number;
  /** New hyperscaler->B2 egress incurred when hyperscaler compute still writes processed data into B2. */
  newEgressCost: number;
  /** Ongoing B2 egress to end users, after the free allowance / partner-CDN exemption. */
  b2EgressCost: number;
  /** One-time cost to pull all migrated data out of the source provider (paid unless UDM covers it). */
  migrationEgressCost: number;
  /** One-time retrieval cost to thaw cold tiers so they can be migrated. */
  migrationRestoreCost: number;
  netEgressSavings: number;
  details: {
    currentInternetEgress: number;
    currentInterRegion: number;
    currentReplication: number;
    /** Free B2 egress = 3x stored GB/month (b2.freeMultiplier); overage billed per GB. */
    b2FreeAllowanceGb: number;
    b2EgressOverageGb: number;
  };
}

/**
 * Model ongoing and one-time egress costs for the migrated tiers.
 * Eliminated egress is prorated to the migrated share of storage because the bill's egress
 * lines aren't attributable to individual tiers.
 */
export function computeEgressModel(
  lineItems: ParsedLineItem[],
  tiers: TierInventoryRow[],
  config: EgressConfig,
): EgressModelResult {
  const migratedTiers = tiers.filter((t) => t.migrateToB2);
  const totalStorageGb = migratedTiers.reduce((s, t) => s + t.gbStored, 0);
  const totalStorageCost = migratedTiers.reduce((s, t) => s + t.monthlyStorageCost, 0);
  const allStorageCost = tiers.reduce((s, t) => s + t.monthlyStorageCost, 0);
  // Bill egress lines aren't tagged by tier, so attribute the eliminated share by storage spend:
  // if the migrated tiers are 60% of storage cost, credit 60% of the egress as eliminated.
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

  // Inter-region egress is intentionally excluded: it stays internal to the source cloud and
  // isn't an internet egress charge B2 displaces, so only internet + replication egress is credited.
  const eliminatedEgressCost = (currentInternetEgress + currentReplication) * migratedProportion;

  // Provider/region of the largest-by-default first tier drives the per-GB egress rate used for
  // both new and (as a fallback) migration egress. Defaults to AWS when no tier is migrated.
  const provider = migratedTiers[0]?.provider || 'aws';
  const providerEgressRate = getDefaultEgressRate(provider, migratedTiers[0]?.region);

  // New ongoing egress only when hyperscaler compute stays put and keeps writing processed output
  // into B2 (so each write crosses the cloud boundary). If that compute is moving to a partner,
  // those writes become partner->B2 and incur no hyperscaler egress, so skip the charge.
  let newEgressCost = 0;
  if (config.hasHyperscalerCompute && config.hyperscalerComputeFeedsStorage && !config.computeMovingToPartner) {
    newEgressCost = config.gbPerMonthHyperscalerToB2 * providerEgressRate;
  }

  // B2 bundles free egress at 3x stored data per month; only the overage is billed.
  const b2FreeAllowanceGb = totalStorageGb * b2Pricing.egress.freeMultiplier;
  const totalEgressGb = config.gbPerMonthServedToUsers;
  // A training workflow (compute that reads but doesn't feed storage) doesn't serve via a CDN, so
  // it can't claim the partner-CDN free-egress exemption even when usesPartnerCdn is set.
  const isTrainingWorkflow = config.hasHyperscalerCompute && !config.hyperscalerComputeFeedsStorage;
  let b2EgressCost = 0;

  if (config.usesPartnerCdn && !isTrainingWorkflow) {
    b2EgressCost = 0; // Egress over a B2 partner CDN (Cloudflare, Fastly, ...) is free regardless of volume
  } else {
    const overageGb = Math.max(0, totalEgressGb - b2FreeAllowanceGb);
    b2EgressCost = overageGb * b2Pricing.egress.overagePerGb;
  }

  // One-time cost to egress every migrated GB out of the source cloud. Prefer the customer's own
  // blended egress rate ($ / GB) implied by the bill, since tiered/committed pricing makes it more
  // accurate than the list rate; fall back to the provider default when the bill lacks the detail.
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

  // Cold/archive tiers must be thawed before they can be read out, so migrating them incurs a
  // one-time retrieval fee on top of egress (per-class rate; hot tiers return 0).
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
