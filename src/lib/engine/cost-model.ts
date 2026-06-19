import type { ParsedLineItem, TierInventoryRow, EgressConfig } from '@/types/analysis';
import type { CostModelResult, EliminatedFee, B2CostBreakdown, CostBreakdown } from '@/types/model';
import { computeEgressModel } from './egress-model';

export function computeCostModel(
  lineItems: ParsedLineItem[],
  tiers: TierInventoryRow[],
  egressConfig: EgressConfig,
  b2PricePerTb: number,
): CostModelResult {
  const migratedTiers = tiers.filter((t) => t.migrateToB2);
  const remainingTiers = tiers.filter((t) => !t.migrateToB2);
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
  const egress = computeEgressModel(lineItems, tiers, egressConfig, b2PricePerTb);

  // B2 costs for migrated tiers
  const b2StorageCost = migratedTiers.reduce(
    (sum, t) => sum + t.gbStored * (b2PricePerTb / 1000),
    0,
  );

  const b2Monthly: B2CostBreakdown = {
    storage: round2(b2StorageCost),
    egress: egress.b2EgressCost,
    transactions: 0, // All standard B2 transactions are free
    total: round2(b2StorageCost + egress.b2EgressCost),
  };

  // Remaining hyperscaler costs (unmigrated tiers + non-storage)
  const remainingHyperscalerStorage = remainingTiers.reduce(
    (sum, t) => sum + t.totalTrueCost,
    0,
  );

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
      description: 'Hyperscaler → B2 pipeline egress (compute stays in hyperscaler)',
      amountUsd: egress.newEgressCost,
    });
  }

  // Total savings
  const totalEliminated = eliminatedFees.reduce((s, f) => s + f.amountUsd, 0);
  const totalNew = b2Monthly.total + newCosts.reduce((s, c) => s + c.amountUsd, 0);
  const monthlySavings = totalEliminated - totalNew;
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

  // Backblaze's UDM cost: $0.03/GB (their negotiated hyperscaler egress rate)
  const BACKBLAZE_UDM_RATE_PER_GB = 0.03;
  const udmCostToBackblaze = udmEnabled
    ? round2(totalStorageGb * BACKBLAZE_UDM_RATE_PER_GB)
    : 0;

  const breakEvenMonth = monthlySavings > 0 && customerMigrationCost > 0
    ? Math.ceil(customerMigrationCost / monthlySavings)
    : monthlySavings > 0 ? 0 : null;

  return {
    currentMonthly: roundBreakdown(currentMonthly),
    b2Monthly,
    eliminatedFees,
    newCosts,
    migrationCost,
    udmEnabled,
    udmCostToBackblaze,
    monthlySavings: round2(monthlySavings),
    annualSavings: round2(monthlySavings * 12),
    savingsPercent: round2(savingsPercent),
    breakEvenMonth,
  };
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
