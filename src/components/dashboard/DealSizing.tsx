'use client';

import { useRef, useState } from 'react';
import { formatCurrency } from '../shared/FormatCurrency';
import b2Pricing from '@/lib/pricing/b2.json';
import type { EgressConfig, B2ServiceTier } from '@/types/analysis';
import { formatGrowthAssumption, projectStorageGbForMonth } from '@/lib/engine/projections';
import { getServiceTierSpec } from '@/lib/pricing/service-levels';

const SERVICE_TIERS: readonly B2ServiceTier[] = ['uncommitted', 'committed', 'overdrive'];
const SERVICE_TIER_LABELS: Record<B2ServiceTier, string> = {
  uncommitted: 'Uncommitted',
  committed: 'Committed',
  overdrive: 'Overdrive',
};

const B2_LIST_PRICE_PER_TB = b2Pricing.storage.perTbMonth;
// Tolerance for matching the live price back to a preset. Preset prices are rounded to cents, so an
// exact === would fail to re-highlight a preset after the price round-trips through the input.
const PRICE_EPSILON = 0.001;
const TERM_OPTIONS = [
  { years: 1, months: 12 },
  { years: 2, months: 24 },
  { years: 3, months: 36 },
  { years: 5, months: 60 },
] as const;

type PresetId = 'list' | 'discount5' | 'discount10' | 'custom';

interface DealSizingProps {
  /** Negotiated B2 storage rate in $/TB-month the AE is modeling (list, a discount preset, or a custom value). */
  b2PricePerTb: number;
  onB2PriceChange: (price: number) => void;
  /** B2 service tier the AE is modeling; drives the throughput/RPS reference card and the Overdrive price suggestion. */
  b2ServiceTier: B2ServiceTier;
  onServiceTierChange: (tier: B2ServiceTier) => void;
  /** Total modeled monthly B2 spend (storage plus any non-storage B2 revenue); drives ARR/TCV and UDM break-even. */
  monthlyB2Revenue: number;
  termMonths: number;
  onTermChange: (months: number) => void;
  growthMode: EgressConfig['dataGrowthMode'];
  growthRatePercent: number;
  growthFixedTbPerMonth: number;
  onGrowthChange: (updates: Partial<Pick<EgressConfig, 'dataGrowthMode' | 'dataGrowthRatePercent' | 'dataGrowthFixedTbPerMonth'>>) => void;
  /** Starting (month-zero) migrated storage in GB; growth projects forward from this base. */
  totalStorageGb: number;
  udmEnabled: boolean;
  onUdmChange: (enabled: boolean) => void;
  /** One-time internal cost to Backblaze of covering the migration egress under UDM — never customer-facing. */
  udmCostToBackblaze: number;
}

/**
 * Internal-only deal-sizing panel: lets the AE set the B2 price, term, and data-growth assumptions,
 * then shows projected B2 revenue (ARR/TCV) versus list and the UDM cost/break-even. Surfaces revenue
 * to Backblaze, not customer savings — it is deliberately gated behind the "Internal Only" label.
 */
