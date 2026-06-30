'use client';

import { Fragment, useState } from 'react';
import type { TierInventoryRow, AccountServiceBreakdown } from '@/types/analysis';
import { isHotStorageTier } from '@/lib/engine/tier-selection';
import { getRegionLocation } from '@/lib/regions';
import { formatStorageTierName, getStorageTierHelp } from '@/lib/storage-tiers';
import { formatCurrency, formatNumber } from '../shared/FormatCurrency';

type StorageUnit = 'GB' | 'TB' | 'PB';
const UNIT_ORDER: StorageUnit[] = ['GB', 'TB', 'PB'];
// Decimal (SI) divisors, not binary GiB/TiB — cloud bills price storage on a 1000-based GB.
const UNIT_DIVISOR: Record<StorageUnit, number> = { GB: 1, TB: 1_000, PB: 1_000_000 };

function formatStorage(gb: number, unit: StorageUnit): string {
  const value = gb / UNIT_DIVISOR[unit];
  if (unit === 'GB') return formatNumber(Math.round(value));
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// Re-express a $/TB-month rate in the currently selected unit so the "Effective" column tracks the
// GB/TB/PB toggle (e.g. $6/TB shows as $0.006/GB).
function formatRatePerUnit(perTb: number, unit: StorageUnit): string {
  const perGb = perTb / 1_000;
  const value = perGb * UNIT_DIVISOR[unit];
  return `${formatCurrency(value)}/${unit}`;
}

function UnitToggle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-8 min-w-[88px] items-center justify-center gap-1 whitespace-nowrap rounded-md border border-c-border bg-c-surface px-2 text-xs font-semibold text-c-muted shadow-sm transition-all hover:border-c-border2 hover:bg-c-surface2 hover:text-c-text active:bg-c-surface2 cursor-pointer"
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
  /** Optional per-account spend rows, keyed by storage class, used to show account allocation within a tier. */
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

// Display order from hottest to coldest tier, so the inventory reads top-down by access temperature.
// Equivalent classes across providers (AWS / GCP / Azure) deliberately share a rank — e.g. AWS
// Standard, Azure Hot-*, and the S3 summary row all rank 0 — so cross-provider bills interleave sensibly.
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

// Unknown/unmapped tiers sort after every known one (rank 50) but before any explicit higher rank.
function tierRank(storageClass: string): number {
  return TIER_ORDER[storageClass] ?? 50;
}

// Coarse hot/warm/cool badge for the tier. "Warm" keys off the infrequent-access markers each provider
// uses (AWS *-IA, GCP Nearline, Azure Cool); anything colder than that falls through to "Cooler".
// Soft-pill colors map to the design tokens: Hot→red, Warm→amber, Cooler→purple.
function tierTemperature(storageClass: string): { label: string; className: string } {
  if (isHotStorageTier(storageClass)) {
    return { label: 'Hot', className: 'bg-c-red-soft text-c-red' };
  }
  if (storageClass.includes('IA') || storageClass.includes('Nearline') || storageClass.includes('Cool')) {
    return { label: 'Warm', className: 'bg-c-amber-soft text-c-amber' };
  }
  return { label: 'Cooler', className: 'bg-c-purple-soft text-c-purple' };
}

// Blended $/TB-month across all regions in a group: weight by GB so the group rate reflects where the
// data actually sits, rather than a flat average of per-region rates.
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
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-c-border bg-c-surface text-[11px] font-bold leading-none text-c-subtle transition-colors hover:border-c-red hover:bg-c-red-soft hover:text-c-red-dark focus:outline-none focus:ring-2 focus:ring-c-red/30"
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
      // `indeterminate` is a DOM-only property with no React prop, so it must be set imperatively
      // via the ref. Drives the dash state when only some regions in a group are selected.
      ref={(input) => {
        if (input) input.indeterminate = indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className="h-4 w-4 accent-[#e20626] rounded"
    />
  );
}

/**
 * Storage-tier inventory table: the AE's primary control for choosing which tiers migrate to B2.
 * Rows group per-region tiers by storage class (sorted hot→cold), with an expandable region-level and
 * per-account breakdown. Toggling a tier feeds the cost model; this component only presents and selects.
 */
export function TierInventory({ tiers, onToggle, accountBreakdowns }: TierInventoryProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [storageUnit, setStorageUnit] = useState<StorageUnit>('TB');

  // Totals span the whole bill, but savings nets out only what migrates: tiers left behind keep their
  // current cost (totalRemaining) and so contribute nothing to the savings figure in the footer.
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
      // Primary order is access temperature (hot→cold); within an equal rank, costliest tier first.
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

  // Apply a group-level checkbox to all its region rows, skipping rows already in the target state so
  // we don't fire redundant onToggle calls (each is a separate state update upstream).
  const toggleGroup = (group: TierGroup, migrateToB2: boolean) => {
    for (const row of group.rows) {
      if (row.migrateToB2 !== migrateToB2) {
        onToggle(row.id, migrateToB2);
      }
    }
  };

  return (
    <div className="rounded-2xl border border-c-border bg-c-surface shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-c-border">
        <h3 className="text-lg font-semibold text-c-text">Storage Tier Inventory</h3>
        <p className="text-sm text-c-muted mt-1">
          Hot tiers are selected by default. Expand a tier for region-level selection and account allocation.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {/* Column-header row sits on the muted surface2 fill per the design spec. */}
          <thead className="bg-c-surface2">
            <tr>
              <th className="px-2 py-4 text-left align-middle font-semibold text-c-subtle whitespace-nowrap">Migrate</th>
              <th className="px-2 py-4 text-left align-middle font-semibold text-c-subtle whitespace-nowrap">Storage Tier</th>
              <th className="px-2 py-4 text-left align-middle font-semibold text-c-subtle whitespace-nowrap">Coverage</th>
              <th className="px-2 py-4 text-center align-middle whitespace-nowrap">
                <UnitToggle label={`${storageUnit} Stored`} onClick={cycleUnit} />
              </th>
              <th className="px-2 py-4 text-center align-middle font-semibold text-c-subtle whitespace-nowrap">Monthly Cost</th>
              <th className="px-2 py-4 text-center align-middle whitespace-nowrap">
                <UnitToggle label="Effective" onClick={cycleUnit} />
              </th>
              <th className="px-2 py-4 text-center align-middle font-semibold text-c-subtle whitespace-nowrap">Fees</th>
              <th className="px-2 py-4 text-center align-middle font-semibold text-c-subtle whitespace-nowrap">True Cost</th>
              {/* "$/TB B2" column accent: brand-red label on a soft-red wash. */}
              <th className="px-2 py-4 text-center align-middle font-semibold text-c-red bg-c-red-soft whitespace-nowrap">B2 Cost</th>
              <th className="px-2 py-4 text-center align-middle font-semibold text-c-subtle whitespace-nowrap">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-c-border">
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
                    className={group.selectedCount > 0 ? 'bg-c-green-soft' : ''}
                  >
                    <td className="px-2 py-3">
                      <GroupCheckbox
                        checked={allSelected}
                        indeterminate={partiallySelected}
                        onChange={(checked) => toggleGroup(group, checked)}
                        ariaLabel={`Migrate all ${formatStorageTierName(group.storageClass)}`}
                      />
                    </td>
                    <td className="px-2 py-3 font-medium text-c-text">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleExpand(group.storageClass)}
                          className="text-c-subtle hover:text-c-text transition-transform"
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
                        {/* Temperature soft-pill — Hot/Warm/Cooler colors come from tierTemperature(). */}
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${temperature.className}`}>
                          {temperature.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-c-muted">
                      <div className="flex flex-col">
                        <span>{regionCount} {regionCount === 1 ? 'region' : 'regions'}</span>
                        <span className="text-xs text-c-subtle">
                          {group.selectedCount}/{group.rows.length} selected
                          {accountCount > 0 ? ` · ${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right text-c-text">{formatStorage(group.gbStored, storageUnit)}</td>
                    <td className="px-2 py-3 text-right text-c-text">{formatCurrency(group.monthlyStorageCost)}</td>
                    <td className="px-2 py-3 text-right text-c-muted">{formatRatePerUnit(weightedRatePerTb(group), storageUnit)}</td>
                    <td className="px-2 py-3 text-right text-c-muted">
                      {formatCurrency(group.fees)}
                    </td>
                    <td className="px-2 py-3 text-right font-medium text-c-text">{formatCurrency(group.totalTrueCost)}</td>
                    {/* B2-cost column: brand-red value chip on a soft-red column wash. */}
                    <td className="px-2 py-3 text-right bg-c-red-soft/40">
                      {group.selectedCount > 0 ? (
                        <span className="inline-flex justify-end rounded-md bg-c-surface px-2 py-1 font-semibold text-c-red-dark ring-1 ring-c-red-soft shadow-sm">
                          {formatCurrency(group.selectedB2Cost)}
                        </span>
                      ) : (
                        <span className="text-c-subtle">—</span>
                      )}
                    </td>
                    {/* Savings: positive deltas read green, negative red, zero muted. */}
                    <td className={`px-2 py-3 text-right font-medium ${group.selectedDelta > 0 ? 'text-c-green' : group.selectedDelta < 0 ? 'text-c-red' : 'text-c-subtle'}`}>
                      {group.selectedCount > 0 ? formatCurrency(group.selectedDelta) : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-c-surface2">
                      <td className="px-2 py-3" />
                      <td className="px-2 py-3" colSpan={9}>
                        <div className="rounded-md border border-c-border bg-c-surface overflow-hidden">
                          {/* Region sub-rows: header band on surface2, dividers on the border token. */}
                          <div className="grid grid-cols-[44px_1.15fr_1.2fr_repeat(7,minmax(82px,1fr))] items-center gap-0 bg-c-surface2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-c-subtle">
                            <span />
                            <span className="whitespace-nowrap">Region</span>
                            <span className="whitespace-nowrap">Location</span>
                            <span className="text-right whitespace-nowrap">{storageUnit}</span>
                            <span className="text-right whitespace-nowrap">Monthly</span>
                            <span className="text-right whitespace-nowrap">Effective</span>
                            <span className="text-right whitespace-nowrap">Fees</span>
                            <span className="text-right whitespace-nowrap">True</span>
                            <span className="text-right text-c-red whitespace-nowrap">B2</span>
                            <span className="text-right whitespace-nowrap">Savings</span>
                          </div>
                          {group.rows.map((tier) => {
                            const fees = tier.retrievalFees + tier.earlyDeletionFees + tier.monitoringFees + tier.operationsFees;
                            const location = getRegionLocation(tier.region);
                            return (
                              <div key={tier.id} className={`grid grid-cols-[44px_1.15fr_1.2fr_repeat(7,minmax(82px,1fr))] gap-0 px-3 py-2 text-xs border-t border-c-border ${tier.migrateToB2 ? 'bg-c-green-soft' : ''}`}>
                                <span>
                                  <input
                                    type="checkbox"
                                    checked={tier.migrateToB2}
                                    onChange={(e) => onToggle(tier.id, e.target.checked)}
                                    aria-label={`Migrate ${tier.storageClass} in ${tier.region}`}
                                    className="h-4 w-4 accent-[#e20626] rounded"
                                  />
                                </span>
                                <span className="font-medium text-c-text">{tier.region}</span>
                                <span className={location ? 'font-medium text-c-muted' : 'text-c-subtle'}>
                                  {location || '—'}
                                </span>
                                <span className="text-right text-c-muted">{formatStorage(tier.gbStored, storageUnit)}</span>
                                <span className="text-right text-c-muted">{formatCurrency(tier.monthlyStorageCost)}</span>
                                <span className="text-right text-c-subtle">{formatRatePerUnit(tier.effectivePerTb, storageUnit)}</span>
                                <span className="text-right text-c-subtle" title={`Retrieval: ${formatCurrency(tier.retrievalFees)}\nEarly Delete: ${formatCurrency(tier.earlyDeletionFees)}\nMonitoring: ${formatCurrency(tier.monitoringFees)}\nOperations: ${formatCurrency(tier.operationsFees)}`}>
                                  {formatCurrency(fees)}
                                </span>
                                <span className="text-right font-medium text-c-text">{formatCurrency(tier.totalTrueCost)}</span>
                                {/* Per-region B2 cost chip: brand-red value on the soft-red wash. */}
                                <span className="text-right">
                                  {tier.migrateToB2 ? (
                                    <span className="inline-flex rounded-md bg-c-red-soft px-2 py-0.5 font-semibold text-c-red-dark ring-1 ring-c-red-soft">
                                      {formatCurrency(tier.modeledB2Cost)}
                                    </span>
                                  ) : (
                                    <span className="text-c-subtle">—</span>
                                  )}
                                </span>
                                <span className={`text-right font-medium ${tier.delta > 0 ? 'text-c-green' : tier.delta < 0 ? 'text-c-red' : 'text-c-subtle'}`}>
                                  {tier.migrateToB2 ? formatCurrency(tier.delta) : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {group.accounts.length > 0 && (
                          <div className="mt-3 rounded-md border border-c-border bg-c-surface overflow-hidden">
                            <div className="bg-c-surface2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-c-subtle">
                              Account Allocation
                            </div>
                            {group.accounts.map((acct) => {
                              // Bills give per-account dollars but not per-account GB, so apportion the
                              // group's stored bytes by each account's share of spend. Approximate (and
                              // labeled "~") since it assumes a uniform per-GB rate across accounts.
                              const estimatedGb = group.monthlyStorageCost > 0
                                ? Math.round((acct.costUsd / group.monthlyStorageCost) * group.gbStored)
                                : 0;
                              return (
                                <div key={`${group.storageClass}-${acct.accountId}`} className="grid grid-cols-[1.5fr_1fr_120px_120px] gap-3 border-t border-c-border px-3 py-2 text-xs">
                                  <span className="font-medium text-c-text">{acct.accountName}</span>
                                  <span className="text-c-subtle">{acct.accountId}</span>
                                  <span className="text-right text-c-subtle" title="Estimated from Cost Proportion">
                                    {estimatedGb > 0 ? `~${formatStorage(estimatedGb, storageUnit)}` : '—'}
                                  </span>
                                  <span className="text-right text-c-muted">{formatCurrency(acct.costUsd)}</span>
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
          {/* Blended-total footer sits on the muted surface2 fill. */}
          <tfoot className="bg-c-surface2 font-medium">
            <tr>
              <td className="px-2 py-3 text-c-text" colSpan={7} />
              <td className="px-2 py-3 text-right text-c-text">{formatCurrency(totalCurrent)}</td>
              <td className="px-2 py-3 text-right bg-c-red-soft">
                <span className="inline-flex rounded-md bg-c-surface px-2 py-1 font-semibold text-c-red-dark ring-1 ring-c-red-soft">
                  {formatCurrency(totalB2)}
                </span>
              </td>
              <td className="px-2 py-3 text-right text-c-green">
                {/* Savings = current spend on migrated tiers minus their B2 cost. Subtracting
                    totalRemaining strips out tiers left behind, which keep their current cost. */}
                {formatCurrency(totalCurrent - totalB2 - totalRemaining)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
