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

  const customTiers = tierAnalysis.filter(r => r.assessment === 'custom-agreement');
  const discountedTiers = tierAnalysis.filter(r => r.assessment === 'small-discount');
  const listPriceTiers = tierAnalysis.filter(r => r.assessment === 'list-price');

  const effectiveRate = discountPrograms[0]?.effectiveRate || tierAnalysis[0]?.effectiveRate || 0;
  const listRate = discountPrograms[0]?.listRate || tierAnalysis[0]?.listRate || 0;

  return (
    <div className="bg-white rounded-lg shadow border-l-4 border-amber-400">
      <div className="px-5 py-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">Pricing detection</h4>
        <p className="text-xs text-gray-500">Internal only — not shown in customer report</p>
      </div>

      {discountPrograms.length > 0 && (
        <div className="px-5 py-4 bg-amber-50 border-b border-amber-100">
          <p className="text-xs font-semibold text-amber-800 mb-3">Active discount programs</p>
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
        <div className="p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-500">Per-tier rate analysis</p>

          {customTiers.length > 0 && (
            <div className="space-y-2">
              {customTiers.map((r, i) => (
                <TierCard key={`custom-${i}`} result={r} />
              ))}
            </div>
          )}

          {discountedTiers.length > 0 && (
            <div className="space-y-2">
              {discountedTiers.map((r, i) => (
                <TierCard key={`discount-${i}`} result={r} />
              ))}
            </div>
          )}

          {listPriceTiers.length > 0 && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800 whitespace-nowrap">
                  List price
                </span>
                <span className="text-xs font-medium text-green-700">
                  {listPriceTiers.length} {listPriceTiers.length === 1 ? 'tier' : 'tiers'} — no discount detected
                </span>
              </div>
              <div className="rounded border border-green-100 bg-white divide-y divide-green-100">
                {listPriceTiers.map((r, i) => (
                  <div key={`list-${i}`} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium text-gray-700 truncate">{r.storageClass}</span>
                      {r.region && <span className="text-gray-400 shrink-0">{r.region}</span>}
                    </div>
                    <span className="text-green-700 font-medium shrink-0 ml-2">
                      ${(r.listRate * 1000).toFixed(2)}/TB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TierCard({ result: r }: { result: PricingDetectionResult }) {
  const isCustom = r.assessment === 'custom-agreement';
  const borderColor = isCustom ? 'border-red-200' : 'border-yellow-200';
  const bgColor = isCustom ? 'bg-red-50' : 'bg-yellow-50';
  const badgeColor = isCustom
    ? 'bg-red-100 text-red-700'
    : 'bg-yellow-100 text-yellow-700';
  const badgeLabel = isCustom ? 'Custom' : 'Small discount';
  const barColor = isCustom ? 'bg-red-400' : 'bg-yellow-400';

  const effectiveTb = (r.effectiveRate * 1000).toFixed(2);
  const listTb = (r.listRate * 1000).toFixed(2);
  const barWidth = r.listRate > 0 ? Math.max(5, (r.effectiveRate / r.listRate) * 100) : 100;

  return (
    <div className={`rounded-md border ${borderColor} ${bgColor} px-3 py-2.5`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">{r.storageClass}</span>
          {r.region && <span className="text-xs text-gray-400">{r.region}</span>}
        </div>
        <span className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${badgeColor}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="mt-2 mb-1">
        <div className="flex items-baseline justify-between text-xs mb-1">
          <span className="text-gray-600">
            <span className="font-semibold text-gray-900">${effectiveTb}</span>/TB
          </span>
          <span className="text-gray-400">
            vs ${listTb}/TB list
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${barWidth}%` }} />
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-1.5">
        {formatPercent(r.discountPercent)} below list
        {isCustom && ' — likely EDP, PRC, or committed spend'}
      </p>
    </div>
  );
}
