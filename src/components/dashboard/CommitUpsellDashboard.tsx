'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Analysis, B2UsageInput } from '@/types/analysis';
import { computeCommitUpsellView } from '@/lib/analysis/commit-upsell-model';
import { B2UsageForm } from '@/components/upload/B2UsageForm';
import { formatCurrency } from '@/components/shared/FormatCurrency';

interface CommitUpsellDashboardProps {
  analysisId: string;
  meta: Analysis;
}

/**
 * Dashboard for a commit-upsell opportunity: an existing B2 Uncommitted customer with no
 * source-cloud bill. Leads with the throughput ceiling the customer would gain, not a dollar
 * savings hero — that story usually doesn't exist here (flat or even higher $/TB on Overdrive).
 */
export function CommitUpsellDashboard({ analysisId, meta }: CommitUpsellDashboardProps) {
  const [usage, setUsage] = useState<B2UsageInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch(`/api/analyses/${analysisId}`)
      .then((r) => r.json())
      .then((d) => setUsage(d.b2Usage ?? null))
      .finally(() => setLoading(false));
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
      <p className="mb-6 text-c-muted">B2 commitment upgrade — existing customer, no source bill.</p>

      {loading ? (
        <p className="text-sm text-c-muted">Loading…</p>
      ) : !usage || editing ? (
        <B2UsageForm
          analysisId={analysisId}
          initialValue={usage ?? undefined}
          submitLabel={usage ? 'Save changes →' : 'Save usage →'}
          onSaved={() => {
            setEditing(false);
            setLoading(true);
            fetch(`/api/analyses/${analysisId}`)
              .then((r) => r.json())
              .then((d) => setUsage(d.b2Usage ?? null))
              .finally(() => setLoading(false));
          }}
        />
      ) : (
        view && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-c-border bg-c-surface p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-c-text">Throughput ceiling</p>
              <div className="grid grid-cols-2 gap-3">
                <TierColumn label={view.currentSpec.customerLabel} spec={view.currentSpec} />
                <TierColumn label={view.targetSpec.customerLabel} spec={view.targetSpec} highlight />
              </div>
            </div>

            <div className="rounded-2xl border border-c-border bg-c-surface p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-c-text">Estimated cost</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-c-subtle">Today (Uncommitted)</p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-c-text">{formatCurrency(view.currentMonthlyCostUsd)}/mo</p>
                </div>
                <div>
                  <p className="text-c-subtle">At {view.targetSpec.customerLabel}</p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-c-text">{formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-c-subtle">
                {view.monthlyDeltaUsd > 0
                  ? `${formatCurrency(view.monthlyDeltaUsd)}/mo lower at ${view.targetSpec.customerLabel}.`
                  : view.monthlyDeltaUsd < 0
                    ? `${formatCurrency(Math.abs(view.monthlyDeltaUsd))}/mo higher at ${view.targetSpec.customerLabel} — the value here is throughput headroom, not a lower bill.`
                    : `Same $/TB at ${view.targetSpec.customerLabel} — the value here is throughput headroom, not a lower bill.`}
              </p>
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-[10px] border border-c-border2 bg-c-surface px-4 py-2.5 text-[13px] font-semibold text-c-muted transition-colors hover:bg-c-surface2"
              >
                Edit usage
              </button>
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

function TierColumn({
  label,
  spec,
  highlight,
}: {
  label: string;
  spec: ReturnType<typeof computeCommitUpsellView>['currentSpec'];
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? 'bg-c-red-soft' : 'bg-c-surface2'}`}>
      <p className={`text-xs font-semibold ${highlight ? 'text-c-red-dark' : 'text-c-muted'}`}>{label}</p>
      <p className="mt-1 text-sm font-semibold text-c-text">
        {spec.throughputGbitPut} Gbit/s PUT / {spec.throughputGbitGet} Gbit/s GET
      </p>
      <p className="mt-0.5 text-xs text-c-subtle">
        {spec.rpsPut === null ? 'Scales with throughput' : `${spec.rpsPut.toLocaleString()} PUT / ${spec.rpsGet!.toLocaleString()} GET RPS`}
      </p>
    </div>
  );
}
