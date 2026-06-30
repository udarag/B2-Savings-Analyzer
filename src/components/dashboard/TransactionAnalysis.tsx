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

/** A leaf transaction type within a class — one or more bill lines collapsed by subcategory/storage class/signal. */
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

/** A top-level B2 transaction class with its source-bill total and the leaf types rolled up under it. */
interface TransactionClassGroup {
  id: B2TransactionClassId;
  label: string;
  description: string;
  b2Mapping: string;
  b2CostLabel: string;
  /** How savings are counted: 'free' rows are eliminated on B2; 'usage-based'/'review' need AE judgment, not auto-credit. */
  savingsMode: 'free' | 'usage-based' | 'review';
  cost: number;
  count: number;
  usageQuantity: number;
  children: TransactionTypeGroup[];
}

// Render/rollup order for the classes. Fixed rather than data-driven so the table reads writes → reads →
// listing → combined → usage-based → other regardless of what the bill happens to contain.
const CLASS_ORDER: B2TransactionClassId[] = ['class-a', 'class-b', 'class-c', 'class-a-c', 'class-d', 'other'];
const CALLOUT_GRID_CLASS = 'grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_240px_260px] md:items-center';

// Static copy for each B2 transaction class: how source charges map onto B2 and whether that mapping is
// free. B2 standard transactions (Class A writes, B reads, C listing) are free, which is the whole point
// of this view; only Class D and unmappable "other" charges carry over. `class-a-c` is the special case
// where a hyperscaler bills PUT and LIST together in one line that spans free A and C classes on B2.
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

// Roll the bill's operations line items up into B2 transaction classes and the leaf types beneath them.
// Classes are pre-seeded in CLASS_ORDER so ordering is stable, then empty ones are dropped at the end.
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
    // Review-only subcategories are forced into 'other' so they never get auto-credited as B2 savings,
    // even if they would otherwise classify as a free A/B/C transaction.
    const classId = isReviewOnlyOperation(item.subcategory) ? 'other' : classifyTransactionClass(item);
    const subcategory = item.subcategory || 'Other';
    // PUT/GET signals only mean something for the free standard classes; suppress them for class-d and
    // 'other' so the callouts don't imply those charges vanish on B2.
    const putRelated = classId !== 'other' && classId !== 'class-d' && isPutRelatedTransaction(item);
    const getRelated = classId !== 'other' && classId !== 'class-d' && isGetRelatedTransaction(item);
    const coldTierAccess = isColdTierAccessItem(item);
    // Composite key that defines a leaf row: lines sharing class, subcategory, storage class, and all
    // three signal flags collapse into one TransactionTypeGroup so the detail table stays readable.
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

  // Emit only classes that actually accrued cost, preserving CLASS_ORDER; leaf rows sort costliest-first.
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

/**
 * Maps the customer's current API/operation charges onto B2 transaction classes to show how much of that
 * spend B2 eliminates (standard A/B/C transactions are free). Renders nothing when the bill has no
 * operations charges. Charges that don't map cleanly are surfaced as "Review", never auto-credited.
 */
