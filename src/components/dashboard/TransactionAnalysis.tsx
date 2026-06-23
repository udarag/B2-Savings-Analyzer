'use client';

import { Fragment, useState } from 'react';
import type { ParsedLineItem } from '@/types/analysis';
import { isColdTierAccessItem } from '@/lib/analysis/access-costs';
import {
  classifyTransactionClass,
  getOperationActionCostSummary,
  isGetRelatedTransaction,
  isPutRelatedTransaction,
  isReviewOnlyOperation,
  type B2TransactionClassId,
} from '@/lib/analysis/action-costs';
import { formatCurrency, formatNumber } from '../shared/FormatCurrency';

interface TransactionAnalysisProps {
  lineItems: ParsedLineItem[];
}

interface TransactionTypeGroup {
  id: string;
  label: string;
  subcategory: string;
  storageClass?: string;
  putRelated: boolean;
  getRelated: boolean;
  coldTierAccess: boolean;
  cost: number;
  count: number;
  usageQuantity: number;
  usageUnit?: string;
}

interface TransactionClassGroup {
  id: B2TransactionClassId;
  label: string;
  description: string;
  b2Mapping: string;
  b2CostLabel: string;
  savingsMode: 'free' | 'usage-based' | 'review';
  cost: number;
  count: number;
  usageQuantity: number;
  children: TransactionTypeGroup[];
}

const CLASS_ORDER: B2TransactionClassId[] = ['class-a', 'class-b', 'class-c', 'class-a-c', 'class-d', 'other'];
const CALLOUT_GRID_CLASS = 'grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_240px_260px] md:items-center';

const CLASS_DEFINITIONS: Record<B2TransactionClassId, Omit<TransactionClassGroup, 'cost' | 'count' | 'usageQuantity' | 'children'>> = {
  'class-a': {
    id: 'class-a',
    label: 'Class A / Writes',
    description: 'PUT, upload, write, delete, and source-billed Class A transaction lines.',
    b2Mapping: 'Free standard transaction class',
    b2CostLabel: '$0.00',
    savingsMode: 'free',
  },
  'class-b': {
    id: 'class-b',
    label: 'Class B / Reads',
    description: 'GET, download, read, and file information calls.',
    b2Mapping: 'Free standard transaction class',
    b2CostLabel: '$0.00',
    savingsMode: 'free',
  },
  'class-c': {
    id: 'class-c',
    label: 'Class C',
    description: 'Listing operations and bucket or application key management.',
    b2Mapping: 'Free standard transaction class',
    b2CostLabel: '$0.00',
    savingsMode: 'free',
  },
  'class-a-c': {
    id: 'class-a-c',
    label: 'PUT / Write Requests',
    description: 'Source bill groups PUT, COPY, POST, and LIST request charges together.',
    b2Mapping: 'Maps across free Class A and Class C standard transactions',
    b2CostLabel: '$0.00',
    savingsMode: 'free',
  },
  'class-d': {
    id: 'class-d',
    label: 'Class D',
    description: 'Event notification style operations.',
    b2Mapping: 'Usage-based B2 transaction class',
    b2CostLabel: 'Usage-based',
    savingsMode: 'usage-based',
  },
  other: {
    id: 'other',
    label: 'Other',
    description: 'Provider-specific operations, add-ons, or features that do not map cleanly to B2 transactions.',
    b2Mapping: 'Review separately',
    b2CostLabel: 'Review',
    savingsMode: 'review',
  },
};

function groupLabel(subcategory: string): string {
  switch (subcategory) {
    case 'PUT/COPY/POST/LIST': return 'PUT, COPY, POST, and LIST Requests';
    case 'GET/SELECT': return 'GET and Read Requests';
    case 'Monitoring/Analytics': return 'Monitoring and Analytics';
    case 'S3 Inventory': return 'S3 Inventory';
    case 'Lifecycle Transitions': return 'Lifecycle Transitions';
    case 'Lifecycle/Copy': return 'Lifecycle, Restore, and Copy Operations';
    case 'Tag Storage': return 'Tag Storage';
    case 'Metadata': return 'Metadata';
    case 'S3 Select': return 'S3 Select';
    case 'Class A': return 'Class A / PUT-Style Operations';
    case 'Class B': return 'Class B / GET-Style Operations';
    case 'Standard-IA Requests': return 'Standard-IA Requests';
    case 'One Zone-IA Requests': return 'One Zone-IA Requests';
    case 'Glacier Deep Archive Requests': return 'Glacier Deep Archive Requests';
    case 'Glacier IR Requests': return 'Glacier Instant Retrieval Requests';
    default: return subcategory || 'Other Operations';
  }
}

