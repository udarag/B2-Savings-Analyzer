'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Analysis, B2UsageInput } from '@/types/analysis';
import { computeCommitUpsellView, type CommitUpsellView } from '@/lib/analysis/commit-upsell-model';
import { COMMIT_UPSELL_ANGLES, getCommitUpsellAngle, CUSTOM_ANGLE_ID } from '@/lib/analysis/commit-upsell-angles';
import type { ServiceTierSpec } from '@/lib/pricing/service-levels';
import { B2UsageForm } from '@/components/upload/B2UsageForm';
import { InlineEditText } from '@/components/shared/InlineEditText';
import { formatCurrency } from '@/components/shared/FormatCurrency';

interface CommitUpsellDashboardProps {
  analysisId: string;
  meta: Analysis;
}

/**
 * Deal-sizing page for a commit-upsell opportunity: an existing B2 Uncommitted customer with no
 * source-cloud bill. The usage step captures current storage/spend; here the AE sizes the deal —
 * growth and the Committed rate they're offering to land the commitment — and sees the
 * current-vs-Committed comparison update live before generating the customer report. Edits autosave.
 *
 * The internal/customer wall lives on this page: the deal-sizing levers (especially the discount) are
 * fenced off in an unmistakably-internal card so they can't be screen-shared to the customer, while
 * the comparison card is an explicit "what the customer sees" twin of the customer report (surface F).
 */
