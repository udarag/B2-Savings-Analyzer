'use client';

import type { PricingDetectionResult } from '@/types/model';
import { formatRegionWithLocation } from '@/lib/regions';
import { formatCurrency, formatPercent } from '../shared/FormatCurrency';

interface PricingDetectionProps {
  results: PricingDetectionResult[];
}

function ratePerTb(result: PricingDetectionResult): number {
  const rate = result.assessment === 'list-price' ? result.listRate : result.effectiveRate;
  return rate * 1000;
}

function sortByRateDesc(a: PricingDetectionResult, b: PricingDetectionResult): number {
  const rateDiff = ratePerTb(b) - ratePerTb(a);
  if (rateDiff !== 0) return rateDiff;
  const regionDiff = (a.region || '').localeCompare(b.region || '');
  if (regionDiff !== 0) return regionDiff;
  return (a.storageClass || '').localeCompare(b.storageClass || '');
}

export function PricingDetection({ results }: PricingDetectionProps) {
  if (results.length === 0) return null;

  const discountPrograms = results
    .filter(r => r.category === 'discount-program')
    .sort((a, b) => (b.totalAmountUsd || 0) - (a.totalAmountUsd || 0));
  const tierAnalysis = results.filter(r => r.category !== 'discount-program');

  const sortedTiers = [...tierAnalysis].sort(sortByRateDesc);
  const customTierCount = tierAnalysis.filter(r => r.assessment === 'custom-agreement').length;
  const discountedTierCount = tierAnalysis.filter(r => r.assessment === 'small-discount').length;
  const listPriceTierCount = tierAnalysis.filter(r => r.assessment === 'list-price').length;

  const effectiveRate = discountPrograms[0]?.effectiveRate || tierAnalysis[0]?.effectiveRate || 0;
  const listRate = discountPrograms[0]?.listRate || tierAnalysis[0]?.listRate || 0;

  return (
    <div className="bg-white rounded-lg shadow border-l-4 border-amber-400">
      <div className="px-5 py-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">Pricing Detection</h4>
        <p className="text-xs text-gray-500">Internal Only — Not Shown in Customer Report</p>
      </div>

      {discountPrograms.length > 0 && (
        <div className="px-5 py-4 bg-amber-50 border-b border-amber-100">
          <p className="text-xs font-semibold text-amber-800 mb-3">Active Discount Programs</p>
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
              <p className="text-xs text-amber-800 font-medium mb-1">Effective Storage Rate</p>
              <p className="text-lg font-semibold text-gray-900">
                ${(effectiveRate * 1000).toFixed(2)}
                <span className="text-xs font-normal text-gray-500">/TB/mo</span>
              </p>
              <p className="text-xs text-gray-400">
                List: ${(listRate * 1000).toFixed(2)}/TB — {formatPercent(((listRate - effectiveRate) / listRate) * 100)} Below List
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
          <div>
            <p className="text-xs font-semibold text-gray-500">Per-Tier Rate Analysis</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Sorted High to Low by $/TB/mo</p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {customTierCount > 0 && <SummaryPill label="Custom" count={customTierCount} tone="red" />}
            {discountedTierCount > 0 && <SummaryPill label="Small Discount" count={discountedTierCount} tone="yellow" />}
            {listPriceTierCount > 0 && <SummaryPill label="List Price" count={listPriceTierCount} tone="green" />}
          </div>

          <div className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {sortedTiers.map((r, i) => (
              <TierRateRow key={`${r.assessment}-${r.storageClass}-${r.region}-${i}`} result={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'red' | 'yellow' | 'green';
}) {
  const colors = {
    red: 'bg-red-50 text-red-700 ring-red-100',
    yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-100',
    green: 'bg-green-50 text-green-700 ring-green-100',
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${colors[tone]}`}>
      {label}
      <span className="font-bold">{count}</span>
    </span>
  );
}

function TierRateRow({ result: r }: { result: PricingDetectionResult }) {
  const isCustom = r.assessment === 'custom-agreement';
  const isDiscounted = r.assessment === 'small-discount';
  const isList = r.assessment === 'list-price';

  const badgeColor = isCustom
    ? 'bg-red-100 text-red-700'
    : isDiscounted
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-green-100 text-green-700';
  const badgeLabel = isCustom ? 'Custom' : isDiscounted ? 'Small Discount' : 'List Price';
  const priceColor = isCustom
    ? 'text-red-700'
    : isDiscounted
      ? 'text-yellow-700'
      : 'text-green-700';
  const barColor = isCustom ? 'bg-red-400' : 'bg-yellow-400';

  const displayedTb = ratePerTb(r).toFixed(2);
  const listTb = (r.listRate * 1000).toFixed(2);
  const barWidth = r.listRate > 0 ? Math.max(5, (r.effectiveRate / r.listRate) * 100) : 100;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug break-words">{r.storageClass}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-bold whitespace-nowrap ${priceColor}`}>${displayedTb}/TB</p>
          <p className="text-[10px] text-gray-400">{isList ? 'List' : 'Effective'}</p>
        </div>
      </div>

      <div className="mt-2 rounded-md bg-gray-50 px-2 py-1 text-[11px] leading-snug text-gray-600 ring-1 ring-gray-200">
        <span className="font-medium text-gray-400">Region </span>
        <span className="font-semibold break-words">{formatRegionWithLocation(r.region)}</span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`px-2 py-0.5 text-[11px] rounded-full whitespace-nowrap shrink-0 ${badgeColor}`}>
          {badgeLabel}
        </span>
        {isList ? (
          <span className="text-[11px] text-gray-500 text-right">No Discount Detected</span>
        ) : (
          <span className="text-[11px] text-gray-500 text-right">
            {formatPercent(r.discountPercent)} Below ${listTb}/TB List
          </span>
        )}
      </div>

      {!isList && (
        <div className="mt-1.5 w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${barWidth}%` }} />
        </div>
      )}
    </div>
  );
}
