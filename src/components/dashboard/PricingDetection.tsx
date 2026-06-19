'use client';

import type { PricingDetectionResult } from '@/types/model';
import { formatPercent } from '../shared/FormatCurrency';

interface PricingDetectionProps {
  results: PricingDetectionResult[];
}

export function PricingDetection({ results }: PricingDetectionProps) {
  if (results.length === 0) return null;

  const assessmentBadge = (a: PricingDetectionResult['assessment']) => {
    switch (a) {
      case 'list-price':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">List Price</span>;
      case 'small-discount':
        return <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">Small Discount</span>;
      case 'custom-agreement':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Custom Agreement</span>;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow border-l-4 border-amber-400">
      <div className="px-5 py-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">Pricing Detection</h4>
        <p className="text-xs text-gray-500">Internal only — not shown in customer report</p>
      </div>
      <div className="p-5 space-y-3">
        {results.map((r, i) => (
          <div key={i} className="text-sm">
            <div className="flex items-center gap-2 mb-1">
              {r.storageClass && <span className="font-medium">{r.storageClass}</span>}
              {r.region && <span className="text-gray-400">{r.region}</span>}
              {assessmentBadge(r.assessment)}
            </div>
            <p className="text-gray-600 text-xs">{r.details}</p>
            {r.discountPercent > 0 && r.category !== 'discount-program' && (
              <p className="text-xs text-gray-400 mt-0.5">
                Effective: ${(r.effectiveRate * 1000).toFixed(3)}/TB vs List: ${(r.listRate * 1000).toFixed(3)}/TB ({formatPercent(r.discountPercent)} off)
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
