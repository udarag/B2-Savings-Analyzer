'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Analysis, B2UsageInput, TargetB2ServiceTier } from '@/types/analysis';
import { computeCommitUpsellView, type CommitUpsellView } from '@/lib/analysis/commit-upsell-model';
import type { ServiceTierSpec } from '@/lib/pricing/service-levels';
import { B2UsageForm } from '@/components/upload/B2UsageForm';
import { formatCurrency } from '@/components/shared/FormatCurrency';

interface CommitUpsellDashboardProps {
  analysisId: string;
  meta: Analysis;
}

/**
 * Deal-sizing page for a commit-upsell opportunity: an existing B2 Uncommitted customer with no
 * source-cloud bill. The usage step captures current storage/spend; here the AE sizes the deal —
 * growth, target tier, and the contract discount they're offering to land the commitment — and sees
 * the current-vs-target comparison update live before generating the customer report. Edits autosave.
 */
export function CommitUpsellDashboard({ analysisId, meta }: CommitUpsellDashboardProps) {
  const [usage, setUsage] = useState<B2UsageInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingUsage, setEditingUsage] = useState(false);
  const skipNextSave = useRef(true);

  // State writes stay inside the async callbacks (not the synchronous body) so this is safe to call
  // straight from the mount effect — `loading` already starts true, so no synchronous reset is needed.
  const load = useCallback(() => {
    skipNextSave.current = true; // a fresh load isn't a user edit — don't echo it back
    fetch(`/api/analyses/${analysisId}`)
      .then((r) => r.json())
      .then((d) => setUsage(d.b2Usage ?? null))
      .finally(() => setLoading(false));
  }, [analysisId]);

  useEffect(() => { load(); }, [load]);

  // Debounced autosave: any deal-sizing edit persists the full usage record ~0.8s later, so the
  // report always reflects the latest deal without an explicit save.
  useEffect(() => {
    if (!usage) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    const timer = setTimeout(() => {
      void fetch(`/api/analyses/${analysisId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b2Usage: usage }),
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [usage, analysisId]);

  const updateUsage = useCallback((patch: Partial<B2UsageInput>) => {
    setUsage((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const view = usage ? computeCommitUpsellView(usage) : null;

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-16 pt-7 sm:px-6 sm:pt-8">
      <div className="mb-3.5 flex items-center gap-2 text-[13px] text-c-subtle">
        <Link href="/" className="font-medium text-c-muted transition-colors hover:text-c-text">Opportunities</Link>
        <span>/</span>
        <span className="truncate font-semibold text-c-text">{meta.prospectName}</span>
      </div>
      <h1 className="mb-1 text-2xl font-semibold text-c-text">{meta.prospectName}</h1>
      <p className="mb-6 text-c-muted">B2 commitment upgrade — size the deal, then generate the report.</p>

      {loading ? (
        <p className="text-sm text-c-muted">Loading…</p>
      ) : !usage || editingUsage ? (
        <B2UsageForm
          analysisId={analysisId}
          initialValue={usage ?? undefined}
          submitLabel={usage ? 'Save changes →' : 'Continue to deal sizing →'}
          onSaved={() => { setEditingUsage(false); setLoading(true); load(); }}
        />
      ) : (
        view && (
          <div className="space-y-4">
            {/* Current usage — the facts captured in the usage step. */}
            <div className="rounded-2xl border border-c-border bg-c-surface p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-c-text">Current usage — Pay-as-you-go</p>
                <button
                  type="button"
                  onClick={() => setEditingUsage(true)}
                  className="text-xs font-semibold text-c-red hover:text-c-red-dark"
                >
                  Edit usage
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <Stat label="Stored" value={`${usage.currentStorageTb.toLocaleString()} TB`} />
                <Stat label="Monthly spend" value={`${formatCurrency(view.currentMonthlyCostUsd)}/mo`} />
                <Stat label="Effective rate" value={`${formatCurrency(view.currentRatePerTb)}/TB`} />
              </div>
            </div>

            {/* Deal sizing — the AE's levers. Edits recompute live and autosave. */}
            <div className="rounded-2xl border border-c-border bg-c-surface shadow-sm overflow-hidden">
              <div className="border-b border-c-border border-l-[3px] border-l-[#e20626] px-5 py-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-c-text">Size the deal</h4>
                  <span className="rounded-full bg-c-amber-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-c-amber">Internal</span>
                </div>
                <p className="mt-1 text-xs text-c-subtle">Growth, target tier, and any contract discount.</p>
              </div>
              <div className="space-y-4 p-5">
                {/* Target tier */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-c-muted">Target service tier</label>
                  <Segmented
                    options={[{ value: 'committed', label: 'Committed' }, { value: 'overdrive', label: 'Overdrive' }]}
                    value={usage.targetTier}
                    onChange={(v) => updateUsage({ targetTier: v as TargetB2ServiceTier })}
                  />
                </div>

                {/* Growth assumption */}
                <div className="border-t border-c-border pt-4">
                  <label className="mb-2 block text-xs font-medium text-c-muted">Data growth</label>
                  <Segmented
                    className="mb-2"
                    options={[{ value: 'percent', label: '% Growth' }, { value: 'fixed-tb', label: 'Fixed TB/Month' }]}
                    value={usage.dataGrowthMode}
                    onChange={(v) => updateUsage({ dataGrowthMode: v as B2UsageInput['dataGrowthMode'] })}
                  />
                  {usage.dataGrowthMode === 'percent' ? (
                    <NumberField
                      value={usage.dataGrowthRatePercent}
                      suffix="%/yr"
                      onChange={(n) => updateUsage({ dataGrowthRatePercent: n })}
                    />
                  ) : (
                    <NumberField
                      value={usage.dataGrowthFixedTbPerMonth}
                      suffix="TB/mo"
                      step={0.1}
                      onChange={(n) => updateUsage({ dataGrowthFixedTbPerMonth: n })}
                    />
                  )}
                </div>

                {/* Discount (Committed) / custom-pricing note (Overdrive) */}
                <div className="border-t border-c-border pt-4">
                  {usage.targetTier === 'committed' ? (
                    <>
                      <label className="mb-2 block text-xs font-medium text-c-muted">Contract discount off current rate</label>
                      <NumberField
                        value={usage.committedDiscountPercent}
                        suffix="% off"
                        max={100}
                        onChange={(n) => updateUsage({ committedDiscountPercent: Math.min(Math.max(n, 0), 100) })}
                      />
                      <p className="mt-2 text-xs text-c-subtle">
                        Committed rate: <span className="font-semibold text-c-text">{formatCurrency(view.targetRatePerTb)}/TB</span>
                        {' '}· <span className="font-semibold text-c-text">{formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo</span> at today&apos;s volume
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-c-subtle">
                      Overdrive is custom-priced from ${view.targetSpec.startingPerTbMonth}/TB — modeled at{' '}
                      <span className="font-semibold text-c-text">{formatCurrency(view.targetRatePerTb)}/TB</span>
                      {' '}· <span className="font-semibold text-c-text">{formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo</span>. {view.targetSpec.minimumCommitmentNote}.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* What they gain — current vs target across price, bandwidth, RPS, egress, cost. */}
            <ComparisonCard view={view} />

            <div className="flex justify-end gap-2.5">
              <Link
                href={`/analyses/${analysisId}/report`}
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#e20626] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-[#b40a23]"
              >
                Customer report
              </Link>
              <a
                href={`/api/analyses/${analysisId}/pdf`}
                className="inline-flex items-center gap-2 rounded-[10px] border border-c-border2 bg-c-surface px-4 py-2.5 text-[13px] font-semibold text-c-muted transition-colors hover:bg-c-surface2"
              >
                PDF
              </a>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function formatBandwidth(gbit: number): string {
  return gbit >= 1000 ? `${(gbit / 1000).toLocaleString()} Tbps` : `${gbit.toLocaleString()} Gbit/s`;
}

function ComparisonCard({ view }: { view: CommitUpsellView }) {
  const rows: { label: string; current: string; target: string }[] = [
    { label: 'Storage rate', current: `${formatCurrency(view.currentRatePerTb)}/TB`, target: `${formatCurrency(view.targetRatePerTb)}/TB` },
    { label: 'Bandwidth (PUT/GET)', current: bandwidthLabel(view.currentSpec), target: bandwidthLabel(view.targetSpec) },
    { label: 'Requests/sec (PUT/GET)', current: rpsLabel(view.currentSpec), target: rpsLabel(view.targetSpec) },
    { label: 'Included egress', current: view.currentSpec.unlimitedEgress ? 'Unlimited' : '3× stored data', target: view.targetSpec.unlimitedEgress ? 'Unlimited' : '3× stored data' },
    { label: 'Est. monthly', current: `${formatCurrency(view.currentMonthlyCostUsd)}/mo`, target: `${formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo` },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-c-border bg-c-surface shadow-sm">
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-c-border text-sm">
        <HeadCell>What they get</HeadCell>
        <HeadCell>Today · Pay-as-you-go</HeadCell>
        <HeadCell highlight>With {view.targetSpec.customerLabel}</HeadCell>
        {rows.map((row) => (
          <RowCells key={row.label} {...row} />
        ))}
      </div>
    </div>
  );
}

function bandwidthLabel(spec: ServiceTierSpec): string {
  const base = `${formatBandwidth(spec.throughputGbitGet)}`;
  return spec.throughputGbitMax ? `${base}, up to ${formatBandwidth(spec.throughputGbitMax)}` : base;
}
function rpsLabel(spec: ServiceTierSpec): string {
  return spec.rpsGet === null ? 'Scales with throughput' : spec.rpsGet.toLocaleString();
}

function HeadCell({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide ${highlight ? 'bg-c-red-soft text-c-red-dark' : 'bg-c-surface2 text-c-subtle'}`}>
      {children}
    </div>
  );
}
function RowCells({ label, current, target }: { label: string; current: string; target: string }) {
  return (
    <>
      <div className="bg-c-surface px-4 py-3 text-xs font-medium text-c-muted">{label}</div>
      <div className="bg-c-surface px-4 py-3 text-sm text-c-text">{current}</div>
      <div className="bg-c-red-soft/40 px-4 py-3 text-sm font-semibold text-c-text">{target}</div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-c-subtle">{label}</p>
      <p className="mt-0.5 font-display text-base font-semibold text-c-text">{value}</p>
    </div>
  );
}

function Segmented({ options, value, onChange, className = '' }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`grid gap-1 rounded-lg bg-c-surface2 p-1 ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
            value === opt.value ? 'bg-[#e20626] text-white hover:bg-[#b40a23]' : 'text-c-muted hover:text-c-text'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({ value, onChange, suffix, step = 1, max }: {
  value: number;
  onChange: (n: number) => void;
  suffix: string;
  step?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center rounded-lg border border-c-border2 bg-c-surface focus-within:border-[#e20626] focus-within:ring-2 focus-within:ring-c-red-soft">
      <input
        type="number"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 font-display text-lg font-semibold text-c-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pr-3 text-xs font-semibold uppercase tracking-wide text-c-subtle">{suffix}</span>
    </div>
  );
}
