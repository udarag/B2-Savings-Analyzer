'use client';

import { useState } from 'react';
import type { B2UsageInput, TargetB2ServiceTier } from '@/types/analysis';
import { B2UsageScreenshotUpload } from './B2UsageScreenshotUpload';

interface B2UsageFormProps {
  analysisId: string;
  onSaved: () => void;
  /** Pre-fills the form for editing an already-saved usage record; omitted for first-time entry. */
  initialValue?: B2UsageInput;
  submitLabel?: string;
}

/**
 * Manual-entry form for the commit-upsell flow: an existing B2 Uncommitted customer with no
 * source-cloud bill to parse. Collects just what the throughput-upgrade pitch needs — current
 * usage/spend, a growth assumption (reusing the same vocabulary as the migration flow's growth
 * control), and which tier the AE is pitching toward.
 */
export function B2UsageForm({ analysisId, onSaved, initialValue, submitLabel }: B2UsageFormProps) {
  const [currentStorageTb, setCurrentStorageTb] = useState(initialValue ? String(initialValue.currentStorageTb) : '');
  const [currentMonthlySpendUsd, setCurrentMonthlySpendUsd] = useState(initialValue ? String(initialValue.currentMonthlySpendUsd) : '');
  const [growthMode, setGrowthMode] = useState<'percent' | 'fixed-tb'>(initialValue?.dataGrowthMode ?? 'percent');
  const [growthRatePercent, setGrowthRatePercent] = useState(initialValue ? String(initialValue.dataGrowthRatePercent) : '10');
  const [growthFixedTbPerMonth, setGrowthFixedTbPerMonth] = useState(initialValue ? String(initialValue.dataGrowthFixedTbPerMonth) : '0');
  const [targetTier, setTargetTier] = useState<TargetB2ServiceTier>(initialValue?.targetTier ?? 'committed');
  const [committedDiscountPercent, setCommittedDiscountPercent] = useState(initialValue ? String(initialValue.committedDiscountPercent) : '0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!currentStorageTb || Number(currentStorageTb) <= 0) {
      setError('Enter the customer’s current storage volume.');
      return;
    }
    if (!currentMonthlySpendUsd || Number(currentMonthlySpendUsd) <= 0) {
      setError('Enter the customer’s current monthly B2 spend.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/analyses/${analysisId}/b2-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentStorageTb: Number(currentStorageTb),
          currentMonthlySpendUsd: Number(currentMonthlySpendUsd),
          dataGrowthMode: growthMode,
          dataGrowthRatePercent: Number(growthRatePercent) || 0,
          dataGrowthFixedTbPerMonth: Number(growthFixedTbPerMonth) || 0,
          targetTier,
          committedDiscountPercent: Number(committedDiscountPercent) || 0,
        }),
      });
      if (!res.ok) throw new Error('Failed to save usage');
      onSaved();
    } catch {
      setError('Failed to save usage. Check B2 connection.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <FieldCard label="Current storage" hint="TB">
          <input
            type="number"
            min={0}
            step={0.1}
            value={currentStorageTb}
            onChange={(e) => setCurrentStorageTb(e.target.value)}
            placeholder="e.g. 120"
            className="w-full rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm font-medium text-c-text outline-none focus:border-c-red"
          />
        </FieldCard>
        <FieldCard label="Current monthly B2 spend" hint="USD">
          <input
            type="number"
            min={0}
            step={1}
            value={currentMonthlySpendUsd}
            onChange={(e) => setCurrentMonthlySpendUsd(e.target.value)}
            placeholder="e.g. 850"
            className="w-full rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm font-medium text-c-text outline-none focus:border-c-red"
          />
        </FieldCard>
      </div>

      <FieldCard label="Growth assumption">
        <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-lg bg-c-surface2 p-1">
          <button
            type="button"
            onClick={() => setGrowthMode('percent')}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              growthMode === 'percent' ? 'bg-[#e20626] text-white' : 'text-c-muted hover:text-c-text'
            }`}
          >
            % Growth
          </button>
          <button
            type="button"
            onClick={() => setGrowthMode('fixed-tb')}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              growthMode === 'fixed-tb' ? 'bg-[#e20626] text-white' : 'text-c-muted hover:text-c-text'
            }`}
          >
            Fixed TB/Month
          </button>
        </div>
        {growthMode === 'percent' ? (
          <input
            type="number"
            min={0}
            step={1}
            value={growthRatePercent}
            onChange={(e) => setGrowthRatePercent(e.target.value)}
            placeholder="Annual growth %"
            className="w-full rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm font-medium text-c-text outline-none focus:border-c-red"
          />
        ) : (
          <input
            type="number"
            min={0}
            step={0.1}
            value={growthFixedTbPerMonth}
            onChange={(e) => setGrowthFixedTbPerMonth(e.target.value)}
            placeholder="Added TB per month"
            className="w-full rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm font-medium text-c-text outline-none focus:border-c-red"
          />
        )}
      </FieldCard>

      <FieldCard label="Target service tier">
        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-c-surface2 p-1">
          <button
            type="button"
            onClick={() => setTargetTier('committed')}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              targetTier === 'committed' ? 'bg-[#e20626] text-white' : 'text-c-muted hover:text-c-text'
            }`}
          >
            Committed
          </button>
          <button
            type="button"
            onClick={() => setTargetTier('overdrive')}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              targetTier === 'overdrive' ? 'bg-[#e20626] text-white' : 'text-c-muted hover:text-c-text'
            }`}
          >
            Overdrive
          </button>
        </div>
        {targetTier === 'committed' && (
          <div className="mt-3">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-c-subtle">
              Negotiated discount off current rate (optional)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={committedDiscountPercent}
              onChange={(e) => setCommittedDiscountPercent(e.target.value)}
              placeholder="0"
              className="w-full rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm font-medium text-c-text outline-none focus:border-c-red"
            />
          </div>
        )}
      </FieldCard>

      <B2UsageScreenshotUpload
        analysisId={analysisId}
        onParsed={(parsed) => {
          // Pre-fill from the screenshot; AE reviews/edits before saving. Growth may be omitted.
          setCurrentStorageTb(String(parsed.currentStorageTb));
          setCurrentMonthlySpendUsd(String(parsed.currentMonthlySpendUsd));
          if (parsed.dataGrowthMode) setGrowthMode(parsed.dataGrowthMode);
          if (parsed.dataGrowthRatePercent != null) setGrowthRatePercent(String(parsed.dataGrowthRatePercent));
        }}
      />

      {error && <p className="text-sm text-c-red">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-[10px] bg-[#e20626] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-[#b40a23] disabled:opacity-50"
        >
          {saving ? 'Saving…' : submitLabel ?? 'Save usage →'}
        </button>
      </div>
    </div>
  );
}

/** A labeled surface card wrapping a single form control or value — mirrors the New Opportunity page's FieldCard. */
function FieldCard({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-c-border bg-c-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-semibold text-c-muted">{label}</label>
        {hint && <span className="text-[11px] text-c-subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
