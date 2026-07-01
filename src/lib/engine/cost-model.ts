import type { ParsedLineItem, TierInventoryRow, EgressConfig, B2ServiceTier } from '@/types/analysis';
import type { CostModelResult, EliminatedFee, B2CostBreakdown, CostBreakdown } from '@/types/model';
import { computeEgressModel } from './egress-model';
import { hasUnlimitedEgress } from '../pricing/service-levels';
import b2Pricing from '../pricing/b2.json';

// Core economics: turn the parsed bill plus the AE's tier selection into the current-vs-B2
// comparison the dashboard and customer report render. Savings are scoped to the migrated
// (addressable storage-scope) tiers only — this is not a full cloud-bill replacement model.

/**
 * Build the full current-vs-B2 cost comparison for the tiers the AE chose to migrate.
 * @param b2PricePerTb Negotiated B2 storage rate in $/TB-month (internally divided by 1000 to GB-month).
 */
export function computeCostModel(
  lineItems: ParsedLineItem[],
  tiers: TierInventoryRow[],
  egressConfig: EgressConfig,
  b2PricePerTb: number,
  /** Defaults to 'committed' — today's implicit baseline — so existing callers see no behavior change. */
  b2ServiceTier: B2ServiceTier = 'committed',
): CostModelResult {
  const migratedTiers = tiers.filter((t) => t.migrateToB2);
  const totalStorageGb = migratedTiers.reduce((s, t) => s + t.gbStored, 0);

  // Current monthly costs from the bill
  const currentMonthly: CostBreakdown = {
    storage: 0,
    egress: 0,
    operations: 0,
    retrieval: 0,
    otherFees: 0,
    total: 0,
  };

  for (const item of lineItems) {
    switch (item.category) {
      case 'storage':
        currentMonthly.storage += item.costUsd;
        break;
      case 'egress':
        currentMonthly.egress += item.costUsd;
        break;
      case 'operations':
        currentMonthly.operations += item.costUsd;
        break;
      case 'retrieval':
        currentMonthly.retrieval += item.costUsd;
        break;
      case 'storage-adjacent':
        currentMonthly.otherFees += item.costUsd;
        break;
    }
  }
  currentMonthly.total = currentMonthly.storage + currentMonthly.egress +
    currentMonthly.operations + currentMonthly.retrieval + currentMonthly.otherFees;

  // Egress model
  const egress = computeEgressModel(lineItems, tiers, egressConfig, hasUnlimitedEgress(b2ServiceTier));

  // B2 costs for migrated tiers
  const b2StorageCost = migratedTiers.reduce(
    (sum, t) => sum + t.gbStored * (b2PricePerTb / 1000),
    0,
  );

  // B2 second-region copy for GCP geo-redundant storage. GCP multi-region/dual-region storage is
  // billed as a single line but stored redundantly across regions; to match that durability on B2
  // the data must be replicated to a second region, i.e. stored twice (~2x per-TB). The eliminated
  // GCP replication egress stays a saving (B2 Cloud Replication transfer is free) — this is the
  // offsetting ongoing B2 storage cost. Scoped to GCP because AWS cross-region replication already
  // appears as two separate buckets in the bill, so doubling it here would double-count.
  const geoRedundantGb = migratedTiers
    .filter((t) => t.provider === 'gcp' && /multi[\s-]?region|dual[\s-]?region/i.test(t.region))
    .reduce((sum, t) => sum + t.gbStored, 0);
  const b2ReplicationStorageCost = round2(geoRedundantGb * (b2PricePerTb / 1000));

  const b2Monthly: B2CostBreakdown = {
    storage: round2(b2StorageCost),
    egress: egress.b2EgressCost,
    transactions: 0, // All standard B2 transactions are free
    total: round2(b2StorageCost + egress.b2EgressCost),
  };

  // Eliminated fees
  const eliminatedFees: EliminatedFee[] = [];

  const eliminatedStorage = migratedTiers.reduce((s, t) => s + t.monthlyStorageCost, 0);
  if (eliminatedStorage > 0) {
    eliminatedFees.push({
      description: 'Storage costs for migrated tiers',
      category: 'storage',
      amountUsd: round2(eliminatedStorage),
    });
  }

  const eliminatedRetrieval = migratedTiers.reduce((s, t) => s + t.retrievalFees, 0);
  if (eliminatedRetrieval > 0) {
    eliminatedFees.push({
      description: 'Retrieval fees (no retrieval fees on B2)',
      category: 'retrieval',
      amountUsd: round2(eliminatedRetrieval),
    });
  }

  const eliminatedEarlyDeletion = migratedTiers.reduce((s, t) => s + t.earlyDeletionFees, 0);
  if (eliminatedEarlyDeletion > 0) {
    eliminatedFees.push({
      description: 'Early deletion fees (no minimum duration on B2)',
      category: 'retrieval',
      amountUsd: round2(eliminatedEarlyDeletion),
    });
  }

  const eliminatedMonitoring = migratedTiers.reduce((s, t) => s + t.monitoringFees, 0);
  if (eliminatedMonitoring > 0) {
    eliminatedFees.push({
      description: 'Monitoring/analytics fees',
      category: 'operations',
      amountUsd: round2(eliminatedMonitoring),
    });
  }

  const eliminatedOps = migratedTiers.reduce((s, t) => s + t.operationsFees, 0);
  if (eliminatedOps > 0) {
    eliminatedFees.push({
      description: 'API request fees (B2 transactions are free)',
      category: 'operations',
      amountUsd: round2(eliminatedOps),
    });
  }

  if (egress.eliminatedEgressCost > 0) {
    eliminatedFees.push({
      description: 'Internet egress and replication fees',
      category: 'egress',
      amountUsd: egress.eliminatedEgressCost,
    });
  }

  // New costs
  const newCosts: { description: string; amountUsd: number }[] = [];
  if (egress.newEgressCost > 0) {
    newCosts.push({
      description: 'Hyperscaler to B2 processed-data egress',
      amountUsd: egress.newEgressCost,
    });
  }
  if (b2ReplicationStorageCost > 0) {
    newCosts.push({
      description: 'B2 second-region copy to match GCP geo-redundancy',
      amountUsd: b2ReplicationStorageCost,
    });
  }

  // Total savings
  const totalEliminated = eliminatedFees.reduce((s, f) => s + f.amountUsd, 0);
  const totalNew = b2Monthly.total + newCosts.reduce((s, c) => s + c.amountUsd, 0);
  const monthlySavings = totalEliminated - totalNew;
  const partnerComputeScenario = egress.newEgressCost > 0
    ? {
        monthlyEgressAvoided: egress.newEgressCost,
        monthlySavings: round2(monthlySavings + egress.newEgressCost),
        annualSavings: round2((monthlySavings + egress.newEgressCost) * 12),
      }
    : null;
  const addressableSpend = migratedTiers.reduce((s, t) => s + t.totalTrueCost, 0) +
    egress.eliminatedEgressCost;
  const savingsPercent = addressableSpend > 0 ? (monthlySavings / addressableSpend) * 100 : 0;

  // Migration cost and break-even
  const fullMigrationCost = round2(egress.migrationEgressCost + egress.migrationRestoreCost);
  const udmEnabled = egressConfig.udmEnabled;
  const customerMigrationCost = udmEnabled ? 0 : fullMigrationCost;

  const migrationCost = {
    egressCost: egress.migrationEgressCost,
    restoreCost: egress.migrationRestoreCost,
    total: customerMigrationCost,
  };

  const udmCostToBackblaze = udmEnabled
    ? round2(totalStorageGb * b2Pricing.udm.costPerGb)
    : 0;

  const breakEvenMonth = monthlySavings > 0 && customerMigrationCost > 0
    ? Math.ceil(customerMigrationCost / monthlySavings)
    : monthlySavings > 0 ? 0 : null;

  return {
    currentMonthly: roundBreakdown(currentMonthly),
    b2Monthly,
    eliminatedFees,
    newCosts,
    partnerComputeScenario,
    migrationCost,
    udmEnabled,
    udmCostToBackblaze,
    b2ServiceTier,
    monthlySavings: round2(monthlySavings),
    annualSavings: round2(monthlySavings * 12),
    savingsPercent: round2(savingsPercent),
    breakEvenMonth,
  };
}

/**
 * Today's monthly spend within the addressable storage scope — the sum of fees migration
 * eliminates, which by construction is exactly the storage-scope slice of the current bill.
 */
export function getStorageScopeCurrentMonthly(result: Pick<CostModelResult, 'eliminatedFees'>): number {
  return round2(result.eliminatedFees.reduce((sum, fee) => sum + fee.amountUsd, 0));
}

/** The B2 replacement spend for that same storage scope: B2 charges plus any new costs migration introduces. */
export function getStorageScopeReplacementMonthly(result: Pick<CostModelResult, 'b2Monthly' | 'newCosts'>): number {
  return round2(
    result.b2Monthly.total + result.newCosts.reduce((sum, cost) => sum + cost.amountUsd, 0),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundBreakdown(b: CostBreakdown): CostBreakdown {
  return {
    storage: round2(b.storage),
    egress: round2(b.egress),
    operations: round2(b.operations),
    retrieval: round2(b.retrieval),
    otherFees: round2(b.otherFees),
    total: round2(b.total),
  };
}
