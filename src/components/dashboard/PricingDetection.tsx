'use client';

import type { PricingDetectionResult } from '@/types/model';
import { formatRegionWithLocation } from '@/lib/regions';
import { formatCurrency, formatPercent } from '../shared/FormatCurrency';

interface PricingDetectionProps {
  results: PricingDetectionResult[];
}

// The per-TB rate we headline for a tier: the list rate when no discount was detected, otherwise
// the bill-implied effective rate. Rates are stored per-GB, so ×1000 to get $/TB/mo for display.
function ratePerTb(result: PricingDetectionResult): number {
  const rate = result.assessment === 'list-price' ? result.listRate : result.effectiveRate;
  return rate * 1000;
}

// Order tiers most-expensive first (where B2's win is largest), breaking ties on region then
// storage class so the list stays stable across re-renders.
function sortByRateDesc(a: PricingDetectionResult, b: PricingDetectionResult): number {
  const rateDiff = ratePerTb(b) - ratePerTb(a);
  if (rateDiff !== 0) return rateDiff;
  const regionDiff = (a.region || '').localeCompare(b.region || '');
  if (regionDiff !== 0) return regionDiff;
  return (a.storageClass || '').localeCompare(b.storageClass || '');
}

/**
 * Internal-only panel that reports how the customer's observed pricing compares to list — flagging
 * any existing discount the B2 quote has to beat. Splits results into named discount programs
 * (e.g. EDP/PPA credits) and per-storage-tier rate analysis. Never rendered in the customer report.
 */
