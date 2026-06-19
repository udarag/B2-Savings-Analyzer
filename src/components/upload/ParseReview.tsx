'use client';

import type { ParsedBill, Category } from '@/types/analysis';
import { formatCurrency, formatNumber } from '../shared/FormatCurrency';

interface ParseReviewProps {
  parsed: ParsedBill;
}

const CATEGORY_ORDER: Category[] = ['storage', 'egress', 'operations', 'retrieval', 'storage-adjacent', 'out-of-scope'];
const CATEGORY_LABELS: Record<Category, string> = {
  'storage': 'Storage',
  'egress': 'Egress / Data Transfer',
  'operations': 'API Operations',
  'retrieval': 'Retrieval / Early Deletion',
  'storage-adjacent': 'Storage-Adjacent (EBS, EFS, ECR, CloudFront)',
  'out-of-scope': 'Out of Scope',
};
const CATEGORY_COLORS: Record<Category, string> = {
  'storage': 'bg-red-100 text-red-800',
  'egress': 'bg-purple-100 text-purple-800',
  'operations': 'bg-green-100 text-green-800',
  'retrieval': 'bg-orange-100 text-orange-800',
  'storage-adjacent': 'bg-gray-100 text-gray-700',
  'out-of-scope': 'bg-gray-50 text-gray-500',
};

export function ParseReview({ parsed }: ParseReviewProps) {
  const categorySums = new Map<Category, { count: number; total: number }>();

  for (const item of parsed.lineItems) {
    const existing = categorySums.get(item.category) || { count: 0, total: 0 };
    existing.count++;
    existing.total += item.costUsd;
    categorySums.set(item.category, existing);
  }

  const addressable = (categorySums.get('storage')?.total || 0) +
    (categorySums.get('egress')?.total || 0) +
    (categorySums.get('operations')?.total || 0) +
    (categorySums.get('retrieval')?.total || 0);

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Parse Review</h3>
            <p className="text-sm text-gray-500 mt-1">
              {parsed.lineItems.length} line items parsed. Grand total: {formatCurrency(parsed.grandTotal)}.
              Addressable storage spend: {formatCurrency(addressable)}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${parsed.parseConfidence >= 0.8 ? 'bg-green-500' : parsed.parseConfidence >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-600">
              {Math.round(parsed.parseConfidence * 100)}% confidence
            </span>
          </div>
        </div>
        {parsed.warnings.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 rounded-lg">
            {parsed.warnings.map((w, i) => (
              <p key={i} className="text-sm text-amber-800">{w}</p>
            ))}
          </div>
        )}
      </div>
      <div className="p-6">
        <div className="space-y-3">
          {CATEGORY_ORDER.map((cat) => {
            const data = categorySums.get(cat);
            if (!data) return null;
            return (
              <div key={cat} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${CATEGORY_COLORS[cat]}`}>
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <span className="text-sm text-gray-500">{data.count} items</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(data.total)}</span>
              </div>
            );
          })}
        </div>

        {parsed.discounts && parsed.discounts.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Named Discounts</h4>
            {parsed.discounts.map((d, i) => (
              <div key={i} className="flex justify-between text-sm py-1">
                <span className="text-gray-600">{d.name}</span>
                <span className="text-green-700 font-medium">-{formatCurrency(d.amountUsd)}</span>
              </div>
            ))}
          </div>
        )}

        {parsed.accounts && parsed.accounts.length > 0 && !parsed.accountServiceBreakdowns && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Linked Accounts ({parsed.accounts.length})
            </h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {parsed.accounts.slice(0, 10).map((acct) => (
                <div key={acct.accountId} className="flex justify-between py-1">
                  <span className="text-gray-600 truncate mr-2">{acct.accountName}</span>
                  <span className="text-gray-900 font-medium shrink-0">{formatCurrency(acct.amountUsd)}</span>
                </div>
              ))}
              {parsed.accounts.length > 10 && (
                <p className="text-xs text-gray-400 col-span-2">
                  +{parsed.accounts.length - 10} more accounts
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