export function CommitUpsellDashboard({ analysisId, meta: initialMeta }: CommitUpsellDashboardProps) {
  // Hold meta locally so an inline company-name edit reflects immediately (and carries into the
  // customer report, which heads with `companyName || prospectName`).
  const [meta, setMeta] = useState(initialMeta);
  const [usage, setUsage] = useState<B2UsageInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingUsage, setEditingUsage] = useState(false);
  // The Committed rate can be expressed two ways: a discount % off today's rate, or a directly-typed
  // custom $/TB. Both resolve to the same stored `committedDiscountPercent`, so the mode is UI-only.
  const [rateMode, setRateMode] = useState<'percent' | 'custom'>('percent');
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

  // Persist a meta edit (the customer-facing company name) and reflect it locally right away.
  const patchMeta = useCallback(async (fields: Partial<Analysis>) => {
    setMeta((prev) => ({ ...prev, ...fields }));
    await fetch(`/api/analyses/${analysisId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: fields }),
    });
  }, [analysisId]);

  const view = usage ? computeCommitUpsellView(usage) : null;

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-16 pt-7 sm:px-6 sm:pt-8">
      <div className="mb-3.5 flex items-center gap-2 text-[13px] text-c-subtle">
        <Link href="/" className="font-medium text-c-muted transition-colors hover:text-c-text">Opportunities</Link>
        <span>/</span>
        <span className="truncate font-semibold text-c-text">{meta.prospectName}</span>
      </div>
      <h1 className="mb-1 text-2xl font-semibold text-c-text">{meta.prospectName}</h1>
      <p className="mb-3 text-c-muted">B2 commitment upgrade — size the deal, then generate the report.</p>
      {/* Customer-facing company name. The report/PDF head with `companyName || prospectName`, so
          without this an internal opportunity name (e.g. "Acme — Q3 upsell") leaks onto the customer
          deliverable. Seeded blank (never with prospectName) so an unset name reads as a clear prompt
          instead of masquerading as a real company. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className="text-xs font-semibold uppercase tracking-wide text-c-subtle">Company (shown to the customer)</span>
        <span className="font-medium text-c-muted">
          <InlineEditText
            value={meta.companyName || ''}
            onSave={(companyName) => patchMeta({ companyName } as Partial<Analysis>)}
            placeholder="+ Add company name"
            maxLength={100}
          />
        </span>
      </div>

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

            {/* Deal sizing — the AE's levers. Fenced off as unmistakably internal so it can't be
                screen-shared by accident: dashed amber border + a hatched "not shown to the customer"
                banner with a lock. Edits recompute live and autosave. */}
            <div className="overflow-hidden rounded-2xl border-2 border-dashed border-c-amber/60 bg-c-amber-soft/40">
              <div
                className="flex items-center gap-2 px-4 py-2.5"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(180,83,9,0.16), rgba(180,83,9,0.16) 9px, transparent 9px, transparent 18px)' }}
              >
                <LockIcon />
                <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-c-amber">Internal only — not shown to the customer</span>
              </div>
              <div className="space-y-4 p-5">
                <h4 className="text-sm font-bold text-c-text">Size the deal</h4>

                {/* Growth assumption */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-c-muted">Data growth</label>
                  <Segmented
                    tone="amber"
                    className="mb-2"
                    options={[{ value: 'percent', label: '% Growth' }, { value: 'fixed-tb', label: 'Fixed TB/Month' }]}
                    value={usage.dataGrowthMode}
                    onChange={(v) => updateUsage({ dataGrowthMode: v as B2UsageInput['dataGrowthMode'] })}
                  />
                  {usage.dataGrowthMode === 'percent' ? (
                    <NumberField tone="amber" value={usage.dataGrowthRatePercent} suffix="%/yr" onChange={(n) => updateUsage({ dataGrowthRatePercent: n })} />
                  ) : (
                    <NumberField tone="amber" value={usage.dataGrowthFixedTbPerMonth} suffix="TB/mo" step={0.1} onChange={(n) => updateUsage({ dataGrowthFixedTbPerMonth: n })} />
                  )}
                </div>

                {/* Contract term — the length the deal is sized for. Drives the projection/TCV and is
                    named on the customer report so "signing a contract" states what they commit to. */}
                <div className="border-t border-dashed border-c-amber/50 pt-4">
                  <label className="mb-2 block text-xs font-medium text-c-muted">Contract term</label>
                  <Segmented
                    tone="amber"
                    options={[
                      { value: '12', label: '1 yr' },
                      { value: '24', label: '2 yr' },
                      { value: '36', label: '3 yr' },
                      { value: '60', label: '5 yr' },
                    ]}
                    value={String(usage.contractTermMonths ?? 12)}
                    onChange={(v) => updateUsage({ contractTermMonths: Number(v) })}
                  />
                </div>

                {/* Committed rate — the one lever the customer must never see. Flips between a discount
                    % off today's rate and a directly-typed custom $/TB (matching the migration
                    builder's Custom preset); both resolve to the same stored discount. */}
                <div className="border-t border-dashed border-c-amber/50 pt-4">
                  <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-c-amber">
                    Committed rate
                    <span className="rounded border border-c-amber/50 bg-c-surface px-1.5 py-px text-[10px] font-bold text-c-amber">AE lever</span>
                  </label>
                  <Segmented
                    tone="amber"
                    className="mb-2"
                    options={[{ value: 'percent', label: '% off current' }, { value: 'custom', label: 'Custom $/TB' }]}
                    value={rateMode}
                    onChange={(v) => setRateMode(v as 'percent' | 'custom')}
                  />
                  {rateMode === 'percent' ? (
                    <NumberField
                      tone="amber"
                      value={usage.committedDiscountPercent}
                      suffix="% off"
                      max={100}
                      onChange={(n) => updateUsage({ committedDiscountPercent: Math.min(Math.max(n, 0), 100) })}
                    />
                  ) : (
                    <NumberField
                      tone="amber"
                      prefix="$"
                      value={view.targetRatePerTb}
                      suffix="/TB"
                      step={0.01}
                      onChange={(rate) => updateUsage({ committedDiscountPercent: discountFromCustomRate(rate, view.currentRatePerTb) })}
                    />
                  )}
                  <p className="mt-2 text-xs text-c-amber">
                    Committed rate lands at <span className="font-semibold text-c-text">{formatCurrency(view.targetRatePerTb)}/TB</span>
                    {' '}· <span className="font-semibold text-c-text">{formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo</span> at today&apos;s volume.
                    {' '}The customer report shows the resulting rate only — never the discount.
                  </p>
                </div>
              </div>
            </div>

            {/* What the customer sees — the internal twin of the report's comparison table (surface F):
                same navy header, split PUT/GET rows, and the growth row the report also carries. */}
            <ComparisonCard view={view} analysisId={analysisId} />

            {/* Report messaging angle — the "why it matters" points on the customer report follow this
                choice, so the AE can dial the pitch to the account's workload. It changes framing only,
                never the modeled numbers, and (unlike the discount) is safe for the customer to see. */}
            <MessagingAnglePicker
              value={usage.messagingAngle}
              customPoints={usage.customAnglePoints}
              onChange={(id) => updateUsage({ messagingAngle: id })}
              onCustomPointsChange={(points) => updateUsage({ customAnglePoints: points })}
            />

            <div className="flex justify-end gap-2.5">
              <Link
                href={`/analyses/${analysisId}/report`}
                className="inline-flex items-center gap-2 rounded-[10px] bg-c-brand px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-c-brand-hover"
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

// Convert a directly-typed custom $/TB rate back into the stored discount % off today's rate, so the
// "Custom $/TB" mode needs no schema change and the customer report still renders the resulting rate.
function discountFromCustomRate(rate: number, currentRate: number): number {
  if (currentRate <= 0) return 0;
  const pct = (1 - rate / currentRate) * 100;
  return Math.min(Math.max(Math.round(pct * 100) / 100, 0), 100);
}

// Paired PUT / GET throughput, e.g. "50 / 50 Gbit/s" (rolls to Tbps at ≥1000) — matches the report.
function bandwidthPair(spec: ServiceTierSpec): string {
  const rollsToTbps = spec.throughputGbitPut >= 1000 || spec.throughputGbitGet >= 1000;
  const fmt = (n: number) => (rollsToTbps ? (n / 1000).toLocaleString() : n.toLocaleString());
  return `${fmt(spec.throughputGbitPut)} / ${fmt(spec.throughputGbitGet)} ${rollsToTbps ? 'Tbps' : 'Gbit/s'}`;
}
function rpsPair(spec: ServiceTierSpec): string {
  if (spec.rpsPut === null || spec.rpsGet === null) return 'Scales with throughput';
  return `${spec.rpsPut.toLocaleString()} / ${spec.rpsGet.toLocaleString()}`;
}

function ComparisonCard({ view, analysisId }: { view: CommitUpsellView; analysisId: string }) {
  const rows: { label: string; current: string; target: string; emphasis?: 'purple' }[] = [
    { label: 'Storage rate', current: `${formatCurrency(view.currentRatePerTb)}/TB`, target: `${formatCurrency(view.targetRatePerTb)}/TB`, emphasis: 'purple' },
    { label: 'Bandwidth PUT / GET', current: bandwidthPair(view.currentSpec), target: bandwidthPair(view.targetSpec) },
    { label: 'Requests/sec PUT / GET', current: rpsPair(view.currentSpec), target: rpsPair(view.targetSpec) },
    { label: 'Modeled growth', current: '—', target: view.growthLabel },
    { label: 'Est. monthly', current: `${formatCurrency(view.currentMonthlyCostUsd)}/mo`, target: `${formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo` },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-c-border bg-c-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-c-border px-4 py-3">
        <p className="text-xs font-bold text-c-text">What the customer sees</p>
        <Link href={`/analyses/${analysisId}/report`} className="text-[10.5px] font-semibold text-c-purple hover:underline">Preview report →</Link>
      </div>
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-c-border text-sm">
        <HeadCell>Specification</HeadCell>
        <HeadCell>Today</HeadCell>
        <HeadCell tone="navy">With {view.targetSpec.customerLabel}</HeadCell>
        {rows.map((row) => (
          <RowCells key={row.label} {...row} />
        ))}
      </div>
    </div>
  );
}

function HeadCell({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'navy' }) {
  return (
    <div className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide ${tone === 'navy' ? 'bg-c-nav text-white' : 'bg-c-surface2 text-c-subtle'}`}>
      {children}
    </div>
  );
}
function RowCells({ label, current, target, emphasis }: { label: string; current: string; target: string; emphasis?: 'purple' }) {
  return (
    <>
      <div className="bg-c-surface px-4 py-3 text-xs font-medium text-c-muted">{label}</div>
      <div className="bg-c-surface px-4 py-3 text-sm text-c-subtle">{current}</div>
      <div className={`px-4 py-3 text-sm font-semibold ${emphasis === 'purple' ? 'bg-c-purple-soft text-c-purple' : 'bg-c-red-soft/40 text-c-text'}`}>{target}</div>
    </>
  );
}

/**
 * Lets the AE pick which "why it matters" framing the customer report leads with, matched to the
 * account's workload (AI/ML, media, backup/DR, application storage) — or write their own via the
 * Custom angle. Customer-facing copy, not a hidden lever, so it lives outside the internal amber wall.
 * Presets live-preview their three points; Custom swaps the preview for three editable rows. Autosaves.
 */
function MessagingAnglePicker({
  value,
  customPoints,
  onChange,
  onCustomPointsChange,
}: {
  value?: string;
  customPoints?: { title: string; body: string }[];
  onChange: (id: string) => void;
  onCustomPointsChange: (points: { title: string; body: string }[]) => void;
}) {
  const active = getCommitUpsellAngle(value);
  const isCustom = active.id === CUSTOM_ANGLE_ID;
  // Custom is always edited as exactly three rows; a single-row edit rewrites the full trio.
  const rows = [0, 1, 2].map((i) => customPoints?.[i] ?? { title: '', body: '' });
  const placeholders = getCommitUpsellAngle(CUSTOM_ANGLE_ID).points;
  const updateRow = (index: number, patch: Partial<{ title: string; body: string }>) => {
    onCustomPointsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="rounded-2xl border border-c-border bg-c-surface p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-c-text">Report messaging angle</p>
        <span className="rounded-full bg-c-surface2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-c-subtle">Customer-facing copy</span>
      </div>
      <p className="mb-3 text-xs text-c-subtle">
        Tailor the report&apos;s &ldquo;why it matters&rdquo; points to this customer&apos;s workload. The throughput numbers don&apos;t change — only the framing. <span className="text-c-muted">{active.hint}</span>
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {COMMIT_UPSELL_ANGLES.map((angle) => {
          const isActive = active.id === angle.id;
          return (
            <button
              key={angle.id}
              type="button"
              onClick={() => onChange(angle.id)}
              aria-pressed={isActive}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${isActive ? 'bg-c-brand text-white' : 'bg-c-surface2 text-c-muted hover:text-c-text'}`}
            >
              {angle.label}
            </button>
          );
        })}
      </div>

      {isCustom ? (
        // Editable trio — the AE writes their own points; blanks are dropped from the report.
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="rounded-lg border border-c-border2 bg-c-bg px-3 py-2 focus-within:border-c-red">
              <input
                type="text"
                value={row.title}
                maxLength={40}
                onChange={(e) => updateRow(i, { title: e.target.value })}
                placeholder={`Point ${i + 1} — e.g. ${placeholders[i].title}`}
                className="w-full bg-transparent text-[12px] font-bold text-c-text outline-none placeholder:font-medium placeholder:text-c-subtle"
              />
              <input
                type="text"
                value={row.body}
                maxLength={120}
                onChange={(e) => updateRow(i, { body: e.target.value })}
                placeholder={`e.g. ${placeholders[i].body}`}
                className="mt-0.5 w-full bg-transparent text-[11px] text-c-muted outline-none placeholder:text-c-subtle"
              />
            </div>
          ))}
          <p className="text-[10.5px] text-c-subtle">Keep it capability-focused — no dollar figures. Blank points are dropped from the report.</p>
        </div>
      ) : (
        // Live preview of what the report will show for the selected preset.
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
          {active.points.map((p) => (
            <div key={p.title} className="rounded-lg border border-c-border bg-c-bg px-3 py-2">
              <p className="text-[11.5px] font-bold text-c-text">{p.title}</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-c-muted">{p.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
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

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0 text-c-amber" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function Segmented({ options, value, onChange, className = '', tone = 'red' }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  tone?: 'red' | 'amber';
}) {
  const activeCls = tone === 'amber' ? 'bg-c-amber text-white' : 'bg-c-brand text-white hover:bg-c-brand-hover';
  const inactiveCls = tone === 'amber' ? 'text-c-amber hover:text-c-text' : 'text-c-muted hover:text-c-text';
  return (
    <div className={`grid gap-1 rounded-lg p-1 ${tone === 'amber' ? 'bg-c-amber-soft' : 'bg-c-surface2'} ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${value === opt.value ? activeCls : inactiveCls}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({ value, onChange, suffix, prefix, step = 1, max, tone = 'red' }: {
  value: number;
  onChange: (n: number) => void;
  suffix: string;
  prefix?: string;
  step?: number;
  max?: number;
  tone?: 'red' | 'amber';
}) {
  const chrome = tone === 'amber'
    ? 'border-c-amber/50 focus-within:border-c-amber focus-within:ring-c-amber-soft'
    : 'border-c-border2 focus-within:border-c-brand focus-within:ring-c-red-soft';
  return (
    <div className={`flex items-center rounded-lg border bg-c-surface focus-within:ring-2 ${chrome}`}>
      {prefix && <span className="pl-3 text-sm font-semibold text-c-subtle">{prefix}</span>}
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
