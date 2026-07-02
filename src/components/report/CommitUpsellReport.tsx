'use client';

// Customer-facing report for the commit-upsell flow: an existing B2 Uncommitted (pay-as-you-go)
// customer being pitched to sign a contract and move to the Committed tier. There's no source-cloud
// bill and usually no dollar savings — the pitch is throughput headroom — so this leads with a
// multiplier-led throughput hero instead of the migration report's dollar-savings hero, never a
// fabricated "savings". Each figure lives in exactly one place (hero = the story, table = the spec
// sheet) so the same two numbers don't repeat three ways.
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { Analysis, B2UsageInput } from '@/types/analysis';
import { computeCommitUpsellView } from '@/lib/analysis/commit-upsell-model';
import { resolveCommitUpsellPoints } from '@/lib/analysis/commit-upsell-angles';
import type { ServiceTierSpec } from '@/lib/pricing/service-levels';
import { formatCurrency } from '@/components/shared/FormatCurrency';

// Local throughput formatter (rolls Gbit/s over to Tbps at ≥1000) so this report stays
// self-contained. Kept separate from the deal-builder's helper on purpose.
function formatBandwidth(gbit: number): string {
  return gbit >= 1000 ? `${(gbit / 1000).toLocaleString()} Tbps` : `${gbit.toLocaleString()} Gbit/s`;
}

// Fold a ratio into a clean "×" multiplier for the hero: 12.5 → "12.5×", 6 → "6×".
function formatMultiplier(ratio: number): string {
  return Number.isInteger(ratio) ? `${ratio}×` : `${ratio.toFixed(1)}×`;
}

// Paired PUT / GET throughput for the spec table, e.g. "50 / 50 Gbit/s" (rolls to Tbps at ≥1000).
function bandwidthPair(spec: ServiceTierSpec): string {
  const rollsToTbps = spec.throughputGbitPut >= 1000 || spec.throughputGbitGet >= 1000;
  const fmt = (n: number) => (rollsToTbps ? (n / 1000).toLocaleString() : n.toLocaleString());
  return `${fmt(spec.throughputGbitPut)} / ${fmt(spec.throughputGbitGet)} ${rollsToTbps ? 'Tbps' : 'Gbit/s'}`;
}