export function TransactionAnalysis({ lineItems }: TransactionAnalysisProps) {
  const groups = buildTransactionGroups(lineItems);
  const [expanded, setExpanded] = useState<Set<B2TransactionClassId>>(new Set());

  if (groups.length === 0) return null;

  const actionCosts = getOperationActionCostSummary(lineItems);
  const { putRelated, getRelated, coldTierAccess } = actionCosts;

  // Split the headline number from the caveat: only 'free' classes count as eliminated savings;
  // usage-based and review classes are tallied separately and flagged for the AE rather than promised.
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
    <div className="overflow-hidden rounded-2xl border border-c-border bg-c-surface shadow-sm">
      <div className="border-b border-c-border bg-c-surface2 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-c-text">Transaction Cost Analysis</h3>
            <p className="mt-1 text-sm text-c-muted">
              Current API operation charges mapped to Backblaze B2 transaction classes.
            </p>
          </div>
          {/* Green "free transactions" badge — the headline promise of this view. */}
          <div className="flex items-center gap-2 rounded-lg border border-c-border bg-c-green-soft px-3 py-1.5 shadow-sm">
            <svg className="h-4 w-4 text-c-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-c-green">B2 Standard Transactions Are Free</span>
          </div>
        </div>
      </div>

      {/* "Action fees B2 removes" callouts — soft-red cards per the design spec. The current $ is shown in
          font-display/text-c-text and paired with a green "$0 on B2" line. */}
      {putRelated.currentCost > 0 && (
        <div className={`${CALLOUT_GRID_CLASS} border-b border-c-border bg-c-red-soft px-6 py-4 text-sm`}>
          <div className="min-w-0">
            <p className="font-semibold text-c-text">PUT-related source charges identified</p>
            <p className="mt-1 text-c-muted">
              Hyperscalers often bill PUT/write-class requests separately; these rows map to free B2 standard transaction classes.
            </p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">Current Cost</p>
            <p className="font-display text-lg font-semibold text-c-text">{formatCurrency(putRelated.currentCost)}/mo</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">B2 Cost</p>
            <p className="text-lg font-semibold text-c-green">$0.00</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">Signal</p>
            <p className="text-xs font-medium text-c-muted">
              {putRelated.lineCount} line{putRelated.lineCount === 1 ? '' : 's'}
              {putRelated.usageQuantity > 0 && (
                <> - {formatNumber(putRelated.usageQuantity, 0)}{putRelated.usageUnit ? ` ${putRelated.usageUnit}` : ''}</>
              )}
            </p>
          </div>
        </div>
      )}

      {getRelated.currentCost > 0 && (
        <div className={`${CALLOUT_GRID_CLASS} border-b border-c-border bg-c-red-soft px-6 py-4 text-sm`}>
          <div className="min-w-0">
            <p className="font-semibold text-c-text">GET-related source charges identified</p>
            <p className="mt-1 text-c-muted">
              Hyperscalers often bill GET/read-class requests separately; these rows map to free B2 standard transaction classes.
            </p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">Current Cost</p>
            <p className="font-display text-lg font-semibold text-c-text">{formatCurrency(getRelated.currentCost)}/mo</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">B2 Cost</p>
            <p className="text-lg font-semibold text-c-green">$0.00</p>
          </div>
          <div className="min-w-0 md:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">Signal</p>
            <p className="text-xs font-medium text-c-muted">
              {getRelated.lineCount} line{getRelated.lineCount === 1 ? '' : 's'}
              {getRelated.usageQuantity > 0 && (
                <> - {formatNumber(getRelated.usageQuantity, 0)}{getRelated.usageUnit ? ` ${getRelated.usageUnit}` : ''}</>
              )}
            </p>
          </div>
        </div>
      )}

      {coldTierAccess.totalCost > 0 && (
        <div className="border-b border-c-border bg-c-red-soft px-6 py-4 text-sm">
          <div className={CALLOUT_GRID_CLASS}>
            <div className="min-w-0">
              <p className="font-semibold text-c-text">Cold-tier access charges identified</p>
              <p className="mt-1 text-c-muted">
                AWS S3 and GCS cold tiers can add retrieval, restore, tiering, early deletion, and cold-tier operation charges on top of storage.
              </p>
            </div>
            <div className="min-w-0 md:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">Current Cost</p>
              <p className="font-display text-lg font-semibold text-c-text">{formatCurrency(coldTierAccess.totalCost)}/mo</p>
            </div>
            <div className="min-w-0 md:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">B2 Exposure</p>
              <p className="text-sm font-semibold text-c-green">No retrieval or restore fees</p>
            </div>
            <div className="min-w-0 md:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-c-subtle">Signal</p>
              <p className="text-xs font-medium text-c-muted">
                {coldTierAccess.lineCount} line{coldTierAccess.lineCount === 1 ? '' : 's'}
                {coldTierAccess.usageQuantity > 0 && (
                  <> - {formatNumber(coldTierAccess.usageQuantity, 0)}{coldTierAccess.usageUnit ? ` ${coldTierAccess.usageUnit}` : ''}</>
                )}
              </p>
            </div>
          </div>
          {/* Per-group cold-tier breakdown chips — raised surface cards on the soft-red panel. */}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {coldTierAccess.groups.slice(0, 4).map((group) => (
              <div key={group.id} className="flex items-center justify-between gap-3 rounded-md border border-c-border bg-c-surface px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-c-text">{group.label}</p>
                  <p className="text-xs text-c-muted">{group.storageClass || 'Unattributed'} - {group.count} line{group.count === 1 ? '' : 's'}</p>
                </div>
                <p className="shrink-0 font-display text-sm font-semibold text-c-text">{formatCurrency(group.cost)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-c-surface">
        <table className="w-full text-sm">
          <thead className="bg-c-surface2">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-c-muted">Transaction Class</th>
              <th className="px-6 py-3 text-left font-medium text-c-muted">Mapping</th>
              <th className="px-6 py-3 text-right font-medium text-c-muted">Current Cost</th>
              <th className="px-6 py-3 text-right font-medium text-c-muted">B2 Cost</th>
              <th className="px-6 py-3 text-right font-medium text-c-muted">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-c-border">
            {groups.map((group) => {
              const isExpanded = expanded.has(group.id);
              return (
                <Fragment key={group.id}>
                  <tr className="bg-c-surface hover:bg-c-surface2">
                    <td className="px-6 py-4 align-top">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="inline-flex items-start gap-2 text-left"
                        aria-expanded={isExpanded}
                      >
                        <svg
                          className={`mt-0.5 h-4 w-4 shrink-0 text-c-subtle transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                        </svg>
                        <span>
                          <span className="block font-semibold text-c-text">{group.label}</span>
                          <span className="block text-xs text-c-muted">{group.description}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-6 py-4 align-top text-c-muted">{group.b2Mapping}</td>
                    <td className="px-6 py-4 align-top text-right font-medium text-c-text">{formatCurrency(group.cost)}</td>
                    <td className="px-6 py-4 align-top text-right font-medium text-c-green">{group.b2CostLabel}</td>
                    <td className="px-6 py-4 align-top text-right">
                      {group.savingsMode === 'free' ? (
                        <span className="font-semibold text-c-green">{formatCurrency(group.cost)}</span>
                      ) : (
                        <span className="font-medium text-c-amber">Review</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-c-surface2">
                      <td colSpan={5} className="px-6 py-0">
                        <div className="py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-c-subtle">
                                <th className="py-2 pl-6 text-left font-medium">Transaction Type</th>
                                <th className="py-2 text-left font-medium">Signal</th>
                                <th className="py-2 text-left font-medium">Storage Class</th>
                                <th className="py-2 text-right font-medium">Bill Lines</th>
                                <th className="py-2 text-right font-medium">Usage</th>
                                <th className="py-2 pr-2 text-right font-medium">Current Cost</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-c-border">
                              {group.children.map((child) => (
                                <tr key={child.id}>
                                  <td className="py-2 pl-6 font-medium text-c-text">{child.label}</td>
                                  <td className="py-2 text-c-muted">
                                    {(child.putRelated || child.getRelated || child.coldTierAccess) ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {child.putRelated && (
                                          <span className="inline-flex rounded-md border border-c-border bg-c-red-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-c-red">
                                            PUT / write
                                          </span>
                                        )}
                                        {child.getRelated && (
                                          <span className="inline-flex rounded-md border border-c-border bg-c-purple-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-c-purple">
                                            GET / read
                                          </span>
                                        )}
                                        {child.coldTierAccess && (
                                          <span className="inline-flex rounded-md border border-c-border bg-c-amber-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-c-amber">
                                            Cold tier
                                          </span>
                                        )}
                                      </div>
                                    ) : '-'}
                                  </td>
                                  <td className="py-2 text-c-muted">{child.storageClass || '-'}</td>
                                  <td className="py-2 text-right text-c-muted">{child.count}</td>
                                  <td className="py-2 text-right text-c-muted">{formatUsage(child)}</td>
                                  <td className="py-2 pr-2 text-right font-medium text-c-text">{formatCurrency(child.cost)}</td>
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
          <tfoot className="bg-c-surface2">
            <tr className="font-semibold">
              <td className="px-6 py-3 text-c-text" colSpan={2}>Mapped B2 Transaction Savings</td>
              <td className="px-6 py-3 text-right text-c-text">{formatCurrency(mappedSavings)}</td>
              <td className="px-6 py-3 text-right text-c-green">$0.00</td>
              <td className="px-6 py-3 text-right text-c-green">{formatCurrency(mappedSavings)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Summary callout — green "transactions are free" close, with any unmapped charges flagged amber for AE review. */}
      <div className="border-t border-c-border bg-c-green-soft px-6 py-3 text-sm text-c-green">
        B2 Class A, B, and C standard transactions are free, eliminating{' '}
        <span className="font-semibold">{formatCurrency(mappedSavings)}/mo</span> in mapped transaction charges.
        {reviewTotal > 0 && (
          <span className="text-c-amber">
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
