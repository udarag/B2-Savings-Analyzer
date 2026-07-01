'use client';

// Customer-facing report for the commit-upsell flow: an existing B2 Uncommitted customer being
// pitched to sign a contract (or jump to Overdrive). There's no source-cloud bill and usually no
// dollar savings — the pitch is throughput headroom — so this leads with a throughput ladder
// instead of the migration report's dollar-savings hero, and never fabricates a "savings" figure.
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { Analysis, B2UsageInput } from '@/types/analysis';
import { computeCommitUpsellView } from '@/lib/analysis/commit-upsell-model';
import { formatCurrency } from '@/components/shared/FormatCurrency';

function BackblazeLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-label="Backblaze">
      <Image
        src="/backblaze-logo.png"
        alt="Backblaze"
        width={800}
        height={286}
        className={`${compact ? 'h-7' : 'h-9'} w-auto object-contain`}
      />
    </div>
  );
}

interface CommitUpsellReportProps {
  analysisId: string;
  meta: Analysis;
}

export function CommitUpsellReport({ analysisId, meta }: CommitUpsellReportProps) {
  const [usage, setUsage] = useState<B2UsageInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const reportCompanyName = meta.companyName || meta.prospectName;

  useEffect(() => {
    fetch(`/api/analyses/${analysisId}`)
      .then((r) => r.json())
      .then((d) => setUsage(d.b2Usage ?? null))
      .finally(() => setLoading(false));
  }, [analysisId]);

  const view = usage ? computeCommitUpsellView(usage) : null;

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const r = await fetch(`/api/analyses/${analysisId}/pdf`);
      if (!r.ok) throw new Error('PDF generation failed');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportCompanyName.replace(/[^a-zA-Z0-9]+/g, '-')}-B2-Commitment-Upgrade.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('PDF generation failed. Make sure Playwright is installed.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="relative w-12 h-12 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-bb-red border-t-transparent animate-spin" />
        </div>
        <p className="text-gray-500 text-sm">Loading report...</p>
      </div>
    );
  }

  return (
    <>
      <div className="no-print border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BackblazeLogo compact />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">Customer report</p>
              <p className="truncate text-xs text-gray-500">Prepared for {reportCompanyName}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/analyses/${analysisId}`}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              Back to analysis
            </Link>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-bb-red-dark shadow-sm transition-colors hover:bg-bb-red-light disabled:cursor-wait disabled:opacity-60"
            >
              {downloadingPdf ? 'Generating PDF' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 py-7 sm:py-8 print:p-0">
        <div className="report-container mx-auto max-w-4xl overflow-hidden rounded-[14px] bg-white shadow-[0_18px_60px_rgba(0,0,51,0.16)] print:max-w-none print:overflow-visible print:rounded-none print:shadow-none">
          <style>{`
            @media print {
              @page { size: letter; margin: 0.5in 0.65in; }
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
              .no-print { display: none !important; }
              .keep-together { break-inside: avoid; }
            }
          `}</style>

          <div className="border-t-[6px] border-bb-red bg-white px-8 py-5 flex items-center justify-between gap-5 border-b border-gray-200">
            <BackblazeLogo />
            <div className="min-w-0 flex-1 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Customer Report</p>
              <h1 className="mt-1 text-base font-semibold leading-tight text-bb-navy">B2 Throughput &amp; Commitment Upgrade</h1>
              <p className="mt-0.5 text-xs text-gray-500">Prepared for {reportCompanyName}</p>
            </div>
          </div>

          {!usage || !view ? (
            <div className="px-8 py-10 text-center text-sm text-gray-500">Usage details haven&apos;t been entered for this opportunity yet.</div>
          ) : (
            <div className="px-8 pt-6 pb-8">
              {/* Hero: throughput ladder, not a dollar figure — that's the honest value story here. */}
              <div className="mb-6 rounded-lg bg-bb-navy bg-cover bg-center p-6 text-white keep-together" style={{ backgroundImage: "url('/gradient-dark.png')" }}>
                <p className="text-sm text-gray-300">Removing {reportCompanyName}&apos;s throughput ceiling</p>
                <div className="mt-4 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wide text-gray-400">Today (Uncommitted)</p>
                    <p className="mt-1 font-display text-2xl font-bold leading-tight">
                      {view.currentSpec.throughputGbitPut} Gbit/s
                    </p>
                    <p className="text-xs text-gray-300">
                      {view.currentSpec.rpsPut === null ? 'Scales with throughput' : `${view.currentSpec.rpsPut.toLocaleString()} RPS PUT/GET`}
                    </p>
                  </div>
                  <div className="text-2xl text-gray-400">→</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wide text-gray-400">With {view.targetSpec.customerLabel}</p>
                    <p className="mt-1 font-display text-2xl font-bold leading-tight text-white">
                      {view.targetSpec.throughputGbitPut} Gbit/s{view.targetSpec.throughputGbitMax ? `+` : ''}
                    </p>
                    <p className="text-xs text-gray-300">
                      {view.targetSpec.rpsPut === null ? 'Scales with throughput' : `${view.targetSpec.rpsPut.toLocaleString()} RPS PUT/GET`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-6 report-narrative-section">
                <h2 className="text-lg font-semibold mb-3 border-l-4 border-bb-red pl-3">What changes for {reportCompanyName}?</h2>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {reportCompanyName} is currently on B2&apos;s Uncommitted (pay-as-you-go) tier, capped at {view.currentSpec.throughputGbitPut} Gbit/s throughput
                  and {view.currentSpec.rpsPut?.toLocaleString() ?? 'a limited number of'} requests per second on PUT and GET each. Moving to
                  the {view.targetSpec.customerLabel} tier raises that ceiling to {view.targetSpec.throughputGbitPut} Gbit/s{view.targetSpec.throughputGbitMax ? ` (scaling to ${view.targetSpec.throughputGbitMax} Gbit/s)` : ''}
                  {view.targetSpec.rpsPut === null ? ', with request throughput that scales alongside it' : `, with a ${view.targetSpec.rpsPut.toLocaleString()} RPS ceiling`}.
                  {' '}
                  {Math.abs(view.monthlyDeltaUsd) < 1
                    ? 'Storage pricing stays essentially flat — the value here is capacity headroom, not a lower bill.'
                    : view.monthlyDeltaUsd > 0
                      ? `Storage pricing also comes down slightly, to an estimated ${formatCurrency(view.projectedTargetMonthlyCostUsd)}/month.`
                      : `Storage pricing moves to an estimated ${formatCurrency(view.projectedTargetMonthlyCostUsd)}/month — the value here is capacity headroom and removing throttling risk, not a lower bill.`}
                </p>
              </div>

              <div className="mb-6 rounded-lg border border-gray-200 overflow-hidden print:break-inside-avoid keep-together">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <h2 className="text-base font-semibold text-gray-900">Estimated Cost</h2>
                </div>
                <div className="grid grid-cols-2 gap-px bg-gray-200 text-sm">
                  <div className="bg-white p-4">
                    <p className="text-xs font-medium text-gray-500">Today (Uncommitted)</p>
                    <p className="mt-1 font-display text-base font-bold text-gray-900">{formatCurrency(view.currentMonthlyCostUsd)}/mo</p>
                  </div>
                  <div className="bg-white p-4">
                    <p className="text-xs font-medium text-gray-500">At {view.targetSpec.customerLabel}</p>
                    <p className="mt-1 font-display text-base font-bold text-bb-red-dark">{formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 keep-together">
                <h2 className="text-sm font-semibold text-gray-900 mb-2">Assumptions &amp; Sources</h2>
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    <tr>
                      <td className="py-2 font-medium text-gray-600 w-1/3">Current usage</td>
                      <td className="py-2">
                        {usage.currentStorageTb.toLocaleString()} TB, {formatCurrency(usage.currentMonthlySpendUsd)}/month
                        ({usage.source === 'manual' ? 'entered by your account team' : 'from a usage screenshot'})
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-600">Growth assumption</td>
                      <td className="py-2">{view.growthLabel}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-600">Target service tier</td>
                      <td className="py-2">{view.targetSpec.customerLabel}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-600">Pricing date</td>
                      <td className="py-2">June 2026 (verified against published rates)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="border-t-2 border-bb-red px-8 py-4 flex items-center justify-between gap-4 text-sm text-gray-400">
            <BackblazeLogo compact />
          </div>
        </div>
      </div>
    </>
  );
}