function buildTransactionGroups(lineItems: ParsedLineItem[]): TransactionClassGroup[] {
  const classMap = new Map<B2TransactionClassId, TransactionClassGroup>();

  for (const id of CLASS_ORDER) {
    classMap.set(id, {
      ...CLASS_DEFINITIONS[id],
      cost: 0,
      count: 0,
      usageQuantity: 0,
      children: [],
    });
  }

  const childMap = new Map<string, TransactionTypeGroup>();
  const opsItems = lineItems.filter((item) => item.category === 'operations');

  for (const item of opsItems) {
    const classId = isReviewOnlyOperation(item.subcategory) ? 'other' : classifyTransactionClass(item);
    const subcategory = item.subcategory || 'Other';
    const putRelated = classId !== 'other' && classId !== 'class-d' && isPutRelatedTransaction(item);
    const getRelated = classId !== 'other' && classId !== 'class-d' && isGetRelatedTransaction(item);
    const coldTierAccess = isColdTierAccessItem(item);
    const childKey = `${classId}|${subcategory}|${item.storageClass || ''}|${putRelated ? 'put-related' : 'standard'}|${getRelated ? 'get-related' : 'standard'}|${coldTierAccess ? 'cold-access' : 'standard'}`;
    const usageQuantity = item.usageQuantity || 0;
    const parent = classMap.get(classId);
    if (!parent) continue;

    parent.cost += item.costUsd;
    parent.count++;
    parent.usageQuantity += usageQuantity;

    const existing = childMap.get(childKey);
    if (existing) {
      existing.cost += item.costUsd;
      existing.count++;
      existing.usageQuantity += usageQuantity;
    } else {
      const child: TransactionTypeGroup = {
        id: childKey,
        label: groupLabel(subcategory),
        subcategory,
        storageClass: item.storageClass,
        putRelated,
        getRelated,
        coldTierAccess,
        cost: item.costUsd,
        count: 1,
        usageQuantity,
        usageUnit: item.usageUnit,
      };
      childMap.set(childKey, child);
      parent.children.push(child);
    }
  }

  return CLASS_ORDER
    .map((id) => classMap.get(id))
    .filter((group): group is TransactionClassGroup => group !== undefined && group.cost > 0)
    .map((group) => ({
      ...group,
      cost: round2(group.cost),
      usageQuantity: round2(group.usageQuantity),
      children: group.children
        .map((child) => ({
          ...child,
          cost: round2(child.cost),
          usageQuantity: round2(child.usageQuantity),
        }))
        .sort((a, b) => b.cost - a.cost),
    }));
}