// Paired PUT / GET request-rate ceiling, or the scaling note when the tier has no fixed ceiling.
function rpsPair(spec: ServiceTierSpec): string {
  if (spec.rpsPut === null || spec.rpsGet === null) return 'Scales with throughput';
  return `${spec.rpsPut.toLocaleString()} / ${spec.rpsGet.toLocaleString()}`;
}

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

  // The redesigned hero leads with the *multiplier*, not two equal numbers — the size of the jump is
  // the whole commit-upsell pitch, so we compute it here and draw a bar so it's felt, not just read.
  const bwMultiplier = view && view.currentSpec.throughputGbitGet > 0
    ? view.targetSpec.throughputGbitGet / view.currentSpec.throughputGbitGet
    : null;
  const rpsMultiplier = view && view.currentSpec.rpsGet && view.targetSpec.rpsGet
    ? view.targetSpec.rpsGet / view.currentSpec.rpsGet
    : null;
  // Bar fill = today's ceiling as a share of the new one (min 4% so a sliver always shows).
  const bwTodayPct = view && view.targetSpec.throughputGbitGet > 0
    ? Math.max(4, (view.currentSpec.throughputGbitGet / view.targetSpec.throughputGbitGet) * 100)
    : 0;
  const rpsTodayPct = view && view.currentSpec.rpsGet && view.targetSpec.rpsGet
    ? Math.max(4, (view.currentSpec.rpsGet / view.targetSpec.rpsGet) * 100)
    : 0;

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
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Prepared for {reportCompanyName} · June 2026</p>
              <h1 className="mt-1 text-base font-semibold leading-tight text-bb-navy">Your B2 throughput upgrade</h1>
            </div>
          </div>

          {!usage || !view ? (
            <div className="px-8 py-10 text-center text-sm text-gray-500">Usage details haven&apos;t been entered for this opportunity yet.</div>
          ) : (
            <div className="px-8 pt-6 pb-8">
              {/* Hero: multiplier-led. The jump — not a dollar figure — is the honest value story, so
                  we make it *felt* with a big multiplier and a bar. The intro line states the rate as
                  a plain fact ("the same $X/TB"); the honesty is the pitch. */}
              <div className="mb-4 rounded-xl bg-bb-navy bg-cover bg-center p-6 text-white keep-together" style={{ backgroundImage: "url('/gradient-dark.png')" }}>
                <p className="mb-4 max-w-[46ch] text-sm text-bb-purple-pale">
                  Signing a contract moves {reportCompanyName} to the{' '}
                  <strong className="text-white">{view.targetSpec.customerLabel}</strong> tier —{' '}
                  {view.discountPercent > 0 ? (
                    <>storage drops to <strong className="text-white">{formatCurrency(view.targetRatePerTb)}/TB</strong>, with the throughput ceiling lifted.</>
                  ) : (
                    <>the same {formatCurrency(view.currentRatePerTb)}/TB, with the throughput ceiling lifted.</>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-6">
                  {/* Bandwidth headroom */}
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-[46px] font-bold leading-[0.9]">{bwMultiplier ? formatMultiplier(bwMultiplier) : '—'}</span>
                      <span className="text-xs leading-tight text-bb-purple-pale">more<br />bandwidth</span>
                    </div>
                    <div className="mt-3.5">
                      <div className="relative h-2 rounded-full bg-white/15">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-gray-400" style={{ width: `${bwTodayPct}%` }} />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[10.5px]">
                        <span className="text-gray-400">Today {formatBandwidth(view.currentSpec.throughputGbitGet)}</span>
                        <span className="font-semibold text-white">{formatBandwidth(view.targetSpec.throughputGbitGet)}</span>
                      </div>
                    </div>
                  </div>
                  {/* Request-rate headroom */}
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-[46px] font-bold leading-[0.9]">{rpsMultiplier ? formatMultiplier(rpsMultiplier) : '—'}</span>
                      <span className="text-xs leading-tight text-bb-purple-pale">more requests<br />per second</span>
                    </div>
                    <div className="mt-3.5">
                      <div className="relative h-2 rounded-full bg-white/15">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-gray-400" style={{ width: `${rpsTodayPct}%` }} />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[10.5px]">
                        <span className="text-gray-400">Today {view.currentSpec.rpsGet?.toLocaleString() ?? '—'}/s</span>
                        <span className="font-semibold text-white">
                          {view.targetSpec.rpsGet === null ? 'Scales' : `${view.targetSpec.rpsGet.toLocaleString()}/s`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Why it matters — capability framing only, deliberately no invented dollars. The AE
                  picks the angle on the deal-sizing dashboard to match the customer's workload; the
                  points below follow that choice (default: general throughput). */}
              <div className="mb-[18px] grid grid-cols-3 gap-2.5 keep-together">
                {resolveCommitUpsellPoints(usage.messagingAngle, usage.customAnglePoints).map((c) => (
                  <div key={c.title} className="rounded-[9px] border border-gray-200 px-3 py-2.5">
                    <p className="text-[11.5px] font-bold text-bb-navy">{c.title}</p>
                    <p className="mt-1 text-[10.5px] leading-snug text-gray-500">{c.body}</p>
                  </div>
                ))}
              </div>

              {/* Comparison table — the spec sheet. Each figure appears here exactly once; the storage
                  row says "unchanged" out loud when the rate doesn't move. Still zero internal levers:
                  no discount %, no "X% off" — only the resulting rate as a fact. */}
              <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 keep-together">
                <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-gray-200 text-sm">
                  <div className="bg-gray-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Specification</div>
                  <div className="bg-gray-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Today</div>
                  <div className="bg-bb-navy px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-white">With {view.targetSpec.customerLabel}</div>

                  {/* Storage rate gets the purple emphasis: it's the "same price" honesty anchor. */}
                  <div className="bg-white px-4 py-3 text-[11px] font-medium text-gray-600">Storage rate</div>
                  <div className="bg-white px-4 py-3 text-[11px] text-gray-400">{formatCurrency(view.currentRatePerTb)}/TB</div>
                  <div className="bg-bb-purple-soft px-4 py-3 text-[11px] font-semibold text-bb-purple">
                    {formatCurrency(view.targetRatePerTb)}/TB{view.discountPercent > 0 ? '' : ' · unchanged'}
                  </div>

                  {[
                    { label: 'Bandwidth PUT / GET', a: bandwidthPair(view.currentSpec), b: bandwidthPair(view.targetSpec) },
                    { label: 'Requests/sec PUT / GET', a: rpsPair(view.currentSpec), b: rpsPair(view.targetSpec) },
                    { label: 'Included egress', a: view.currentSpec.unlimitedEgress ? 'Unlimited' : '3× stored', b: view.targetSpec.unlimitedEgress ? 'Unlimited' : '3× stored' },
                    { label: 'Estimated monthly', a: `${formatCurrency(view.currentMonthlyCostUsd)}/mo`, b: `${formatCurrency(view.projectedTargetMonthlyCostUsd)}/mo` },
                  ].map((row) => (
                    <div key={row.label} className="contents">
                      <div className="bg-white px-4 py-3 text-[11px] font-medium text-gray-600">{row.label}</div>
                      <div className="bg-white px-4 py-3 text-[11px] text-gray-400">{row.a}</div>
                      <div className="bg-bb-red-light/50 px-4 py-3 text-[11px] font-bold text-bb-navy">{row.b}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assumptions condensed to one honest caption line (no separate spec-repeating block). */}
              <p className="text-[10.5px] leading-snug text-gray-400 keep-together">
                Based on {usage.currentStorageTb.toLocaleString()} TB at {formatCurrency(view.currentRatePerTb)}/TB, June 2026 published rates, {view.growthLabel}
                {usage.source === 'manual' ? ', entered by your account team' : ', from a usage export'}. Prepared by your Backblaze account team.
              </p>
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
