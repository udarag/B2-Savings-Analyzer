'use client';

import type { PricingDetectionResult } from '@/types/model';
import { formatCurrency, formatPercent } from '../shared/FormatCurrency';

interface PricingDetectionProps {
  results: PricingDetectionResult[];
}

export function PricingDetection({ results }: PricingDetectionProps) {
  if (results.length === 0) return null;

  const discountPrograms = results.filter(r => r.category === 'discount-program');
  const tierAnalysis = results.filter(r => r.category !== 'discount-program');

  const assessmentBadge = (a: PricingDetectionResult['assessment']) => {
    switch (a) {
      case 'list-price':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full whitespace-nowrap">List Price</span>;
      case 'small-discount':
        return <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full whitespace-nowrap">Small Discount</span>;
      case 'custom-agreement':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full whitespace-nowrap">Custom</span>;
    }
  };

  // Get overall effective and list rates from discount program entries
  const effectiveRate = discountPrograms[0]?.effectiveRate || tierAnalysis[0]?.effectiveRate || 0;
  const listRate = discountPrograms[0]?.listRate || tierAnalysis[0]?.listRate || 0;

  return (
    <div className="bg-white rounded-lg shadow border-l-4 border-amber-400">
      <div className="px-5 py-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">Pricing Detection</h4>
        <p className="text-xs text-gray-500">Internal only — not shown in customer report</p>
      </div>

      {discountPrograms.length > 0 && (
        <div className="px-5 py-4 bg-amber-50 border-b border-amber-100">
          <p className="text-xs font-semibold text-amber-800 uppercase mb-3">Active Discount Programs</p>
          <div className="space-y-2">
            {discountPrograms.map((r, i) => {
              const pctOff = r.storagePercentOff || r.discountPercent || 0;
              return (
                <div key={i} className="bg-white rounded-md px-3 py-2 border border-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{r.programName}</span>
                    {pctOff > 0 && (
                      <span className="text-xs font-semibold text-red-700 whitespace-nowrap ml-2">
                        {formatPercent(pctOff)} off
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">-{formatCurrency(r.totalAmountUsd || 0)} total</p>
                </div>
              );
            })}
          </div>

          {effectiveRate > 0 && listRate > 0 && (
            <div className="mt-3 pt-3 border-t border-amber-200">
              <p className="text-xs text-amber-800 font-medium mb-1">Effective storage rate</p>
              <p className="text-lg font-semibold text-gray-900">
                ${(effectiveRate * 1000).toFixed(2)}
                <span className="text-xs font-normal text-gray-500">/TB/mo</span>
              </p>
              <p className="text-xs text-gray-400">
                List: ${(listRate * 1000).toFixed(2)}/TB — {formatPercent(((listRate - effectiveRate) / listRate) * 100)} below list
              </p>
            </div>
          )}

          <p className="text-xs text-amber-700 mt-3">
            Savings in the report are calculated against these discounted rates, not list pricing.
          </p>
        </div>
      )}

      {tierAnalysis.length > 0 && (
        <div className="p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Per-Tier Rate Analysis</p>
          {tierAnalysis.map((r, i) => (
            <div key={i} className="text-sm">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                {r.storageClass && <span className="font-medium">{r.storageClass}</span>}
                {r.region && <span className="text-gray-400 text-xs">{r.region}</span>}
                {assessmentBadge(r.assessment)}
              </div>
              <p className="text-gray-600 text-xs">{r.details}</p>
              {r.discountPercent > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  ${(r.effectiveRate * 1000).toFixed(2)}/TB vs ${(r.listRate * 1000).toFixed(2)}/TB list ({formatPercent(r.discountPercent)} off)
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