export function TransactionAnalysis({ lineItems }: TransactionAnalysisProps) {
  const groups = buildTransactionGroups(lineItems);
  const [expanded, setExpanded] = useState<Set<B2TransactionClassId>>(new Set());

  if (groups.length === 0) return null;

  const actionCosts = getOperationActionCostSummary(lineItems);
  const { putRelated, getRelated, coldTierAccess } = actionCosts;

  const mappedSavings = groups
    .filter((group) => group.savingsMode === 'free')
    .reduce((sum, group) => sum + group.cost, 0);
  const reviewTotal = groups
    .filter((group) => group.savingsMode !== 'free')
    .reduce((sum, group) => sum + group.cost, 0);

  const toggleGroup = (id: B2TransactionClassId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ring-1 ring-black/[0.02] dark:border-gray-800 dark:bg-[#11141a] dark:ring-white/[0.04]">
      <div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4 dark:border-gray-800 dark:bg-[#171b22]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Transaction Cost Analysis</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Current API operation charges mapped to Backblaze B2 transaction classes.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 shadow-sm dark:border-green-400/30 dark:bg-green-950/30">
            <svg className="h-4 w-4 text-green-600 dark:text-green-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-green-800 dark:text-green-200">B2 Standard Transactions Are Free</span>
          </div>
        </div>
      </div>

      {putRelated.currentCost > 0 && (
        <div className={`${CALLOUT_GRID_CLASS} border-b border-red-100 bg-red-50/70 px-6 py-4 text-sm dark:border-red-400/20 dark:bg-red-950/20`}>
          <div className="min-w-0">
            <p className="font-semibold text-red-900 dark:text-red-100">PUT-related source charges identified</p>
            <p className="mt-1 text-red-800/80 dark:text-red-200/80">
              Hyperscalers often bill PUT/write-class requests separately; these rows map to free B2 standard transaction classes.
            </p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-red-700/70 dark:text-red-200/70">Current Cost</p>
            <p className="text-lg font-semibold text-red-950 dark:text-red-50">{formatCurrency(putRelated.currentCost)}/mo</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-green-700/70 dark:text-green-200/70">B2 Cost</p>
            <p className="text-lg font-semibold text-green-700 dark:text-green-300">$0.00</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Signal</p>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {putRelated.lineCount} line{putRelated.lineCount === 1 ? '' : 's'}
              {putRelated.usageQuantity > 0 && (
                <> - {formatNumber(putRelated.usageQuantity, 0)}{putRelated.usageUnit ? ` ${putRelated.usageUnit}` : ''}</>
              )}
            </p>
          </div>
        </div>
      )}

      {getRelated.currentCost > 0 && (
        <div className={`${CALLOUT_GRID_CLASS} border-b border-sky-100 bg-sky-50/80 px-6 py-4 text-sm dark:border-sky-400/20 dark:bg-sky-950/20`}>
          <div className="min-w-0">
            <p className="font-semibold text-sky-950 dark:text-sky-100">GET-related source charges identified</p>
            <p className="mt-1 text-sky-800/80 dark:text-sky-200/80">
              Hyperscalers often bill GET/read-class requests separately; these rows map to free B2 standard transaction classes.
            </p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-sky-700/70 dark:text-sky-200/70">Current Cost</p>
            <p className="text-lg font-semibold text-sky-950 dark:text-sky-50">{formatCurrency(getRelated.currentCost)}/mo</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-green-700/70 dark:text-green-200/70">B2 Cost</p>
            <p className="text-lg font-semibold text-green-700 dark:text-green-300">$0.00</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Signal</p>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {getRelated.lineCount} line{getRelated.lineCount === 1 ? '' : 's'}
              {getRelated.usageQuantity > 0 && (
                <> - {formatNumber(getRelated.usageQuantity, 0)}{getRelated.usageUnit ? ` ${getRelated.usageUnit}` : ''}</>
              )}
            </p>
          </div>
        </div>
      )}

      {coldTierAccess.totalCost > 0 && (
        <div className="border-b border-orange-100 bg-orange-50/80 px-6 py-4 text-sm dark:border-orange-400/20 dark:bg-orange-950/20">
          <div className={CALLOUT_GRID_CLASS}>
            <div className="min-w-0">
              <p className="font-semibold text-orange-950 dark:text-orange-100">Cold-tier access charges identified</p>
              <p className="mt-1 text-orange-800/85 dark:text-orange-200/80">
                AWS S3 and GCS cold tiers can add retrieval, restore, tiering, early deletion, and cold-tier operation charges on top of storage.
              </p>
            </div>
            <div className="min-w-0 md:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-orange-700/70 dark:text-orange-200/70">Current Cost</p>
              <p className="text-lg font-semibold text-orange-950 dark:text-orange-50">{formatCurrency(coldTierAccess.totalCost)}/mo</p>
            </div>
            <div className="min-w-0 md:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-green-700/70 dark:text-green-200/70">B2 Exposure</p>
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">No retrieval or restore fees</p>
            </div>
            <div className="min-w-0 md:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Signal</p>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                {coldTierAccess.lineCount} line{coldTierAccess.lineCount === 1 ? '' : 's'}
                {coldTierAccess.usageQuantity > 0 && (
                  <> - {formatNumber(coldTierAccess.usageQuantity, 0)}{coldTierAccess.usageUnit ? ` ${coldTierAccess.usageUnit}` : ''}</>
                )}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {coldTierAccess.groups.slice(0, 4).map((group) => (
              <div key={group.id} className="flex items-center justify-between gap-3 rounded-md border border-orange-200/70 bg-white/70 px-3 py-2 dark:border-orange-400/20 dark:bg-orange-950/20">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-orange-950 dark:text-orange-100">{group.label}</p>
                  <p className="text-xs text-orange-800/75 dark:text-orange-200/70">{group.storageClass || 'Unattributed'} - {group.count} line{group.count === 1 ? '' : 's'}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-orange-950 dark:text-orange-50">{formatCurrency(group.cost)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-white dark:bg-[#11141a]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-[#0f131a]">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Transaction Class</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Mapping</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Current Cost</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">B2 Cost</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {groups.map((group) => {
              const isExpanded = expanded.has(group.id);
              return (
                <Fragment key={group.id}>
                  <tr className="bg-white hover:bg-gray-50/60 dark:bg-[#11141a] dark:hover:bg-[#171b22]">
                    <td className="px-6 py-4 align-top">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="inline-flex items-start gap-2 text-left"
                        aria-expanded={isExpanded}
                      >
                        <svg
                          className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-500 ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                        </svg>
                        <span>
                          <span className="block font-semibold text-gray-900 dark:text-gray-100">{group.label}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{group.description}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-6 py-4 align-top text-gray-600 dark:text-gray-300">{group.b2Mapping}</td>
                    <td className="px-6 py-4 align-top text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(group.cost)}</td>
                    <td className="px-6 py-4 align-top text-right font-medium text-green-700 dark:text-green-300">{group.b2CostLabel}</td>
                    <td className="px-6 py-4 align-top text-right">
                      {group.savingsMode === 'free' ? (
                        <span className="font-semibold text-green-700 dark:text-green-300">{formatCurrency(group.cost)}</span>
                      ) : (
                        <span className="font-medium text-amber-700 dark:text-amber-300">Review</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50 dark:bg-[#0f131a]">
                      <td colSpan={5} className="px-6 py-0">
                        <div className="py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400 dark:text-gray-500">
                                <th className="py-2 pl-6 text-left font-medium">Transaction Type</th>
                                <th className="py-2 text-left font-medium">Signal</th>
                                <th className="py-2 text-left font-medium">Storage Class</th>
                                <th className="py-2 text-right font-medium">Bill Lines</th>
                                <th className="py-2 text-right font-medium">Usage</th>
                                <th className="py-2 pr-2 text-right font-medium">Current Cost</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                              {group.children.map((child) => (
                                <tr key={child.id}>
                                  <td className="py-2 pl-6 font-medium text-gray-700 dark:text-gray-200">{child.label}</td>
                                  <td className="py-2 text-gray-500 dark:text-gray-400">
                                    {(child.putRelated || child.getRelated || child.coldTierAccess) ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {child.putRelated && (
                                          <span className="inline-flex rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200">
                                            PUT / write
                                          </span>
                                        )}
                                        {child.getRelated && (
                                          <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:border-sky-400/30 dark:bg-sky-950/40 dark:text-sky-200">
                                            GET / read
                                          </span>
                                        )}
                                        {child.coldTierAccess && (
                                          <span className="inline-flex rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-400/30 dark:bg-orange-950/40 dark:text-orange-200">
                                            Cold tier
                                          </span>
                                        )}
                                      </div>
                                    ) : '-'}
                                  </td>
                                  <td className="py-2 text-gray-500 dark:text-gray-400">{child.storageClass || '-'}</td>
                                  <td className="py-2 text-right text-gray-500 dark:text-gray-400">{child.count}</td>
                                  <td className="py-2 text-right text-gray-500 dark:text-gray-400">{formatUsage(child)}</td>
                                  <td className="py-2 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(child.cost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-[#0f131a]">
            <tr className="font-semibold">
              <td className="px-6 py-3 text-gray-900 dark:text-gray-100" colSpan={2}>Mapped B2 Transaction Savings</td>
              <td className="px-6 py-3 text-right text-gray-900 dark:text-gray-100">{formatCurrency(mappedSavings)}</td>
              <td className="px-6 py-3 text-right text-green-700 dark:text-green-300">$0.00</td>
              <td className="px-6 py-3 text-right text-green-700 dark:text-green-300">{formatCurrency(mappedSavings)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border-t border-green-100 bg-green-50 px-6 py-3 text-sm text-green-800 dark:border-green-400/20 dark:bg-green-950/25 dark:text-green-200">
        B2 Class A, B, and C standard transactions are free, eliminating{' '}
        <span className="font-semibold">{formatCurrency(mappedSavings)}/mo</span> in mapped transaction charges.
        {reviewTotal > 0 && (
          <span className="text-amber-800 dark:text-amber-300">
            {' '}{formatCurrency(reviewTotal)}/mo is grouped under Other for AE review because it does not map cleanly to a standard B2 transaction class.
          </span>
        )}
      </div>
    </div>
  );
}

function formatUsage(group: TransactionTypeGroup): string {
  if (!group.usageQuantity) return '-';
  const unit = group.usageUnit ? ` ${group.usageUnit}` : '';
  return `${formatNumber(group.usageQuantity, 0)}${unit}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
