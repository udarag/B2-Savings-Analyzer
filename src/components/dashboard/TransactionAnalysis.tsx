'use client';

import type { ParsedLineItem } from '@/types/analysis';
import { formatCurrency } from '../shared/FormatCurrency';

interface TransactionAnalysisProps {
  lineItems: ParsedLineItem[];
}

function groupLabel(subcategory: string): string {
  switch (subcategory) {
    case 'PUT/COPY/POST/LIST': return 'Write Requests (PUT/COPY/POST/LIST)';
    case 'GET/SELECT': return 'Read Requests (GET/SELECT)';
    case 'Monitoring/Analytics': return 'Monitoring & Analytics';
    case 'S3 Inventory': return 'S3 Inventory';
    case 'Lifecycle Transitions': return 'Lifecycle Transitions';
    case 'Lifecycle/Copy': return 'Lifecycle & Copy';
    case 'Tag Storage': return 'Tag Storage';
    case 'Metadata': return 'Metadata';
    case 'S3 Select': return 'S3 Select';
    case 'Class A': return 'Class A Operations (Writes)';
    case 'Class B': return 'Class B Operations (Reads)';
    default: return subcategory || 'Other Operations';
  }
}

export function TransactionAnalysis({ lineItems }: TransactionAnalysisProps) {
  const opsItems = lineItems.filter((item) => item.category === 'operations');
  if (opsItems.length === 0) return null;

  const groups = new Map<string, { label: string; cost: number; count: number }>();
  for (const item of opsItems) {
    const key = item.subcategory || 'Other';
    const existing = groups.get(key);
    if (existing) {
      existing.cost += item.costUsd;
      existing.count++;
    } else {
      groups.set(key, { label: groupLabel(key), cost: item.costUsd, count: 1 });
    }
  }

  const sorted = Array.from(groups.values()).sort((a, b) => b.cost - a.cost);
  const totalOps = sorted.reduce((s, g) => s + g.cost, 0);

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Transaction Cost Analysis</h3>
            <p className="text-sm text-gray-500 mt-1">
              API request and operations fees from the current bill
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
            <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-green-800">B2 transactions are free</span>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Operation Type</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Current Cost</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">B2 Cost</th>
              <th className="px-6 py-3 text-right font-medium text-gray-500">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((group) => (
              <tr key={group.label}>
                <td className="px-6 py-3 text-gray-900">{group.label}</td>
                <td className="px-6 py-3 text-right text-gray-900">{formatCurrency(group.cost)}</td>
                <td className="px-6 py-3 text-right text-green-600 font-medium">$0.00</td>
                <td className="px-6 py-3 text-right text-green-700 font-medium">{formatCurrency(group.cost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="font-semibold">
              <td className="px-6 py-3 text-gray-900">Total Transaction Savings</td>
              <td className="px-6 py-3 text-right text-gray-900">{formatCurrency(totalOps)}</td>
              <td className="px-6 py-3 text-right text-green-600">$0.00</td>
              <td className="px-6 py-3 text-right text-green-700">{formatCurrency(totalOps)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {totalOps > 0 && (
        <div className="px-6 py-3 bg-green-50/50 border-t border-green-100 text-sm text-green-800">
          Migrating to B2 eliminates <span className="font-semibold">{formatCurrency(totalOps)}/mo</span> in transaction fees.
          All standard B2 API operations (uploads, downloads, list, copy, delete) are included at no extra charge.
        </div>
      )}
    </div>
  );
}
