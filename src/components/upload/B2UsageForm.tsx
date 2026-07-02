'use client';

import { useState } from 'react';
import type { B2UsageInput } from '@/types/analysis';
import { B2UsageExportUpload } from './B2UsageExportUpload';

interface B2UsageFormProps {
  analysisId: string;
  onSaved: () => void;
  /** Pre-fills the form for editing an already-saved usage record; omitted for first-time entry. */
  initialValue?: B2UsageInput;
  submitLabel?: string;
}

/**
 * Captures an existing B2 customer's *current usage* for the commit-upsell flow — storage and
 * monthly spend, from a Bzadmin usage export or typed in. The deal levers (growth, discount) live on
 * the deal-sizing dashboard, not here; this step is just the facts. Growth parsed from the export
 * (and any prior deal settings when editing) ride along as saved defaults so the deal-sizing page
 * opens with them.
 */
export function B2UsageForm({ analysisId, onSaved, initialValue, submitLabel }: B2UsageFormProps) {
  const [currentStorageTb, setCurrentStorageTb] = useState(initialValue ? String(initialValue.currentStorageTb) : '');
  const [currentMonthlySpendUsd, setCurrentMonthlySpendUsd] = useState(initialValue ? String(initialValue.currentMonthlySpendUsd) : '');
  // Deal-sizing fields aren't edited here — carried through so the saved record stays complete and
  // the deal-sizing page opens with the parsed growth / prior settings.
  const [growthMode, setGrowthMode] = useState<'percent' | 'fixed-tb'>(initialValue?.dataGrowthMode ?? 'percent');
  const [growthRatePercent, setGrowthRatePercent] = useState(initialValue ? initialValue.dataGrowthRatePercent : 10);
  const [growthFixedTbPerMonth] = useState(initialValue ? initialValue.dataGrowthFixedTbPerMonth : 0);
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
          dataGrowthRatePercent: growthRatePercent,
          dataGrowthFixedTbPerMonth: growthFixedTbPerMonth,
          // Deal levers keep their prior/default values; tuned on the deal-sizing dashboard.
          targetTier: 'committed', // commit-upsell always targets Committed
          committedDiscountPercent: initialValue?.committedDiscountPercent ?? 0,
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
      <B2UsageExportUpload
        analysisId={analysisId}
        onParsed={(parsed) => {
          // Pre-fill from the export; AE reviews before saving. Growth rides along to deal sizing.
          setCurrentStorageTb(String(parsed.currentStorageTb));
          setCurrentMonthlySpendUsd(String(parsed.currentMonthlySpendUsd));
          if (parsed.dataGrowthMode) setGrowthMode(parsed.dataGrowthMode);
          if (parsed.dataGrowthRatePercent != null) setGrowthRatePercent(parsed.dataGrowthRatePercent);
        }}
      />

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-c-subtle">
        <span className="h-px flex-1 bg-c-border" />
        always works — enter manually
        <span className="h-px flex-1 bg-c-border" />
      </div>

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
      <p className="text-xs text-c-subtle">Next you&apos;ll size the deal — growth, target tier, and any contract discount.</p>

      {error && <p className="text-sm text-c-red">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-[10px] bg-c-brand px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-c-brand-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : submitLabel ?? 'Continue to deal sizing →'}
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