export function PricingDetection({ results }: PricingDetectionProps) {
  if (results.length === 0) return null;

  // Account-level discount programs, biggest dollar impact first.
  const discountPrograms = results
    .filter(r => r.category === 'discount-program')
    .sort((a, b) => (b.totalAmountUsd || 0) - (a.totalAmountUsd || 0));
  // Everything else is a per-tier rate observation (one row per storage class + region).
  const tierAnalysis = results.filter(r => r.category !== 'discount-program');

  const sortedTiers = [...tierAnalysis].sort(sortByRateDesc);
  const customTierCount = tierAnalysis.filter(r => r.assessment === 'custom-agreement').length;
  const discountedTierCount = tierAnalysis.filter(r => r.assessment === 'small-discount').length;
  const listPriceTierCount = tierAnalysis.filter(r => r.assessment === 'list-price').length;

  // Headline effective/list rate: prefer the top discount program, falling back to the first tier.
  const effectiveRate = discountPrograms[0]?.effectiveRate || tierAnalysis[0]?.effectiveRate || 0;
  const listRate = discountPrograms[0]?.listRate || tierAnalysis[0]?.listRate || 0;

  return (
    // Card shell: amber left accent marks this as the internal-only pricing panel.
    <div className="bg-c-surface rounded-2xl border border-c-border border-l-[3px] border-l-c-amber shadow-sm overflow-hidden">
      <div className="px-[18px] py-[15px] border-b border-c-border">
        <div className="flex items-center gap-[9px]">
          <h4 className="text-[15px] font-semibold text-c-text">Pricing Detection</h4>
          {/* "Internal" pill — soft amber so it reads as a non-customer-facing flag. */}
          <span className="text-[10px] font-bold uppercase tracking-[0.04em] px-2 py-0.5 rounded-full bg-c-amber-soft text-c-amber">
            Internal
          </span>
        </div>
        <p className="text-[11.5px] text-c-subtle mt-[3px]">Internal Only — Not Shown in Customer Report</p>
      </div>

      {discountPrograms.length > 0 && (
        // Discount-program block sits on the soft-amber wash to tie back to the card accent.
        <div className="px-[18px] py-[15px] bg-c-amber-soft border-b border-c-border">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.04em] text-c-amber mb-[9px]">Active Discount Programs</p>
          <div className="space-y-2">
            {discountPrograms.map((r, i) => {
              const pctOff = r.storagePercentOff || r.discountPercent || 0;
              return (
                <div key={i} className="bg-c-surface rounded-[10px] px-[13px] py-[11px] border border-c-border2">
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="text-[13px] font-semibold text-c-text">{r.programName}</span>
                    {pctOff > 0 && (
                      <span className="text-xs font-bold text-c-red whitespace-nowrap ml-2">
                        {formatPercent(pctOff)} off
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-c-muted mt-[3px]">-{formatCurrency(r.totalAmountUsd || 0)} total</p>
                </div>
              );
            })}
          </div>

          {effectiveRate > 0 && listRate > 0 && (
            <div className="mt-3 pt-[11px] border-t border-c-border2">
              <p className="text-[11px] text-c-amber font-semibold mb-[3px]">Effective Storage Rate</p>
              {/* Headline effective rate — display font so the number carries weight. */}
              <p className="font-display font-semibold text-[22px] text-c-text">
                ${(effectiveRate * 1000).toFixed(2)}
                <span className="text-[11px] font-medium text-c-subtle">/TB/mo</span>
              </p>
              <p className="text-[11px] text-c-muted mt-0.5">
                List: ${(listRate * 1000).toFixed(2)}/TB — <b className="text-c-red">{formatPercent(((listRate - effectiveRate) / listRate) * 100)} Below List</b>
              </p>
            </div>
          )}

          <p className="text-[11px] text-c-amber mt-2.5 leading-normal">
            Savings in the report are calculated against these discounted rates, not list pricing.
          </p>
        </div>
      )}

      {tierAnalysis.length > 0 && (
        <div className="px-[18px] py-[15px] space-y-3">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.04em] text-c-subtle">Per-Tier Rate Analysis</p>
            <p className="text-[10.5px] text-c-subtle mt-0.5">Sorted High to Low by $/TB/mo</p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {customTierCount > 0 && <SummaryPill label="Custom" count={customTierCount} tone="red" />}
            {discountedTierCount > 0 && <SummaryPill label="Small Discount" count={discountedTierCount} tone="yellow" />}
            {listPriceTierCount > 0 && <SummaryPill label="List Price" count={listPriceTierCount} tone="green" />}
          </div>

          {/* Each tier is its own bordered card, stacked with a small gap. */}
          <div className="flex flex-col gap-[11px]">
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
  // Summary pills are tinted by assessment tone using the design-system soft fills.
  const colors = {
    red: 'bg-c-red-soft text-c-red',
    yellow: 'bg-c-amber-soft text-c-amber',
    green: 'bg-c-green-soft text-c-green',
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors[tone]}`}>
      {label}
      <span className="font-bold">{count}</span>
    </span>
  );
}

/** One storage tier's rate row: its $/TB, region, discount assessment badge, and a list-vs-effective bar. */
function TierRateRow({ result: r }: { result: PricingDetectionResult }) {
  const isCustom = r.assessment === 'custom-agreement';
  const isDiscounted = r.assessment === 'small-discount';
  const isList = r.assessment === 'list-price';

  // Assessment tone drives the badge, headline rate, and bar fill colors.
  const badgeColor = isCustom
    ? 'bg-c-red-soft text-c-red'
    : isDiscounted
      ? 'bg-c-amber-soft text-c-amber'
      : 'bg-c-green-soft text-c-green';
  const badgeLabel = isCustom ? 'Custom' : isDiscounted ? 'Small Discount' : 'List Price';
  const priceColor = isCustom
    ? 'text-c-red'
    : isDiscounted
      ? 'text-c-amber'
      : 'text-c-green';
  // Solid bar fill by tone (custom uses the darker red token, never the solid bg-c-red).
  const barColor = isCustom ? 'bg-c-red-dark' : 'bg-c-amber';

  const displayedTb = ratePerTb(r).toFixed(2);
  const listTb = (r.listRate * 1000).toFixed(2);
  // Bar fill = effective as a fraction of list, floored at 5% so a deep discount still shows a sliver.
  const barWidth = r.listRate > 0 ? Math.max(5, (r.effectiveRate / r.listRate) * 100) : 100;

  return (
    // One tier card: name + region badge on the left, headline rate on the right.
    <div className="border border-c-border rounded-[11px] px-[13px] py-[11px]">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-c-text leading-snug break-words">{r.storageClass}</p>
          {/* Region rendered as a mono badge so the geo code stays scannable. */}
          <span className="inline-block mt-[3px] rounded bg-c-surface2 px-1.5 py-0.5 text-[11px] font-mono text-c-subtle break-words">
            {formatRegionWithLocation(r.region)}
          </span>
        </div>
        <div className="text-right shrink-0">
          {/* Rate headline in display font, tinted by assessment tone. */}
          <p className={`font-display font-semibold text-[15px] whitespace-nowrap ${priceColor}`}>
            ${displayedTb}<span className="text-[10px] font-medium text-c-subtle">/TB</span>
          </p>
          <p className="text-[10px] text-c-subtle">{isList ? 'List' : 'Effective'}</p>
        </div>
      </div>

      <div className="mt-[9px] flex items-center justify-between gap-2.5">
        <span className={`px-[9px] py-[3px] text-[10.5px] font-bold rounded-full whitespace-nowrap shrink-0 ${badgeColor}`}>
          {badgeLabel}
        </span>
        {isList ? (
          <span className="text-[11px] text-c-muted text-right">No Discount Detected</span>
        ) : (
          <span className="text-[11px] text-c-muted text-right">
            {formatPercent(r.discountPercent)} Below ${listTb}/TB List
          </span>
        )}
      </div>

      {!isList && (
        // Progress bar: track on surface2, fill tinted by tone, width = effective/list.
        <div className="mt-[9px] w-full h-1.5 bg-c-surface2 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${barWidth}%` }} />
        </div>
      )}
    </div>
  );
}
