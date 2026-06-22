'use client';

import { Fragment, useState } from 'react';
import type { ParsedLineItem } from '@/types/analysis';
import { formatCurrency, formatNumber } from '../shared/FormatCurrency';

interface TransactionAnalysisProps {
  lineItems: ParsedLineItem[];
}

type B2TransactionClassId = 'class-a' | 'class-b' | 'class-c' | 'class-a-c' | 'class-d' | 'other';

interface TransactionTypeGroup {
  id: string;
  label: string;
  subcategory: string;
  storageClass?: string;
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

const CLASS_DEFINITIONS: Record<B2TransactionClassId, Omit<TransactionClassGroup, 'cost' | 'count' | 'usageQuantity' | 'children'>> = {
  'class-a': {
    id: 'class-a',
    label: 'Class A',
    description: 'Explicit Class A transaction lines from the source bill.',
    b2Mapping: 'Free standard transaction class',
    b2CostLabel: '$0.00',
    savingsMode: 'free',
  },
  'class-b': {
    id: 'class-b',
    label: 'Class B',
    description: 'Downloads, reads, and file information calls.',
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
    label: 'Writes + Lists',
    description: 'Source bill groups write, copy, post, and list requests together.',
    b2Mapping: 'Maps across free Class A and Class C transactions',
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
    case 'Class A': return 'Class A Operations';
    case 'Class B': return 'Class B Operations';
    case 'Standard-IA Requests': return 'Standard-IA Requests';
    case 'One Zone-IA Requests': return 'One Zone-IA Requests';
    case 'Glacier Deep Archive Requests': return 'Glacier Deep Archive Requests';
    case 'Glacier IR Requests': return 'Glacier Instant Retrieval Requests';
    default: return subcategory || 'Other Operations';
  }
}

function classifyTransaction(item: ParsedLineItem): B2TransactionClassId {
  const subcategory = (item.subcategory || '').toLowerCase();
  const description = `${item.description} ${item.sku}`.toLowerCase();
  const text = `${subcategory} ${description}`;

  if (text.includes('event notification')) return 'class-d';
  if (subcategory === 'class a') return 'class-a';
  if (subcategory === 'class b') return 'class-b';
  if (subcategory === 'put/copy/post/list') return 'class-a-c';
  if (subcategory === 'get/select') return 'class-b';

  if (text.includes('put') || text.includes('post') || text.includes('upload') || text.includes('write') || text.includes('delete')) {
    return 'class-a';
  }

  if (text.includes('get') || text.includes('download') || text.includes('read')) {
    return 'class-b';
  }

  if (text.includes('list') || text.includes('copyobject') || text.includes('copy object') || text.includes('bucket')) {
    return 'class-c';
  }

  return 'other';
}

function isReviewOnly(subcategory?: string): boolean {
  const key = (subcategory || '').toLowerCase();
  return [
    'monitoring/analytics',
    's3 inventory',
    'lifecycle transitions',
    'lifecycle/copy',
    'tag storage',
    'metadata',
    's3 select',
    'other requests',
    'other s3',
  ].includes(key);
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
    const classId = isReviewOnly(item.subcategory) ? 'other' : classifyTransaction(item);
    const subcategory = item.subcategory || 'Other';
    const childKey = `${classId}|${subcategory}|${item.storageClass || ''}`;
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
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Transaction Cost Analysis</h3>
            <p className="text-sm text-gray-500 mt-1">
              Current API operation charges mapped to Backblaze B2 transaction classes.
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
            <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-green-800">B2 Standard Transactions Are Free</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Transaction Class</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Mapping</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Current Cost</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">B2 Cost</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((group) => {
              const isExpanded = expanded.has(group.id);
              return (
                <Fragment key={group.id}>
                  <tr className="bg-white">
                    <td className="px-6 py-4 align-top">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="inline-flex items-start gap-2 text-left"
                        aria-expanded={isExpanded}
                      >
                        <svg
                          className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                        </svg>
                        <span>
                          <span className="block font-semibold text-gray-900">{group.label}</span>
                          <span className="block text-xs text-gray-500">{group.description}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-6 py-4 align-top text-gray-600">{group.b2Mapping}</td>
                    <td className="px-6 py-4 align-top text-right font-medium text-gray-900">{formatCurrency(group.cost)}</td>
                    <td className="px-6 py-4 align-top text-right text-green-700 font-medium">{group.b2CostLabel}</td>
                    <td className="px-6 py-4 align-top text-right">
                      {group.savingsMode === 'free' ? (
                        <span className="font-semibold text-green-700">{formatCurrency(group.cost)}</span>
                      ) : (
                        <span className="font-medium text-amber-700">Review</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50">
                      <td colSpan={5} className="px-6 py-0">
                        <div className="py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="py-2 pl-6 text-left font-medium">Transaction Type</th>
                                <th className="py-2 text-left font-medium">Storage Class</th>
                                <th className="py-2 text-right font-medium">Bill Lines</th>
                                <th className="py-2 text-right font-medium">Usage</th>
                                <th className="py-2 pr-2 text-right font-medium">Current Cost</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {group.children.map((child) => (
                                <tr key={child.id}>
                                  <td className="py-2 pl-6 font-medium text-gray-700">{child.label}</td>
                                  <td className="py-2 text-gray-500">{child.storageClass || '-'}</td>
                                  <td className="py-2 text-right text-gray-500">{child.count}</td>
                                  <td className="py-2 text-right text-gray-500">{formatUsage(child)}</td>
                                  <td className="py-2 pr-2 text-right font-medium text-gray-900">{formatCurrency(child.cost)}</td>
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
          <tfoot className="bg-gray-50">
            <tr className="font-semibold">
              <td className="px-6 py-3 text-gray-900" colSpan={2}>Mapped B2 Transaction Savings</td>
              <td className="px-6 py-3 text-right text-gray-900">{formatCurrency(mappedSavings)}</td>
              <td className="px-6 py-3 text-right text-green-700">$0.00</td>
              <td className="px-6 py-3 text-right text-green-700">{formatCurrency(mappedSavings)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-6 py-3 bg-green-50/50 border-t border-green-100 text-sm text-green-800">
        B2 Class A, B, and C standard transactions are free, eliminating{' '}
        <span className="font-semibold">{formatCurrency(mappedSavings)}/mo</span> in mapped transaction charges.
        {reviewTotal > 0 && (
          <span className="text-amber-800">
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
