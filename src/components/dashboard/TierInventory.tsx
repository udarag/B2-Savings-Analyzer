'use client';

import { Fragment, useState } from 'react';
import type { TierInventoryRow, AccountServiceBreakdown } from '@/types/analysis';
import { isHotStorageTier } from '@/lib/engine/tier-selection';
import { getRegionLocation } from '@/lib/regions';
import { formatStorageTierName, getStorageTierHelp } from '@/lib/storage-tiers';
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
  return `${formatCurrency(value)}/${unit}`;
}

function UnitToggle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-8 min-w-[104px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100 cursor-pointer"
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

interface TierGroup {
  storageClass: string;
  rows: TierInventoryRow[];
  gbStored: number;
  monthlyStorageCost: number;
  fees: number;
  totalTrueCost: number;
  selectedB2Cost: number;
  selectedDelta: number;
  selectedCount: number;
  accounts: AccountServiceBreakdown[];
}

const TIER_ORDER: Record<string, number> = {
  Standard: 0,
  'S3 (Summary)': 0,
  'Hot-LRS': 0,
  'Hot-ZRS': 0,
  'Hot-GRS': 0,
  'Hot-RA-GRS': 0,
  'Intelligent-Tiering-FA': 1,
  'Standard-IA': 2,
  'One Zone-IA': 3,
  'Intelligent-Tiering-IA': 4,
  'Intelligent-Tiering-AIA': 5,
  'Glacier Instant Retrieval': 6,
  'Glacier Flexible Retrieval': 7,
  'Glacier Deep Archive': 8,
  'Intelligent-Tiering-AA': 9,
  'Intelligent-Tiering-DAA': 10,
  Nearline: 11,
  'Cool-LRS': 11,
  'Cool-ZRS': 11,
  'Cool-GRS': 11,
  'Cool-RA-GRS': 11,
  Coldline: 12,
  'Cold-LRS': 12,
  'Cold-ZRS': 12,
  'Cold-GRS': 12,
  'Cold-RA-GRS': 12,
  Archive: 13,
  'Archive-LRS': 13,
  'Archive-GRS': 13,
  'Archive-RA-GRS': 13,
};

function tierRank(storageClass: string): number {
  return TIER_ORDER[storageClass] ?? 50;
}

function tierTemperature(storageClass: string): { label: string; className: string } {
  if (isHotStorageTier(storageClass)) {
    return { label: 'Hot', className: 'bg-red-50 text-red-700 ring-red-100' };
  }
  if (storageClass.includes('IA') || storageClass.includes('Nearline') || storageClass.includes('Cool')) {
    return { label: 'Warm', className: 'bg-amber-50 text-amber-700 ring-amber-100' };
  }
  return { label: 'Cooler', className: 'bg-blue-50 text-blue-700 ring-blue-100' };
}

function weightedRatePerTb(group: TierGroup): number {
  return group.gbStored > 0 ? (group.monthlyStorageCost / group.gbStored) * 1000 : 0;
}

function StorageTierHelpLink({ group }: { group: TierGroup }) {
  const provider = group.rows[0]?.provider;
  const tierName = formatStorageTierName(group.storageClass);
  const help = getStorageTierHelp(group.storageClass, provider);

  return (
    <a
      href={help.docsUrl}
      target="_blank"
      rel="noreferrer"
      title={`${tierName}: ${help.description}`}
      aria-label={`Learn about ${tierName}: ${help.description}`}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-[11px] font-bold leading-none text-gray-500 transition-colors hover:border-bb-red hover:bg-bb-red-light hover:text-bb-red-dark focus:outline-none focus:ring-2 focus:ring-bb-red/30"
      onClick={(e) => e.stopPropagation()}
    >
      ?
    </a>
  );
}

function GroupCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(input) => {
        if (input) input.indeterminate = indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className="h-4 w-4 text-bb-red accent-bb-red rounded"
    />
  );
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

  const groups = Array.from(tiers.reduce((map, tier) => {
    const existing = map.get(tier.storageClass) || [];
    existing.push(tier);
    map.set(tier.storageClass, existing);
    return map;
  }, new Map<string, TierInventoryRow[]>()).entries())
    .map(([storageClass, rows]): TierGroup => {
      const accounts = (breakdownsByTier.get(storageClass) || [])
        .sort((a, b) => b.costUsd - a.costUsd);
      return {
        storageClass,
        rows: [...rows].sort((a, b) => b.totalTrueCost - a.totalTrueCost),
        gbStored: rows.reduce((s, t) => s + t.gbStored, 0),
        monthlyStorageCost: rows.reduce((s, t) => s + t.monthlyStorageCost, 0),
        fees: rows.reduce((s, t) => s + t.retrievalFees + t.earlyDeletionFees + t.monitoringFees + t.operationsFees, 0),
        totalTrueCost: rows.reduce((s, t) => s + t.totalTrueCost, 0),
        selectedB2Cost: rows.filter(t => t.migrateToB2).reduce((s, t) => s + t.modeledB2Cost, 0),
        selectedDelta: rows.filter(t => t.migrateToB2).reduce((s, t) => s + t.delta, 0),
        selectedCount: rows.filter(t => t.migrateToB2).length,
        accounts,
      };
    })
    .sort((a, b) => {
      const rankDiff = tierRank(a.storageClass) - tierRank(b.storageClass);
      if (rankDiff !== 0) return rankDiff;
      return b.totalTrueCost - a.totalTrueCost;
    });

  const cycleUnit = () => {
    setStorageUnit((prev) => {
      const idx = UNIT_ORDER.indexOf(prev);
      return UNIT_ORDER[(idx + 1) % UNIT_ORDER.length];
    });
  };

  const toggleExpand = (storageClass: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(storageClass)) {
        next.delete(storageClass);
      } else {
        next.add(storageClass);
      }
      return next;
    });
  };

  const toggleGroup = (group: TierGroup, migrateToB2: boolean) => {
    for (const row of group.rows) {
      if (row.migrateToB2 !== migrateToB2) {
        onToggle(row.id, migrateToB2);
      }
    }
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Storage Tier Inventory</h3>
        <p className="text-sm text-gray-500 mt-1">
          Hot tiers are selected by default. Expand a tier for region-level selection and account allocation.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-4 text-left align-middle font-semibold text-gray-500 whitespace-nowrap">Migrate</th>
              <th className="px-4 py-4 text-left align-middle font-semibold text-gray-500 whitespace-nowrap">Storage Tier</th>
              <th className="px-4 py-4 text-left align-middle font-semibold text-gray-500 whitespace-nowrap">Coverage</th>
              <th className="px-4 py-4 text-center align-middle whitespace-nowrap">
                <UnitToggle label={`${storageUnit} Stored`} onClick={cycleUnit} />
              </th>
              <th className="px-4 py-4 text-center align-middle font-semibold text-gray-500 whitespace-nowrap">Monthly Cost</th>
              <th className="px-4 py-4 text-center align-middle whitespace-nowrap">
                <UnitToggle label="Effective" onClick={cycleUnit} />
              </th>
              <th className="px-4 py-4 text-center align-middle font-semibold text-gray-500 whitespace-nowrap">Fees</th>
              <th className="px-4 py-4 text-center align-middle font-semibold text-gray-500 whitespace-nowrap">True Cost</th>
              <th className="px-4 py-4 text-center align-middle font-semibold text-bb-red-dark bg-bb-red-light whitespace-nowrap">B2 Cost</th>
              <th className="px-4 py-4 text-center align-middle font-semibold text-gray-500 whitespace-nowrap">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {groups.map((group) => {
              const isExpanded = expanded.has(group.storageClass);
              const allSelected = group.selectedCount === group.rows.length;
              const partiallySelected = group.selectedCount > 0 && group.selectedCount < group.rows.length;
              const temperature = tierTemperature(group.storageClass);
              const regionCount = new Set(group.rows.map(r => r.region)).size;
              const accountCount = group.accounts.length;

              return (
                <Fragment key={group.storageClass}>
                  <tr
                    className={group.selectedCount > 0 ? 'bg-green-50/50' : ''}
                  >
                    <td className="px-4 py-3">
                      <GroupCheckbox
                        checked={allSelected}
                        indeterminate={partiallySelected}
                        onChange={(checked) => toggleGroup(group, checked)}
                        ariaLabel={`Migrate all ${formatStorageTierName(group.storageClass)}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleExpand(group.storageClass)}
                          className="text-gray-400 hover:text-gray-600 transition-transform"
                          aria-label={isExpanded ? `Collapse ${formatStorageTierName(group.storageClass)}` : `Expand ${formatStorageTierName(group.storageClass)}`}
                        >
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <span>{formatStorageTierName(group.storageClass)}</span>
                        <StorageTierHelpLink group={group} />
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${temperature.className}`}>
                          {temperature.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="flex flex-col">
                        <span>{regionCount} {regionCount === 1 ? 'region' : 'regions'}</span>
                        <span className="text-xs text-gray-400">
                          {group.selectedCount}/{group.rows.length} selected
                          {accountCount > 0 ? ` · ${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatStorage(group.gbStored, storageUnit)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(group.monthlyStorageCost)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatRatePerUnit(weightedRatePerTb(group), storageUnit)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {formatCurrency(group.fees)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(group.totalTrueCost)}</td>
                    <td className="px-4 py-3 text-right bg-bb-red-light/40">
                      {group.selectedCount > 0 ? (
                        <span className="inline-flex justify-end rounded-md bg-white px-2 py-1 font-semibold text-bb-red-dark ring-1 ring-red-100 shadow-sm">
                          {formatCurrency(group.selectedB2Cost)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${group.selectedDelta > 0 ? 'text-green-700' : group.selectedDelta < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      {group.selectedCount > 0 ? formatCurrency(group.selectedDelta) : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50">
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" colSpan={9}>
                        <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
                          <div className="grid grid-cols-[44px_1.15fr_1.2fr_repeat(7,minmax(82px,1fr))] items-center gap-0 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            <span />
                            <span className="whitespace-nowrap">Region</span>
                            <span className="whitespace-nowrap">Location</span>
                            <span className="text-right whitespace-nowrap">{storageUnit}</span>
                            <span className="text-right whitespace-nowrap">Monthly</span>
                            <span className="text-right whitespace-nowrap">Effective</span>
                            <span className="text-right whitespace-nowrap">Fees</span>
                            <span className="text-right whitespace-nowrap">True</span>
                            <span className="text-right text-bb-red-dark whitespace-nowrap">B2</span>
                            <span className="text-right whitespace-nowrap">Savings</span>
                          </div>
                          {group.rows.map((tier) => {
                            const fees = tier.retrievalFees + tier.earlyDeletionFees + tier.monitoringFees + tier.operationsFees;
                            const location = getRegionLocation(tier.region);
                            return (
                              <div key={tier.id} className={`grid grid-cols-[44px_1.15fr_1.2fr_repeat(7,minmax(82px,1fr))] gap-0 px-3 py-2 text-xs border-t border-gray-100 ${tier.migrateToB2 ? 'bg-green-50/60' : ''}`}>
                                <span>
                                  <input
                                    type="checkbox"
                                    checked={tier.migrateToB2}
                                    onChange={(e) => onToggle(tier.id, e.target.checked)}
                                    aria-label={`Migrate ${tier.storageClass} in ${tier.region}`}
                                    className="h-4 w-4 text-bb-red accent-bb-red rounded"
                                  />
                                </span>
                                <span className="font-medium text-gray-800">{tier.region}</span>
                                <span className={location ? 'font-medium text-gray-600' : 'text-gray-400'}>
                                  {location || '—'}
                                </span>
                                <span className="text-right text-gray-700">{formatStorage(tier.gbStored, storageUnit)}</span>
                                <span className="text-right text-gray-700">{formatCurrency(tier.monthlyStorageCost)}</span>
                                <span className="text-right text-gray-500">{formatRatePerUnit(tier.effectivePerTb, storageUnit)}</span>
                                <span className="text-right text-gray-500" title={`Retrieval: ${formatCurrency(tier.retrievalFees)}\nEarly Delete: ${formatCurrency(tier.earlyDeletionFees)}\nMonitoring: ${formatCurrency(tier.monitoringFees)}\nOperations: ${formatCurrency(tier.operationsFees)}`}>
                                  {formatCurrency(fees)}
                                </span>
                                <span className="text-right font-medium text-gray-800">{formatCurrency(tier.totalTrueCost)}</span>
                                <span className="text-right">
                                  {tier.migrateToB2 ? (
                                    <span className="inline-flex rounded-md bg-bb-red-light px-2 py-0.5 font-semibold text-bb-red-dark ring-1 ring-red-100">
                                      {formatCurrency(tier.modeledB2Cost)}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </span>
                                <span className={`text-right font-medium ${tier.delta > 0 ? 'text-green-700' : tier.delta < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                  {tier.migrateToB2 ? formatCurrency(tier.delta) : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {group.accounts.length > 0 && (
                          <div className="mt-3 rounded-md border border-gray-200 bg-white overflow-hidden">
                            <div className="bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              Account Allocation
                            </div>
                            {group.accounts.map((acct) => {
                              const estimatedGb = group.monthlyStorageCost > 0
                                ? Math.round((acct.costUsd / group.monthlyStorageCost) * group.gbStored)
                                : 0;
                              return (
                                <div key={`${group.storageClass}-${acct.accountId}`} className="grid grid-cols-[1.5fr_1fr_120px_120px] gap-3 border-t border-gray-100 px-3 py-2 text-xs">
                                  <span className="font-medium text-gray-700">{acct.accountName}</span>
                                  <span className="text-gray-400">{acct.accountId}</span>
                                  <span className="text-right text-gray-500" title="Estimated from Cost Proportion">
                                    {estimatedGb > 0 ? `~${formatStorage(estimatedGb, storageUnit)}` : '—'}
                                  </span>
                                  <span className="text-right text-gray-700">{formatCurrency(acct.costUsd)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 font-medium">
            <tr>
              <td className="px-4 py-3" colSpan={7} />
              <td className="px-4 py-3 text-right">{formatCurrency(totalCurrent)}</td>
              <td className="px-4 py-3 text-right bg-bb-red-light">
                <span className="inline-flex rounded-md bg-white px-2 py-1 font-semibold text-bb-red-dark ring-1 ring-red-100">
                  {formatCurrency(totalB2)}
                </span>
              </td>
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