export function DealSizing({
  b2PricePerTb,
  onB2PriceChange,
  b2ServiceTier,
  onServiceTierChange,
  monthlyB2Revenue,
  termMonths,
  onTermChange,
  growthMode,
  growthRatePercent,
  growthFixedTbPerMonth,
  onGrowthChange,
  totalStorageGb,
  udmEnabled,
  onUdmChange,
  udmCostToBackblaze,
}: DealSizingProps) {
  const priceInputRef = useRef<HTMLInputElement>(null);
  const inferredPreset = getActivePreset(
    b2PricePerTb,
    roundPrice(B2_LIST_PRICE_PER_TB * 0.95),
    roundPrice(B2_LIST_PRICE_PER_TB * 0.9),
  );
  const [customMode, setCustomMode] = useState(inferredPreset === 'custom');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [priceInputFocused, setPriceInputFocused] = useState(false);
  const [priceInputDraft, setPriceInputDraft] = useState(() => formatPriceNumber(b2PricePerTb));

  const discount5Price = roundPrice(B2_LIST_PRICE_PER_TB * 0.95);
  const discount10Price = roundPrice(B2_LIST_PRICE_PER_TB * 0.9);
  const activePreset = customMode ? 'custom' : getActivePreset(b2PricePerTb, discount5Price, discount10Price);
  const isCustom = activePreset === 'custom';
  const discountPercent = B2_LIST_PRICE_PER_TB > 0
    ? (1 - b2PricePerTb / B2_LIST_PRICE_PER_TB) * 100
    : 0;
  // App basis is decimal TB (1 TB = 1000 GB), matching how B2 and hyperscaler bills price storage.
  const storageTb = totalStorageGb / 1000;
  const termIndex = termIndexForMonths(termMonths);
  const growthLabel = formatGrowthAssumption({
    growthMode,
    annualGrowthPercent: growthRatePercent,
    fixedGrowthTbPerMonth: growthFixedTbPerMonth,
  });
  // Split the modeled monthly B2 revenue into the storage portion (which scales with the price slider)
  // and a non-storage remainder (e.g. egress) that the price control should not move. The remainder is
  // later scaled with storage volume so it grows in proportion as projected data grows.
  const baseStorageRevenue = totalStorageGb * (b2PricePerTb / 1000);
  const baseNonStorageRevenue = Math.max(0, monthlyB2Revenue - baseStorageRevenue);
  const currentRevenue = getProjectedRevenueProfile({
    baseStorageGb: totalStorageGb,
    baseNonStorageRevenue,
    pricePerTb: b2PricePerTb,
    termMonths,
    growthMode,
    growthRatePercent,
    growthFixedTbPerMonth,
  });
  const listRevenue = getProjectedRevenueProfile({
    baseStorageGb: totalStorageGb,
    baseNonStorageRevenue,
    pricePerTb: B2_LIST_PRICE_PER_TB,
    termMonths,
    growthMode,
    growthRatePercent,
    growthFixedTbPerMonth,
  });
  const annualRevenue = currentRevenue.firstYearRevenue;
  const termValue = currentRevenue.termRevenue;
  const listAnnualRevenue = listRevenue.firstYearRevenue;
  const listTermValue = listRevenue.termRevenue;
  const revenueDelta = termValue - listTermValue;

  const handlePresetClick = (preset: PresetId) => {
    if (preset === 'custom') {
      setCustomMode(true);
      setPriceInputDraft(formatPriceNumber(b2PricePerTb));
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
      return;
    }

    setCustomMode(false);
    const nextPrice = preset === 'list'
      ? B2_LIST_PRICE_PER_TB
      : preset === 'discount5'
        ? discount5Price
        : discount10Price;

    setPriceInputDraft(formatPriceNumber(nextPrice));
    onB2PriceChange(nextPrice);
  };

  const handleServiceTierClick = (tier: B2ServiceTier) => {
    const wasOverdrive = b2ServiceTier === 'overdrive';
    onServiceTierChange(tier);
    // One-time suggestion, exactly like clicking a discount preset: sets the price but leaves it
    // fully editable afterward. Only fires switching INTO Overdrive from a different tier, so it
    // doesn't re-suggest $15 on every re-render while already on Overdrive.
    if (tier === 'overdrive' && !wasOverdrive) {
      const suggestedPrice = b2Pricing.serviceLevels.overdrive.startingPerTbMonth;
      setCustomMode(true);
      setPriceInputDraft(formatPriceNumber(suggestedPrice));
      onB2PriceChange(suggestedPrice);
    }
  };

  const handlePriceInputChange = (value: string) => {
    setCustomMode(true);
    setPriceInputDraft(value);

    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      onB2PriceChange(Math.max(0.01, parsedValue));
    }
  };

  const handlePriceInputBlur = () => {
    setPriceInputFocused(false);

    const parsedValue = Number(priceInputDraft);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      setPriceInputDraft(formatPriceNumber(B2_LIST_PRICE_PER_TB));
      onB2PriceChange(B2_LIST_PRICE_PER_TB);
      return;
    }

    setPriceInputDraft(formatPriceNumber(parsedValue));
  };

  const copyDealSummary = async () => {
    const summary = [
      'Backblaze B2 Deal Summary',
      `Starting storage: ${formatStorageTb(storageTb)}`,
      `Modeled storage over term: ${formatTbMonths(currentRevenue.modeledStorageTbMonths)} (${formatStorageTb(storageTb)} starting to ${formatStorageTb(currentRevenue.endingStorageGb / 1000)} ending)`,
      `B2 price modeled: ${formatRate(b2PricePerTb)} (${presetLabel(activePreset)})`,
      `Monthly B2 revenue: ${formatCurrency(monthlyB2Revenue)}`,
      `Growth assumption: ${growthLabel}`,
      `Year 1 ARR with growth: ${formatCurrency(annualRevenue)}`,
      `TCV with growth (${formatTermLabel(termMonths)}): ${formatCurrency(termValue)}`,
      `B2 list comparison with growth: ${formatCurrency(listAnnualRevenue)} Year 1 ARR / ${formatCurrency(listTermValue)} TCV at ${formatRate(B2_LIST_PRICE_PER_TB)}`,
      `Revenue vs. list: ${revenueDelta >= 0 ? '+' : ''}${formatCurrency(revenueDelta)} over ${formatTermLabel(termMonths)}${discountPercent > 0 ? ` (${discountPercent.toFixed(1)}% discount)` : discountPercent < 0 ? ` (${Math.abs(discountPercent).toFixed(1)}% premium)` : ''}`,
      `UDM: ${udmEnabled ? `Enabled; estimated Backblaze migration cost ${formatCurrency(udmCostToBackblaze)}` : 'Not enabled'}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
      window.setTimeout(() => setCopyStatus('idle'), 2500);
    }
  };

  return (
    // Sidebar "Build the deal" card: surface panel with a left red accent on the header and an
    // amber "Internal" pill marking this as a non-customer-facing revenue tool.
    <div className="rounded-2xl border border-c-border bg-c-surface shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-c-border border-l-[3px] border-l-[#e20626]">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-c-text">Build the deal</h4>
          <span className="rounded-full bg-c-amber-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-c-amber">
            Internal
          </span>
        </div>
        <p className="mt-1 text-xs text-c-subtle">Internal Only — B2 Revenue Estimate</p>
      </div>
      <div className="p-5 space-y-4">
        {/* B2 price control */}
        <div>
          <label className="block text-xs font-medium text-c-muted mb-1.5">
            B2 Price per TB/month
          </label>
          {/* Editable rate input on the recessed surface2 fill with a red focus ring. */}
          <div className="mb-3 rounded-xl border border-c-border2 bg-c-surface2 p-3">
            <div className="flex items-center rounded-lg border border-c-border2 bg-c-surface focus-within:border-[#e20626] focus-within:ring-2 focus-within:ring-c-red-soft">
              <span className="pl-3 text-sm font-semibold text-c-subtle">$</span>
              <input
                ref={priceInputRef}
                type="text"
                inputMode="decimal"
                value={priceInputFocused ? priceInputDraft : formatPriceNumber(b2PricePerTb)}
                onFocus={() => {
                  setPriceInputFocused(true);
                  setPriceInputDraft(formatPriceNumber(b2PricePerTb));
                }}
                onBlur={handlePriceInputBlur}
                onChange={(e) => handlePriceInputChange(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2 font-display text-lg font-semibold text-c-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pr-3 text-xs font-semibold uppercase tracking-wide text-c-subtle">/TB</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-c-subtle">
                List: {formatRate(B2_LIST_PRICE_PER_TB)}
                {isCustom && b2PricePerTb < B2_LIST_PRICE_PER_TB && ` · ${((1 - b2PricePerTb / B2_LIST_PRICE_PER_TB) * 100).toFixed(1)}% Discount`}
                {isCustom && b2PricePerTb > B2_LIST_PRICE_PER_TB && ` · ${(((b2PricePerTb / B2_LIST_PRICE_PER_TB) - 1) * 100).toFixed(1)}% Premium`}
              </p>
              {isCustom && (
                <button
                  onClick={() => {
                    setCustomMode(false);
                    setPriceInputDraft(formatPriceNumber(B2_LIST_PRICE_PER_TB));
                    onB2PriceChange(B2_LIST_PRICE_PER_TB);
                  }}
                  className="shrink-0 text-xs font-semibold text-c-red hover:text-c-red-dark"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            <PresetButton
              label="List"
              detail={formatRate(B2_LIST_PRICE_PER_TB)}
              active={activePreset === 'list'}
              onClick={() => handlePresetClick('list')}
            />
            <PresetButton
              label="5% Discount"
              detail={formatRate(discount5Price)}
              active={activePreset === 'discount5'}
              onClick={() => handlePresetClick('discount5')}
            />
            <PresetButton
              label="10% Discount"
              detail={formatRate(discount10Price)}
              active={activePreset === 'discount10'}
              onClick={() => handlePresetClick('discount10')}
            />
            <PresetButton
              label="Custom"
              detail={isCustom ? formatRate(b2PricePerTb) : 'Manual'}
              active={isCustom}
              onClick={() => handlePresetClick('custom')}
            />
          </div>
        </div>

        {/* B2 Service Tier: 3-way segmented toggle, same active-fill pattern as the %/Fixed growth toggle below. */}
        <div className="border-t border-c-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-c-muted">B2 Service Tier</label>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-c-surface2 p-1">
            {SERVICE_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => handleServiceTierClick(tier)}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  b2ServiceTier === tier
                    ? 'bg-[#e20626] hover:bg-[#b40a23] text-white'
                    : 'text-c-muted hover:text-c-text'
                }`}
              >
                {SERVICE_TIER_LABELS[tier]}
              </button>
            ))}
          </div>
          <ServiceTierSpecCard tier={b2ServiceTier} />
        </div>

        <div className="border-t border-c-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label htmlFor="deal-term-slider" className="text-xs font-medium text-c-muted">Contract Term</label>
            <span className="text-xs font-semibold text-c-text">{formatTermLabel(termMonths)}</span>
          </div>
          {/* Term stays a range slider (preserving termIndex/onTermChange wiring); brand-red accent. */}
          <input
            id="deal-term-slider"
            type="range"
            min={0}
            max={TERM_OPTIONS.length - 1}
            step={1}
            value={termIndex}
            onChange={(e) => onTermChange(TERM_OPTIONS[Number(e.target.value)].months)}
            className="w-full accent-[#e20626]"
          />
          <div className="relative mt-1 h-5 text-[10px] font-medium text-c-subtle">
            {TERM_OPTIONS.map((option, index) => (
              <span
                key={option.months}
                className={`absolute top-0 ${
                  index === 0
                    ? 'translate-x-0'
                    : index === TERM_OPTIONS.length - 1
                      ? '-translate-x-full'
                      : '-translate-x-1/2'
                } ${option.months === termMonths ? 'text-c-red-dark' : ''}`}
                style={{ left: `${(index / (TERM_OPTIONS.length - 1)) * 100}%` }}
              >
                {option.years}Y
              </span>
            ))}
          </div>
        </div>

        <div className="border-t border-c-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-c-muted">Data Growth</p>
            <span className="text-xs font-semibold text-c-text">{growthLabel}</span>
          </div>
          <div className="mb-3 rounded-xl border border-c-border2 bg-c-surface2 p-3">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-c-subtle">
              {growthMode === 'percent' ? 'Annual Growth' : 'Added Storage per Month'}
            </label>
            <div className="flex items-center rounded-lg border border-c-border2 bg-c-surface focus-within:border-[#e20626] focus-within:ring-2 focus-within:ring-c-red-soft">
              <input
                type="number"
                min={0}
                max={growthMode === 'percent' ? 200 : undefined}
                step={growthMode === 'percent' ? 1 : 0.1}
                value={growthMode === 'percent' ? growthRatePercent : growthFixedTbPerMonth}
                onChange={(e) => {
                  const value = Math.max(0, Number(e.target.value) || 0);
                  onGrowthChange(
                    growthMode === 'percent'
                      ? { dataGrowthRatePercent: value }
                      : { dataGrowthFixedTbPerMonth: value },
                  );
                }}
                className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 font-display text-lg font-semibold text-c-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pr-3 text-xs font-semibold uppercase tracking-wide text-c-subtle">
                {growthMode === 'percent' ? '%/yr' : 'TB/mo'}
              </span>
            </div>
            <p className="mt-2 text-xs text-c-subtle">
              {growthMode === 'percent'
                ? 'Applied as monthly compounded growth.'
                : 'Added linearly to projected storage each month.'}
            </p>
          </div>
          {/* %/Fixed segmented toggle: active segment is a solid brand-red fill with white text. */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-c-surface2 p-1">
            <button
              type="button"
              onClick={() => onGrowthChange({ dataGrowthMode: 'percent' })}
              className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                growthMode === 'percent'
                  ? 'bg-[#e20626] hover:bg-[#b40a23] text-white'
                  : 'text-c-muted hover:text-c-text'
              }`}
            >
              % Growth
            </button>
            <button
              type="button"
              onClick={() => onGrowthChange({ dataGrowthMode: 'fixed-tb' })}
              className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                growthMode === 'fixed-tb'
                  ? 'bg-[#e20626] hover:bg-[#b40a23] text-white'
                  : 'text-c-muted hover:text-c-text'
              }`}
            >
              Fixed TB/Month
            </button>
          </div>
        </div>

        {/* UDM Toggle */}
        <div className="border-t border-c-border pt-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-medium text-c-text">Universal Data Migration</label>
              <p className="text-xs text-c-subtle">Backblaze Covers Migration Egress</p>
            </div>
            {/* ON = filled brand-red track with a white knob; OFF = neutral border2 track. */}
            <button
              onClick={() => onUdmChange(!udmEnabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                udmEnabled ? 'bg-[#e20626]' : 'bg-c-border2'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  udmEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          </div>
          {udmEnabled && (() => {
            // Months of B2 revenue needed to recoup Backblaze's one-time UDM migration outlay.
            // This is the internal payback for Backblaze, not the customer's savings break-even.
            const b2BreakEven = monthlyB2Revenue > 0
              ? Math.ceil(udmCostToBackblaze / monthlyB2Revenue)
              : null;
            return (
              // Soft-red cost panel; the divider uses a translucent brand red to stay on-theme.
              <div className="mt-2 bg-c-red-soft rounded-xl p-2.5 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-c-red-dark">B2 UDM Cost (at ${b2Pricing.udm.costPerGb}/GB)</span>
                  <span className="font-semibold text-c-text">{formatCurrency(udmCostToBackblaze)}</span>
                </div>
                <p className="text-xs text-c-subtle">
                  {(totalStorageGb / 1000).toFixed(1)} TB × ${b2Pricing.udm.costPerGb}/GB — One-Time Cost to Backblaze
                </p>
                <div className="flex justify-between text-xs border-t border-[#e20626]/20 pt-2">
                  <span className="text-c-red-dark">B2 UDM Break-even</span>
                  <span className="font-semibold text-c-text">
                    {b2BreakEven !== null
                      ? `Month ${b2BreakEven}`
                      : 'N/A'}
                  </span>
                </div>
                {b2BreakEven !== null && (
                  <p className="text-xs text-c-subtle">
                    {formatCurrency(udmCostToBackblaze)} UDM Cost ÷ {formatCurrency(monthlyB2Revenue)}/mo Revenue
                  </p>
                )}
              </div>
            );
          })()}
        </div>

        <div className="border-t border-c-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-c-muted">ARR / TCV Summary</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-c-border">
            <RevenueSummaryRow
              label="Current B2 Price"
              rate={formatRate(b2PricePerTb)}
              arr={annualRevenue}
              tcv={termValue}
              active
            />
            <RevenueSummaryRow
              label="List Price"
              rate={formatRate(B2_LIST_PRICE_PER_TB)}
              arr={listAnnualRevenue}
              tcv={listTermValue}
            />
            {isCustom ? (
              <RevenueSummaryRow
                label="Custom Price"
                rate={formatRate(b2PricePerTb)}
                arr={annualRevenue}
                tcv={termValue}
              />
            ) : (
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-c-border px-2.5 py-2 text-xs bg-c-surface">
                <div>
                  <p className="font-medium text-c-muted">Custom Price</p>
                  <p className="text-[11px] text-c-subtle">Select Custom to model</p>
                </div>
                <span className="text-right text-c-subtle">—</span>
                <span className="text-right text-c-subtle">—</span>
              </div>
            )}
          </div>
        </div>

        {/* Revenue impact vs list — green when the deal lifts revenue, red when it cuts it. */}
        {isCustom && (
          <div className={`border-t border-c-border pt-3 ${revenueDelta < 0 ? 'text-c-red' : 'text-c-green'}`}>
            <p className="text-xs font-medium text-c-muted mb-1">Revenue vs. List Price</p>
            <div className="flex justify-between text-sm">
              <span className="text-c-muted">{formatTermLabel(termMonths)} at List (${B2_LIST_PRICE_PER_TB}/TB)</span>
              <span className="text-c-text font-medium">{formatCurrency(listTermValue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-c-muted">{formatTermLabel(termMonths)} at ${b2PricePerTb}/TB</span>
              <span className="font-medium">{formatCurrency(termValue)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-c-border mt-1 pt-1">
              <span>{revenueDelta < 0 ? 'Revenue Impact' : 'Revenue Uplift'}</span>
              <span>{revenueDelta < 0 ? '' : '+'}{formatCurrency(revenueDelta)}</span>
            </div>
          </div>
        )}

        {/* Primary action: solid brand-red button. */}
        <div className="border-t border-c-border pt-3">
          <button
            onClick={copyDealSummary}
            className="w-full rounded-lg bg-[#e20626] hover:bg-[#b40a23] px-3 py-2.5 text-xs font-semibold text-white transition-colors"
          >
            {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'error' ? 'Copy Failed' : 'Copy Deal Summary'}
          </button>
        </div>
      </div>
    </div>
  );
}

function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}

function pricesMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= PRICE_EPSILON;
}

// Infer which preset chip a live price corresponds to, falling back to 'custom' when it matches none.
// Used to re-highlight the right chip after the price is loaded or round-tripped through the input.
function getActivePreset(price: number, discount5Price: number, discount10Price: number): PresetId {
  if (pricesMatch(price, B2_LIST_PRICE_PER_TB)) return 'list';
  if (pricesMatch(price, discount5Price)) return 'discount5';
  if (pricesMatch(price, discount10Price)) return 'discount10';
  return 'custom';
}

function presetLabel(preset: PresetId): string {
  switch (preset) {
    case 'list': return 'List';
    case 'discount5': return '5% Discount';
    case 'discount10': return '10% Discount';
    case 'custom': return 'Custom';
  }
}

function formatRate(pricePerTb: number): string {
  return `$${pricePerTb.toFixed(2)}/TB`;
}

function formatPriceNumber(pricePerTb: number): string {
  return pricePerTb.toFixed(2);
}

function formatStorageTb(tb: number): string {
  return `${tb.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} TB`;
}

function formatTbMonths(tbMonths: number): string {
  return `${tbMonths.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} TB-months`;
}

// Map a term in months to its slider index. The slider only offers the fixed TERM_OPTIONS stops, so a
// persisted term that isn't one of them (e.g. an older config) snaps to the nearest available stop.
function termIndexForMonths(termMonths: number): number {
  const exact = TERM_OPTIONS.findIndex((option) => option.months === termMonths);
  if (exact >= 0) return exact;

  return TERM_OPTIONS.reduce((closestIndex, option, index) => {
    const closestDistance = Math.abs(TERM_OPTIONS[closestIndex].months - termMonths);
    const optionDistance = Math.abs(option.months - termMonths);
    return optionDistance < closestDistance ? index : closestIndex;
  }, 0);
}

function formatTermLabel(months: number): string {
  const years = months / 12;
  if (Number.isInteger(years)) return `${years} Year${years === 1 ? '' : 's'}`;
  return `${months} Months`;
}

// Walk each month of the term, growing storage per the chosen growth assumption, and accumulate the
// resulting B2 revenue. Returns first-year revenue (ARR), full-term revenue (TCV), the cumulative
// TB-months of storage modeled, and the ending storage volume — all driven off the same per-month walk
// so the deal-summary copy and the on-screen rows can never disagree.
function getProjectedRevenueProfile({
  baseStorageGb,
  baseNonStorageRevenue,
  pricePerTb,
  termMonths,
  growthMode,
  growthRatePercent,
  growthFixedTbPerMonth,
}: {
  baseStorageGb: number;
  baseNonStorageRevenue: number;
  pricePerTb: number;
  termMonths: number;
  growthMode: EgressConfig['dataGrowthMode'];
  growthRatePercent: number;
  growthFixedTbPerMonth: number;
}): { firstYearRevenue: number; termRevenue: number; modeledStorageTbMonths: number; endingStorageGb: number } {
  const monthCount = Math.max(1, Math.round(termMonths));
  let firstYearRevenue = 0;
  let termRevenue = 0;
  let modeledStorageTbMonths = 0;
  let endingStorageGb = baseStorageGb;

  for (let month = 1; month <= monthCount; month++) {
    const projectedStorageGb = projectStorageGbForMonth({
      baseStorageGb,
      fixedGrowthTbPerMonth: growthFixedTbPerMonth,
      annualGrowthPercent: growthRatePercent,
      growthMode,
      month,
    });
    const storageRevenue = (projectedStorageGb / 1000) * pricePerTb;
    // Scale the non-storage revenue with storage volume so it grows alongside the data; if there's no
    // base storage to scale against, hold it flat rather than dividing by zero.
    const nonStorageRevenue = baseStorageGb > 0
      ? baseNonStorageRevenue * (projectedStorageGb / baseStorageGb)
      : baseNonStorageRevenue;
    const monthlyRevenue = storageRevenue + nonStorageRevenue;

    modeledStorageTbMonths += projectedStorageGb / 1000;
    endingStorageGb = projectedStorageGb;
    if (month <= 12) firstYearRevenue += monthlyRevenue;
    termRevenue += monthlyRevenue;
  }

  return {
    firstYearRevenue,
    termRevenue,
    modeledStorageTbMonths,
    endingStorageGb,
  };
}

/** Read-only reference card showing the selected tier's throughput/RPS ceiling, sourced from
 *  b2.json — not computed from bill data, since nothing in a parsed bill implies required
 *  throughput. Purely contextual for the AE, mirroring the UDM detail panel's visual treatment. */
function ServiceTierSpecCard({ tier }: { tier: B2ServiceTier }) {
  const spec = getServiceTierSpec(tier);
  return (
    <div className="mt-2 bg-c-red-soft rounded-xl p-2.5 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-c-red-dark font-medium">{spec.label} throughput</span>
        <span className="font-semibold text-c-text">
          {spec.throughputGbitPut} Gbit/s PUT / {spec.throughputGbitGet} Gbit/s GET
        </span>
      </div>
      <div className="flex items-center justify-between text-xs border-t border-[#e20626]/20 pt-2">
        <span className="text-c-red-dark font-medium">RPS ceiling</span>
        <span className="font-semibold text-c-text">
          {spec.rpsPut === null
            ? 'Scales with throughput'
            : `${spec.rpsPut.toLocaleString()} PUT / ${spec.rpsGet!.toLocaleString()} GET`}
        </span>
      </div>
      {tier === 'overdrive' && (
        <p className="text-xs text-c-subtle">
          Unlimited free egress, zero API transaction fees. {spec.minimumCommitmentNote}. Pricing is usually custom-negotiated — the suggested ${spec.startingPerTbMonth}/TB above is a starting point only.
        </p>
      )}
    </div>
  );
}

function PresetButton({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    // Preset chip: active = brand-red outline on soft-red fill with red text; inactive = neutral surface.
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
        active
          ? 'border-[#e20626] bg-c-red-soft text-c-red'
          : 'border-c-border2 bg-c-surface text-c-muted hover:border-c-border hover:bg-c-surface2'
      }`}
    >
      <span className="block text-xs font-semibold leading-tight">{label}</span>
      <span className="block text-[10px] leading-tight opacity-75">{detail}</span>
    </button>
  );
}

function RevenueSummaryRow({
  label,
  rate,
  arr,
  tcv,
  active = false,
}: {
  label: string;
  rate: string;
  arr: number;
  tcv: number;
  active?: boolean;
}) {
  return (
    // The active (current-deal) row gets the navy "deal result" band with white text and font-display
    // numbers; other rows sit on the plain surface. Dividers use the standard border token.
    <div className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-c-border px-2.5 py-2 text-xs first:border-t-0 ${active ? 'bg-[#000033]' : 'bg-c-surface'}`}>
      <div>
        <p className={`font-medium ${active ? 'text-white' : 'text-c-text'}`}>{label}</p>
        <p className={`text-[11px] ${active ? 'text-white/60' : 'text-c-subtle'}`}>{rate}</p>
      </div>
      <div className="text-right">
        <p className={`text-[10px] font-semibold uppercase tracking-wide ${active ? 'text-white/60' : 'text-c-subtle'}`}>ARR</p>
        <p className={`font-display font-semibold ${active ? 'text-white' : 'text-c-text'}`}>{formatCurrency(arr)}</p>
      </div>
      <div className="text-right">
        <p className={`text-[10px] font-semibold uppercase tracking-wide ${active ? 'text-white/60' : 'text-c-subtle'}`}>TCV</p>
        <p className={`font-display font-semibold ${active ? 'text-white' : 'text-c-text'}`}>{formatCurrency(tcv)}</p>
      </div>
    </div>
  );
}
