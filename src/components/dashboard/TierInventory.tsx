'use client';

import { Fragment, useState } from 'react';
import type { TierInventoryRow, AccountServiceBreakdown } from '@/types/analysis';
import { formatCurrency, formatNumber } from '../shared/FormatCurrency';

type StorageUnit = 'GB' | 'TB' | 'PB';
const UNIT_ORDER: StorageUnit[] = ['GB', 'TB', 'PB'];
const UNIT_DIVISOR: Record<StorageUnit, number> = { GB: 1, TB: 1_000, PB: 1_000_000 };

function formatStorage(gb: number, unit: StorageUnit): string {
  const value = gb / UNIT_DIVISOR[unit];
  if (unit === 'GB') return formatNumber(Math.round(value));
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatRatePerUnit(perTb: number, unit: StorageUnit): string {
  const perGb = perTb / 1_000;
  const value = perGb * UNIT_DIVISOR[unit];
  return formatCurrency(value);
}

function UnitToggle({ unit, label, onClick }: { unit: StorageUnit; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 -my-0.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900 hover:bg-gray-50 active:bg-gray-100 transition-all cursor-pointer text-xs font-semibold shadow-sm"
      title={`Click to cycle: ${UNIT_ORDER.join(' → ')}`}
    >
      {label}
      <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
      </svg>
    </button>
  );
}

interface TierInventoryProps {
  tiers: TierInventoryRow[];
  onToggle: (tierId: string, migrateToB2: boolean) => void;
  accountBreakdowns?: AccountServiceBreakdown[];
}

export function TierInventory({ tiers, onToggle, accountBreakdowns }: TierInventoryProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [storageUnit, setStorageUnit] = useState<StorageUnit>('TB');

  const totalCurrent = tiers.reduce((s, t) => s + t.totalTrueCost, 0);
  const totalB2 = tiers.filter((t) => t.migrateToB2).reduce((s, t) => s + t.modeledB2Cost, 0);
  const totalRemaining = tiers.filter((t) => !t.migrateToB2).reduce((s, t) => s + t.totalTrueCost, 0);

  const breakdownsByTier = new Map<string, AccountServiceBreakdown[]>();
  if (accountBreakdowns) {
    for (const b of accountBreakdowns) {
      const existing = breakdownsByTier.get(b.serviceKey) || [];
      existing.push(b);
      breakdownsByTier.set(b.serviceKey, existing);
    }
  }

  const cycleUnit = () => {
    setStorageUnit((prev) => {
      const idx = UNIT_ORDER.indexOf(prev);
      return UNIT_ORDER[(idx + 1) % UNIT_ORDER.length];
    });
  };

  const toggleExpand = (tierId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) {
        next.delete(tierId);
      } else {
        next.add(tierId);
      }
      return next;
    });
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Storage Tier Inventory</h3>
        <p className="text-sm text-gray-500 mt-1">
          Toggle tiers to include in B2 migration. Hot tiers are enabled by default.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Migrate</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Storage Class</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Region</th>
              <th className="px-4 py-3 text-right">
                <UnitToggle unit={storageUnit} label={`${storageUnit} Stored`} onClick={cycleUnit} />
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Monthly Cost</th>
              <th className="px-4 py-3 text-right">
                <UnitToggle unit={storageUnit} label={`Eff. $/${storageUnit}`} onClick={cycleUnit} />
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Fees</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">True Cost</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">B2 Cost</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Delta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {tiers.map((tier) => {
              const fees = tier.retrievalFees + tier.earlyDeletionFees + tier.monitoringFees + tier.operationsFees;
              const accounts = breakdownsByTier.get(tier.storageClass);
              const hasAccounts = accounts && accounts.length > 0;
              const isExpanded = expanded.has(tier.id);

              return (
                <Fragment key={tier.id}>
                  <tr
                    className={tier.migrateToB2 ? 'bg-green-50/50' : ''}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={tier.migrateToB2}
                        onChange={(e) => onToggle(tier.id, e.target.checked)}
                        className="h-4 w-4 text-bb-red accent-bb-red rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-1.5">
                        {hasAccounts && (
                          <button
                            onClick={() => toggleExpand(tier.id)}
                            className="text-gray-400 hover:text-gray-600 transition-transform"
                            aria-label={isExpanded ? 'Collapse accounts' : 'Expand accounts'}
                          >
                            <svg
                              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        )}
                        {tier.storageClass}
                        {hasAccounts && (
                          <span className="text-xs text-gray-400 font-normal">
                            ({accounts.length} {accounts.length === 1 ? 'account' : 'accounts'})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{tier.region}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatStorage(tier.gbStored, storageUnit)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(tier.monthlyStorageCost)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatRatePerUnit(tier.effectivePerTb, storageUnit)}</td>
                    <td className="px-4 py-3 text-right text-gray-600" title={`Retrieval: ${formatCurrency(tier.retrievalFees)}\nEarly delete: ${formatCurrency(tier.earlyDeletionFees)}\nMonitoring: ${formatCurrency(tier.monitoringFees)}\nOperations: ${formatCurrency(tier.operationsFees)}`}>
                      {formatCurrency(fees)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(tier.totalTrueCost)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {tier.migrateToB2 ? formatCurrency(tier.modeledB2Cost) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${tier.delta > 0 ? 'text-green-700' : tier.delta < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      {tier.migrateToB2 ? formatCurrency(tier.delta) : '—'}
                    </td>
                  </tr>
                  {hasAccounts && isExpanded && accounts.sort((a, b) => b.costUsd - a.costUsd).map((acct) => {
                    const estimatedGb = tier.monthlyStorageCost > 0
                      ? Math.round((acct.costUsd / tier.monthlyStorageCost) * tier.gbStored)
                      : 0;
                    return (
                      <tr key={`${tier.id}-${acct.accountId}`} className="bg-gray-50/70">
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 pl-12 text-gray-600 text-xs" colSpan={2}>
                          <span className="font-medium text-gray-700">{acct.accountName}</span>
                          <span className="ml-2 text-gray-400">{acct.accountId}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 text-xs" title="Estimated from cost proportion">
                          {estimatedGb > 0 ? `~${formatStorage(estimatedGb, storageUnit)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600 text-xs">
                          {formatCurrency(acct.costUsd)}
                        </td>
                        <td className="px-4 py-2" colSpan={5} />
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 font-medium">
            <tr>
              <td className="px-4 py-3" colSpan={7} />
              <td className="px-4 py-3 text-right">{formatCurrency(totalCurrent)}</td>
              <td className="px-4 py-3 text-right">{formatCurrency(totalB2)}</td>
              <td className="px-4 py-3 text-right text-green-700">
                {formatCurrency(totalCurrent - totalB2 - totalRemaining)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
