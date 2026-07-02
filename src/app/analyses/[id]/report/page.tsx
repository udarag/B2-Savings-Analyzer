'use client';

// Customer-facing savings report (the screen an AE shares and the source the PDF route renders).
// Everything here is shown to the prospect, so it must stay free of internal warnings, env-var
// names, and file paths — only the modeled storage-scope economics and published B2 pricing.
import { Suspense, useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type { Analysis, ParsedBill, ModelConfig, TierInventoryRow, B2ServiceTier } from '@/types/analysis';
import { normalizeEgressConfig } from '@/types/analysis';
import type { CostModelResult, ProjectionPoint } from '@/types/model';
import {
  getStorageScopeCurrentMonthly,
  getStorageScopeReplacementMonthly,
} from '@/lib/engine/cost-model';
import { buildTierState, computeAnalysisView } from '@/lib/analysis/analysis-model';
import {
  computeBusinessPotential,
  formatCapacityMultiplier,
  type BusinessPotential,
} from '@/lib/analysis/business-potential';
import {
  getServiceTierComparison,
  getServiceTierSpec,
  hasUnlimitedEgress,
  formatThroughput,
  type ServiceTierSpec,
} from '@/lib/analysis/service-tier-comparison';
import {
  getOperationActionCostSummary,
  type ActionCostDetail,
  type OperationActionCostSummary,
} from '@/lib/analysis/action-costs';
import { formatGrowthAssumption } from '@/lib/engine/projections';
import { getRegionLocation } from '@/lib/regions';
import { formatStorageTierName } from '@/lib/storage-tiers';
import { buildReportFilename, getFilenameFromContentDisposition } from '@/lib/report-filename';
import { formatCurrency, formatNumber, formatPercent } from '@/components/shared/FormatCurrency';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';
import b2Pricing from '@/lib/pricing/b2.json';
import { CommitUpsellReport } from '@/components/report/CommitUpsellReport';

// Account-executive attribution shown in the report footer ("Prepared by ...").
interface AEInfo {
  name: string;
  email: string;
  title?: string;
}

// Derive a presentable name from an email local part when no display name is configured,
// e.g. "jane.doe@" -> "Jane Doe". Best-effort only; a real display name always wins.
function emailToDisplayName(email: string): string {
  const local = email.split('@')[0];
  return local
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Render an internal GB amount as TB for the customer. The app's basis is GB (1 TB = 1000 GB,
// decimal — not GiB), so this is a plain /1000 with no binary conversion.
function formatReportStorage(gb: number): string {
  const tb = gb / 1000;
  return `${tb.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} TB`;
}

function formatEffectiveRate(perTb: number): string {
  return `${formatCurrency(perTb)}/TB`;
}

// Join non-null phrases into a grammatical, Oxford-comma list for inline prose. Nulls are dropped
// so callers can pass conditionally-present clauses without pre-filtering.
function formatPhraseList(items: Array<string | null>): string {
  const phrases = items.filter((item): item is string => Boolean(item));
  if (phrases.length === 0) return '';
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

function formatProviderName(provider: Analysis['provider']): string {
  switch (provider) {
    case 'aws': return 'AWS';
    case 'gcp': return 'Google Cloud';
    case 'azure': return 'Microsoft Azure';
    case 'r2': return 'Cloudflare R2';
  }
}

// Prefer a years label for whole-year terms ("3 Years"), otherwise fall back to months so odd
// projection terms (e.g. 18 months) still read sensibly.
function formatTermLabel(months: number): string {
  const years = months / 12;
  if (Number.isInteger(years)) return `${years} Year${years === 1 ? '' : 's'}`;
  return `${months} Months`;
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

/** Route entry for the customer report. Wraps the content in Suspense because it reads useSearchParams. */
export default function ReportPage() {
  return (
    <Suspense fallback={<ReportLoading />}>
      <ReportPageContent />
    </Suspense>
  );
}

function ReportPageContent() {
  const params = useParams();
  const id = params.id as string;
  const searchParams = useSearchParams();

  const [meta, setMeta] = useState<Analysis | null>(null);
  const [parsed, setParsed] = useState<ParsedBill | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileAeInfo, setProfileAeInfo] = useState<AEInfo | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const reportTitleName = meta?.companyName || meta?.prospectName;
  useDocumentTitle(reportTitleName ? `${reportTitleName} Customer Report` : 'Customer Report');

  const aeInfoFromParams = useMemo<AEInfo | null>(() => {
    const aeEmail = searchParams.get('ae');
    if (!aeEmail) return null;

    return {
      name: searchParams.get('aeName') || emailToDisplayName(aeEmail),
      email: aeEmail,
      title: searchParams.get('aeTitle') || undefined,
    };
  }, [searchParams]);

  // URL params (used by the PDF route, which renders this page with explicit ?ae=... attribution)
  // take precedence over the signed-in AE's profile.
  const aeInfo = aeInfoFromParams || profileAeInfo;

  // Only fall back to the logged-in user's identity when the URL didn't pin an AE.
  useEffect(() => {
    if (aeInfoFromParams) return;

    Promise.all([
      fetch('/api/auth/me').then((r) => r.ok ? r.json() : null),
      fetch('/api/auth/profile').then((r) => r.ok ? r.json() : null),
    ]).then(([me, prof]) => {
      const email = me?.user?.email;
      if (email) {
        setProfileAeInfo({
          name: prof?.profile?.displayName || emailToDisplayName(email),
          email,
          title: prof?.profile?.title || undefined,
        });
      }
    }).catch(() => {});
  }, [aeInfoFromParams]);

  useEffect(() => {
    fetch(`/api/analyses/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setMeta(d.meta);
        setParsed(d.parsed);
        setModelConfig(d.modelConfig);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const tiers: TierInventoryRow[] = useMemo(() => {
    if (!parsed || !modelConfig) return [];
    return buildTierState(parsed, modelConfig).tiers;
  }, [parsed, modelConfig]);

  const egressConfig = useMemo(() => {
    if (!modelConfig) return null;
    return normalizeEgressConfig(modelConfig.egressConfig);
  }, [modelConfig]);

  // Same shared computation path as the dashboard + rerun.
  const view = useMemo(() => {
    if (!parsed || !modelConfig || !egressConfig) return null;
    return computeAnalysisView({
      lineItems: parsed.lineItems,
      discounts: parsed.discounts,
      tiers,
      egressConfig,
      b2PricePerTb: modelConfig.b2PricePerTb,
      // Legacy stored configs predate this field; default to Committed (today's implicit baseline)
      // rather than trusting the ModelConfig type's required-field guarantee against raw storage.
      b2ServiceTier: modelConfig.b2ServiceTier ?? 'committed',
      termMonths: modelConfig.projectionTermMonths,
    });
  }, [parsed, modelConfig, egressConfig, tiers]);

  const costModel = view?.costModel ?? null;
  const projections = view?.projections ?? [];
  const pricingDetection = view?.pricingDetection ?? [];

  // Persist a point-in-time snapshot the first time a viable model is computed, so the figures the
  // customer saw are recoverable even if pricing/config later changes. Depends on `!!costModel`
  // (not the object) so it fires once on first render rather than on every recompute.
  useEffect(() => {
    if (!costModel || !modelConfig || !egressConfig || !tiers.length) return;
    fetch(`/api/analyses/${id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'report-view' }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!costModel]);

  if (!loading && meta?.opportunityType === 'commit-upsell') {
    return <CommitUpsellReport analysisId={id} meta={meta} />;
  }

  if (loading || !meta || !parsed || !costModel || !modelConfig || !egressConfig) {
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

  // The report only ever speaks to the storage scope the AE selected for migration, never the
  // whole bill. Everything downstream sums/compares against these migrated tiers.
  const migratedTiers = tiers.filter((t) => t.migrateToB2);
  const migratedStorageGb = migratedTiers.reduce((s, t) => s + t.gbStored, 0);
  const modeledB2Monthly = getStorageScopeReplacementMonthly(costModel);
  const modeledCurrentMonthly = getStorageScopeCurrentMonthly(costModel);
  const customerMigrationCost = costModel.migrationCost.total;
  // The egress + restore cost Backblaze absorbs under UDM; shown as the "covered" amount and
  // distinct from `customerMigrationCost`, which is $0 when UDM is enabled.
  const migrationCostCovered = costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost;
  const totalSavings = projections.length > 0 ? projections[projections.length - 1].cumulativeSavings : 0;
  const endingProjectedStorageGb = projections.length > 0 ? projections[projections.length - 1].storageGb : migratedStorageGb;
  // The "business potential" figures (capacity headroom, free egress, redeployable capital) that turn
  // the cost-out story into a value-in one. Derived once from the same model the rest of the page uses.
  const businessPotential = computeBusinessPotential({
    migratedTiers,
    b2PricePerTb: modelConfig.b2PricePerTb,
    costModel,
    cumulativeSavings: totalSavings,
  });
  const termYears = (modelConfig?.projectionTermMonths || 12) / 12;
  const growthLabel = formatGrowthAssumption({
    growthMode: egressConfig.dataGrowthMode,
    annualGrowthPercent: egressConfig.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: egressConfig.dataGrowthFixedTbPerMonth,
  });
  // With a non-zero migration cost the story is "break-even at month N"; with $0 cost (e.g. UDM)
  // savings begin immediately, so the timing framing switches to "Day 1" throughout.
  const hasCustomerMigrationPayback = customerMigrationCost > 0;
  const savingsTimingLabel = hasCustomerMigrationPayback ? 'Break-Even' : 'Savings Start';
  const savingsTimingSummaryLabel = hasCustomerMigrationPayback ? 'Break-Even Timing' : 'Savings Start';
  const savingsTimingValue = hasCustomerMigrationPayback
    ? costModel.breakEvenMonth
      ? `Month ${costModel.breakEvenMonth}`
      : 'Review required'
    : 'Day 1';
  const providerLabel = formatProviderName(meta.provider);
  const reportCompanyName = meta.companyName || meta.prospectName;
  const b2StorageRateLabel = `${formatCurrency(modelConfig.b2PricePerTb)}/TB/month`;
  // Read off costModel rather than raw modelConfig — the engine's default parameter already
  // resolves a missing/legacy tier to 'committed', so this is guaranteed valid.
  const b2ServiceTier = costModel.b2ServiceTier;
  const serviceTierComparison = getServiceTierComparison(b2ServiceTier);
  // Per-operation fees on the source bill (PUT/GET request charges, cold-tier access/restore) that
  // B2 removes — standard B2 transactions are free and B2 has no retrieval/restore fees. These are
  // surfaced as a separate savings narrative on top of the raw storage-rate delta.
  const actionCostSummary = getOperationActionCostSummary(parsed.lineItems);
  const coldTierAccess = actionCostSummary.coldTierAccess;
  const actionFeePhrases = formatPhraseList([
    actionCostSummary.putRelated.currentCost > 0
      ? `${formatCurrency(actionCostSummary.putRelated.currentCost)}/month in PUT/write-class request charges`
      : null,
    actionCostSummary.getRelated.currentCost > 0
      ? `${formatCurrency(actionCostSummary.getRelated.currentCost)}/month in GET/read-class request charges`
      : null,
    coldTierAccess.totalCost > 0
      ? `${formatCurrency(coldTierAccess.totalCost)}/month in cold-tier access, restore, tiering, or early-deletion charges`
      : null,
  ]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const r = await fetch(`/api/analyses/${id}/pdf`);
      if (!r.ok) throw new Error('PDF generation failed');
      const filename = getFilenameFromContentDisposition(r.headers.get('Content-Disposition')) || buildReportFilename(meta);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // This alert is on the no-print AE toolbar, never the customer-facing report body, so the
      // Playwright hint is fine to surface here.
      alert('PDF generation failed. Make sure Playwright is installed.');
    } finally {
      setDownloadingPdf(false);
    }
  };

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
              href={`/analyses/${id}`}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back to analysis
            </Link>
            <button
              type="button"
              onClick={handleDownloadPdf}
              id="pdf-btn"
              disabled={downloadingPdf}
              className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-bb-red-dark shadow-sm transition-colors hover:bg-bb-red-light disabled:cursor-wait disabled:opacity-60"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
              </svg>
              {downloadingPdf ? 'Generating PDF' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* Soft page gutter (screen only) so the report reads as a floating "paper". Print collapses
          it via print:p-0 and the card reverts to a flush, full-width sheet for the PDF. */}
      <div className="px-4 py-7 sm:py-8 print:p-0">
      <div className="report-container report-compact mx-auto max-w-4xl overflow-hidden rounded-[14px] bg-white shadow-[0_18px_60px_rgba(0,0,51,0.16)] print:max-w-none print:overflow-visible print:rounded-none print:shadow-none">
      {/* Inline styles, not Tailwind utilities, because the PDF route renders this page in a
          headless browser: the print/page-size rules and the .report-compact size overrides must
          travel with the markup and survive print-to-PDF. */}
      <style>{`
        .report-compact .text-xs { font-size: 0.68rem !important; line-height: 1.35; }
        .report-compact .text-sm { font-size: 0.8rem !important; line-height: 1.4; }
        .report-compact .text-base { font-size: 0.9rem !important; line-height: 1.35; }
        .report-compact .text-lg { font-size: 1rem !important; line-height: 1.25; }
        .report-compact .text-xl { font-size: 1.12rem !important; line-height: 1.2; }
        .report-compact .text-2xl { font-size: 1.25rem !important; line-height: 1.15; }
        .report-compact .text-4xl { font-size: 2rem !important; line-height: 1.08; }
        .report-compact .p-8 { padding: 1.5rem !important; }
        .report-compact .px-8 { padding-left: 1.5rem !important; padding-right: 1.5rem !important; }
        .report-compact .py-5 { padding-top: 1rem !important; padding-bottom: 1rem !important; }
        .report-compact .pt-6 { padding-top: 1.25rem !important; }
        .report-compact .pb-8 { padding-bottom: 1.5rem !important; }
        .report-compact .p-6 { padding: 1.15rem !important; }
        .report-compact .p-4 { padding: 0.875rem !important; }
        .report-compact .p-3 { padding: 0.65rem !important; }
        .report-compact .px-4 { padding-left: 0.875rem !important; padding-right: 0.875rem !important; }
        .report-compact .py-3 { padding-top: 0.65rem !important; padding-bottom: 0.65rem !important; }
        .report-compact .px-3 { padding-left: 0.65rem !important; padding-right: 0.65rem !important; }
        .report-compact .py-2 { padding-top: 0.45rem !important; padding-bottom: 0.45rem !important; }
        .report-compact .mb-6 { margin-bottom: 1.15rem !important; }
        .report-compact .mb-5 { margin-bottom: 1rem !important; }
        .report-compact .mb-4 { margin-bottom: 0.9rem !important; }
        .report-compact .mb-3 { margin-bottom: 0.7rem !important; }
        .report-compact .mt-8 { margin-top: 1.5rem !important; }
        .report-compact .mt-5 { margin-top: 1rem !important; }
        .report-compact .mt-4 { margin-top: 0.9rem !important; }
        .report-compact .gap-5 { gap: 1rem !important; }
        .report-compact .gap-4 { gap: 0.875rem !important; }
        .report-compact .gap-3 { gap: 0.65rem !important; }
        .report-compact table { font-size: 10.5px; }
        @media screen and (max-width: 640px) {
          .report-container {
            width: 100%;
            max-width: 100%;
            overflow-x: hidden;
          }
          .report-compact .px-8 {
            padding-left: 1rem !important;
            padding-right: 1rem !important;
          }
          .report-compact .p-8,
          .report-compact .p-6,
          .report-compact .p-4 {
            padding: 1rem !important;
          }
          .report-compact .report-header-flush {
            align-items: flex-start;
            flex-direction: column;
            gap: 0.75rem !important;
            text-align: left;
          }
          .report-compact .report-header-flush > div:last-child {
            text-align: left;
            width: 100%;
          }
          .report-compact .grid,
          .report-compact .flex,
          .report-compact .grid > *,
          .report-compact .flex > * {
            min-width: 0;
          }
          .report-compact .grid-cols-2 {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .report-compact .grid-cols-\\[minmax\\(0\\,1fr\\)_auto\\] {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .report-compact .shrink-0 {
            max-width: 100%;
          }
          .report-compact .text-4xl {
            font-size: 1.55rem !important;
          }
        }
        @media print {
          @page { size: letter; margin: 0.5in 0.65in; }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            background: white !important;
          }
          main { background: white !important; }
          .no-print { display: none !important; }
          .report-container { max-width: none; }
          .report-header-flush { margin: 0; }
          table { break-inside: avoid; }
          .keep-together { break-inside: avoid; }
          /* Let the executive-summary content flow into the narrative instead of forcing a page
             break before it. The forced break used to leave the lower half of a page empty whenever
             the summary content didn't end exactly at a page boundary; flowing fills the pages and
             keep-together still protects individual panels from splitting mid-block. */
          .report-narrative-section {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .report-action-fees-header {
            display: grid !important;
            grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.6fr) minmax(0, 0.8fr) minmax(0, 0.65fr);
          }
          .report-action-fees-row {
            grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.6fr) minmax(0, 0.8fr) minmax(0, 0.65fr) !important;
            align-items: start;
          }
          .report-action-fees-right {
            text-align: right !important;
          }
          .report-action-fees-mobile-label {
            display: none !important;
          }
          .report-action-fees-detail-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .print-page-break { break-before: page; }
        }
      `}</style>

      {/* Page 1: Executive Summary */}
      <div>
        <div className="border-t-[6px] border-bb-red bg-white px-8 py-5 flex items-center justify-between gap-5 border-b border-gray-200 report-header-flush">
          <BackblazeLogo />
          <div className="min-w-0 flex-1 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Customer Report</p>
            <h1 className="mt-1 text-base font-semibold leading-tight text-bb-navy">B2 Cloud Storage Savings</h1>
            <p className="mt-0.5 text-xs text-gray-500">Prepared for {reportCompanyName}</p>
          </div>
        </div>

        <div className="px-8 pt-6 pb-8">
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-[1.25fr_1fr]">
            <div className="relative overflow-hidden rounded-lg bg-bb-navy bg-cover bg-center p-6 text-white" style={{ backgroundImage: "url('/gradient-dark.png')" }}>
              <p className="text-sm text-gray-300">Projected Savings Over {termYears} Year{termYears === 1 ? '' : 's'}</p>
              <p className="mt-1 font-display text-4xl font-bold leading-tight">{formatCurrency(totalSavings)}</p>
              <p className="mt-2 text-xs text-gray-400">Includes {growthLabel} and the modeled migration economics below.</p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-400">Monthly Savings</p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-green-200">{formatCurrency(costModel.monthlySavings)}</p>
                </div>
                <div>
                  <p className="text-gray-400">Annual Savings</p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-green-200">{formatCurrency(costModel.annualSavings)}</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OutcomeMetric label="Cost Reduction" value={formatPercent(costModel.savingsPercent)} tone="green" />
              <OutcomeMetric label={savingsTimingLabel} value={savingsTimingValue} tone={!hasCustomerMigrationPayback ? 'green' : undefined} />
              <OutcomeMetric label="Modeled Storage" value={formatReportStorage(migratedStorageGb)} />
              <OutcomeMetric
                label={costModel.udmEnabled ? 'Migration Covered' : 'Migration Cost'}
                value={costModel.udmEnabled ? formatCurrency(migrationCostCovered) : formatCurrency(customerMigrationCost)}
                tone={costModel.udmEnabled || customerMigrationCost <= 0 ? 'green' : undefined}
              />
            </div>
          </div>

          <BusinessPotentialStrip
            potential={businessPotential}
            companyName={reportCompanyName}
            providerLabel={providerLabel}
            termYears={termYears}
          />

          <div className="mb-6 rounded-lg border border-red-200 bg-bb-red-light p-4 keep-together">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-bb-red-dark">Your Backblaze B2 Storage Price</p>
                <p className="mt-1 text-xs text-gray-700">
                  This is the per-TB storage price used for the migrated storage scope and the estimated B2 monthly cost in this report.
                </p>
              </div>
              <div className="shrink-0 rounded-lg bg-white px-4 py-3 text-right ring-1 ring-red-100">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Provided Rate</p>
                <p className="font-display text-2xl font-bold leading-tight text-bb-red-dark">{b2StorageRateLabel}</p>
              </div>
            </div>
          </div>

          <ServiceTierComparisonCard tiers={serviceTierComparison} companyName={reportCompanyName} />

          <div className="mb-6 rounded-lg border border-gray-200 overflow-hidden print:break-inside-avoid">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Decision Summary</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                This estimate models the storage tiers selected for migration from {providerLabel} to Backblaze B2 for {reportCompanyName}.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-gray-200 text-sm">
              <DecisionMetric label="Your Current Modeled Cost" value={`${formatCurrency(modeledCurrentMonthly)}/mo`} />
              <DecisionMetric label="Estimated B2 Cost" value={`${formatCurrency(modeledB2Monthly)}/mo`} emphasis="red" />
              <DecisionMetric label="Your B2 Storage Price" value={b2StorageRateLabel} emphasis="red" />
              <DecisionMetric label="Modeled Storage Scope" value={`${formatReportStorage(migratedStorageGb)} across ${migratedTiers.length} tier${migratedTiers.length === 1 ? '' : 's'}`} />
              <DecisionMetric label="Migration Cost to You" value={formatCurrency(customerMigrationCost)} emphasis={customerMigrationCost <= 0 ? 'green' : undefined} />
              <DecisionMetric label={savingsTimingSummaryLabel} value={savingsTimingValue} emphasis={!hasCustomerMigrationPayback ? 'green' : undefined} />
              <DecisionMetric label="Projection Assumption" value={`${formatTermLabel(modelConfig.projectionTermMonths)} with ${growthLabel}`} />
              <DecisionMetric label="B2 Service Level" value={serviceTierComparison[0].customerLabel} />
              <DecisionMetric label="B2 Included Egress" value={hasUnlimitedEgress(b2ServiceTier) ? 'Unlimited, free' : '3x stored data free'} />
            </div>
          </div>

          <div className="mb-6 report-narrative-section">
            <h2 className="text-lg font-semibold mb-3 border-l-4 border-bb-red pl-3">What Does This Mean for {reportCompanyName}?</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              Based on the billing data provided, {reportCompanyName} can reduce modeled storage and data-access costs from {formatCurrency(modeledCurrentMonthly)}/month
              to {formatCurrency(modeledB2Monthly)}/month by moving {formatReportStorage(migratedStorageGb)} to Backblaze B2 Cloud Storage.
              This model uses your Backblaze B2 storage price of {b2StorageRateLabel}.
              That is an estimated savings of {formatCurrency(costModel.monthlySavings)}/month, {formatCurrency(costModel.annualSavings)}/year,
              and {formatCurrency(totalSavings)} over {formatTermLabel(modelConfig.projectionTermMonths)}.
              {costModel.udmEnabled
                ? ` Backblaze covers the estimated ${formatCurrency(migrationCostCovered)} migration cost through the Universal Data Migration program, so your modeled migration cost is $0.`
                : costModel.breakEvenMonth ? ` Your modeled migration cost of ${formatCurrency(customerMigrationCost)} is recovered within ${costModel.breakEvenMonth} month${costModel.breakEvenMonth !== 1 ? 's' : ''}.` : ''}
              {b2ServiceTier === 'overdrive'
                ? ` This model uses the Overdrive service tier, which includes unlimited free egress and zero API transaction fees — costs that would otherwise scale with usage on the Uncommitted or Committed tiers.`
                : b2ServiceTier === 'uncommitted'
                  ? ` ${reportCompanyName} is currently modeled on the Uncommitted (pay-as-you-go) tier; signing a contract unlocks the Committed tier's higher throughput and RPS ceiling at the same storage price.`
                  : ''}
            </p>
            {actionCostSummary.distinctCurrentCost > 0 && (
              <p className="mt-3 text-sm text-gray-700 leading-relaxed">
                The source bill also shows {formatCurrency(actionCostSummary.distinctCurrentCost)}/month in action-based fees tied to using the data, including {actionFeePhrases}.
                Because B2 standard transactions are free and B2 has no retrieval or restore fees, moving this data to B2 helps remove a cost center around actively using the data, not just storing it.
              </p>
            )}
            {costModel.partnerComputeScenario && (
              <p className="mt-3 text-sm text-gray-700 leading-relaxed">
                If the processed-data write path later moves to a B2 bandwidth alliance compute partner, this model avoids another {formatCurrency(costModel.partnerComputeScenario.monthlyEgressAvoided)}/month in hyperscaler egress and increases savings to {formatCurrency(costModel.partnerComputeScenario.monthlySavings)}/month.
              </p>
            )}
            <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="font-semibold text-gray-900 mb-1">Lower Recurring Spend</p>
                <p className="text-gray-600">The estimate compares your modeled monthly cost against B2 storage, egress, and transaction pricing.</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="font-semibold text-gray-900 mb-1">Fewer Variable Fees</p>
                <p className="text-gray-600">B2 removes modeled PUT/write-class and GET/read-class request charges, cold-tier access fees, and retrieval fees so usage does not become a separate cost center.</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="font-semibold text-gray-900 mb-1">Clear Migration Economics</p>
                <p className="text-gray-600">The report shows one-time migration cost, savings timing, and projected savings with growth.</p>
              </div>
            </div>
          </div>

          <ActionCostSignalSection actionCostSummary={actionCostSummary} providerLabel={providerLabel} />

          <SavingsDrivers
            costModel={costModel}
            modeledCurrentMonthly={modeledCurrentMonthly}
            modeledB2Monthly={modeledB2Monthly}
          />

          <PartnerScenarioComparison costModel={costModel} />

          {/* Surface negotiated/committed-use discounts detected on the source bill so the customer
              sees the comparison is against their real (already-discounted) rate, not list price —
              otherwise the savings look inflated and the prospect distrusts the whole report. */}
          {(() => {
            const programs = pricingDetection.filter(r => r.category === 'discount-program');
            if (programs.length === 0) return null;
            const effectiveRate = programs[0].effectiveRate;
            const listRate = programs[0].listRate;
            return (
              <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200 print:break-inside-avoid">
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                  <p className="text-sm font-semibold text-amber-800">Discounted Pricing Detected</p>
                </div>
                <p className="text-xs text-amber-700 mb-2">
                  This analysis reflects negotiated rates detected on your current bill, not generic list pricing. The following discount programs are included:
                </p>
                <div className="space-y-1">
                  {programs.map((p, i) => {
                    const pctOff = p.storagePercentOff || p.discountPercent || 0;
                    return (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-amber-800">
                          {p.programName}
                          {pctOff > 0 && (
                            <span className="text-amber-600 ml-1">(~{formatPercent(pctOff)} Off List)</span>
                          )}
                        </span>
                        <span className="font-medium text-amber-900">-{formatCurrency(p.totalAmountUsd || 0)}</span>
                      </div>
                    );
                  })}
                </div>
                {effectiveRate > 0 && listRate > 0 && (
                  <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between text-xs">
                    <span className="text-amber-800 font-medium">Effective Storage Rate</span>
                    <span className="font-semibold text-amber-900">
                      ~${(effectiveRate * 1000).toFixed(2)}/TB/mo
                      <span className="font-normal text-amber-600 ml-1">(List: ${(listRate * 1000).toFixed(2)}/TB)</span>
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Tier Comparison */}
      <div className="p-8">
        <h2 className="text-lg font-semibold mb-4 border-l-4 border-bb-red pl-3">Storage Tier Comparison</h2>
        <p className="text-sm text-gray-600 mb-4">
          These are the storage tiers included in the modeled migration. The B2 Cost column shows the estimated monthly B2 cost for each tier, and Savings shows the modeled monthly reduction.
        </p>
        <table className="w-full text-[11px]">
          <thead className="bg-bb-navy text-white">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Storage Tier</th>
              <th className="px-2 py-2 text-left font-medium">Region</th>
              <th className="px-2 py-2 text-left font-medium">Location</th>
              <th className="px-2 py-2 text-right font-medium">Stored</th>
              <th className="px-2 py-2 text-right font-medium">Current Cost</th>
              <th className="px-2 py-2 text-right font-medium">Effective Rate</th>
              <th className="px-2 py-2 text-right font-semibold bg-bb-red">B2 Cost</th>
              <th className="px-2 py-2 text-right font-medium">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {migratedTiers.map((tier) => {
              const location = getRegionLocation(tier.region);
              return (
                <tr key={tier.id}>
                  <td className="px-2 py-2 font-medium">{formatStorageTierName(tier.storageClass)}</td>
                  <td className="px-2 py-2 text-gray-700">{tier.region}</td>
                  <td className="px-2 py-2 text-gray-600">{location || '—'}</td>
                  <td className="px-2 py-2 text-right">{formatReportStorage(tier.gbStored)}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(tier.totalTrueCost)}</td>
                  <td className="px-2 py-2 text-right text-gray-600">{formatEffectiveRate(tier.effectivePerTb)}</td>
                  <td className="px-2 py-2 text-right bg-bb-red-light">
                    <span className="inline-flex rounded-md bg-white px-2 py-0.5 font-semibold text-bb-red-dark ring-1 ring-red-100">
                      {formatCurrency(tier.modeledB2Cost)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-green-700 font-medium">{formatCurrency(tier.delta)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="font-medium bg-gray-50">
            <tr>
              <td className="px-2 py-2" colSpan={3}>Total</td>
              <td className="px-2 py-2 text-right">{formatReportStorage(migratedTiers.reduce((s, t) => s + t.gbStored, 0))}</td>
              <td className="px-2 py-2 text-right">{formatCurrency(migratedTiers.reduce((s, t) => s + t.totalTrueCost, 0))}</td>
              <td className="px-2 py-2" />
              <td className="px-2 py-2 text-right bg-bb-red-light">
                <span className="inline-flex rounded-md bg-white px-2 py-0.5 font-semibold text-bb-red-dark ring-1 ring-red-100">
                  {formatCurrency(migratedTiers.reduce((s, t) => s + t.modeledB2Cost, 0))}
                </span>
              </td>
              <td className="px-2 py-2 text-right text-green-700">{formatCurrency(migratedTiers.reduce((s, t) => s + t.delta, 0))}</td>
            </tr>
          </tfoot>
        </table>

        {/* UDM on: present the egress/restore cost as covered by Backblaze ($0 to the customer).
            UDM off but a real migration cost exists: show it as a one-time charge. Otherwise (no
            migration cost) render nothing. */}
        {costModel.udmEnabled ? (
          <div className="mt-8 keep-together">
            <h3 className="text-sm font-semibold mb-3 border-l-4 border-bb-red pl-3">Data Migration</h3>
            <div className="p-4 bg-gray-50 rounded-lg mb-3">
              <p className="text-xs font-semibold text-gray-500 tracking-wide mb-2">Cost to Leave Hyperscaler</p>
              <div className="text-sm space-y-1">
                {costModel.migrationCost.egressCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">
                      Data egress at {meta.provider.toUpperCase()} list rate ({formatNumber(migratedTiers.reduce((s, t) => s + t.gbStored, 0))} GB)
                    </span>
                    <span>{formatCurrency(costModel.migrationCost.egressCost)}</span>
                  </div>
                )}
                {costModel.migrationCost.restoreCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cold-Tier Restore Fees</span>
                    <span>{formatCurrency(costModel.migrationCost.restoreCost)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
                  <span>Total Egress Cost</span>
                  <span>{formatCurrency(migrationCostCovered)}</span>
                </div>
              </div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-green-800">Covered by Backblaze</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    Backblaze covers this estimated migration egress cost through Universal Data Migration.
                  </p>
                  <p className="text-xs font-semibold text-green-800 mt-1">Your modeled migration cost is $0.</p>
                </div>
                <div className="shrink-0 rounded-lg bg-white px-4 py-3 text-right ring-1 ring-green-200">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700">Covered Amount</p>
                  <p className="text-2xl font-bold leading-tight text-green-800">{formatCurrency(migrationCostCovered)}</p>
                </div>
              </div>
            </div>
          </div>
        ) : (costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost) > 0 ? (
          <div className="mt-8 p-4 bg-amber-50 rounded-lg">
            <h3 className="text-sm font-semibold mb-2">One-Time Migration Cost</h3>
            <div className="text-sm space-y-1">
              {costModel.migrationCost.egressCost > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Data Egress from Hyperscaler</span>
                  <span>{formatCurrency(costModel.migrationCost.egressCost)}</span>
                </div>
              )}
              {costModel.migrationCost.restoreCost > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Cold-Tier Restore Fees</span>
                  <span>{formatCurrency(costModel.migrationCost.restoreCost)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-1">
                  <span>Total Migration Cost</span>
                <span>{formatCurrency(costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Projections */}
      <div className="p-8">
        <div className="keep-together">
          <h2 className="text-lg font-semibold mb-4 border-l-4 border-bb-red pl-3">Cost Projections ({termYears}-Year)</h2>
          <p className="text-sm text-gray-600 mb-6">
            Based on current pricing with {growthLabel}. Projected storage starts at {formatReportStorage(migratedStorageGb)} and reaches {formatReportStorage(endingProjectedStorageGb)} by the end of the term.
          </p>

          <ProjectionGraph
            points={projections}
            providerLabel={providerLabel}
            termMonths={modelConfig.projectionTermMonths}
            savingsTimingLabel={savingsTimingLabel}
            savingsTimingValue={savingsTimingValue}
            hasCustomerMigrationPayback={hasCustomerMigrationPayback}
          />
        </div>

        <table className="w-full text-xs">
          <thead className="bg-bb-navy text-white">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Projected Storage</th>
              <th className="px-3 py-2 text-right font-medium">Current Cost</th>
              <th className="px-3 py-2 text-right font-semibold bg-bb-red">B2 Cost</th>
              <th className="px-3 py-2 text-right font-medium">Monthly Savings</th>
              <th className="px-3 py-2 text-right font-medium">Cumulative Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {/* Show month 1, every 6th month, and the final month — a readable subset of the full
                monthly projection rather than dozens of rows. */}
            {projections
              .filter((_, i) => i === 0 || (i + 1) % 6 === 0 || i === projections.length - 1)
              .map((p) => (
                <tr key={p.month} className={p.cumulativeSavings >= 0 ? '' : 'text-gray-400'}>
                  <td className="px-3 py-2">{p.month}</td>
                  <td className="px-3 py-2 text-right">{formatReportStorage(p.storageGb)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(p.currentCost)}</td>
                  <td className="px-3 py-2 text-right bg-bb-red-light">
                    <span className="inline-flex rounded-md bg-white px-2 py-0.5 font-semibold text-bb-red-dark ring-1 ring-red-100">
                      {formatCurrency(p.b2Cost)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-green-700">{formatCurrency(p.monthlySavings)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(p.cumulativeSavings)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Assumptions */}
      <div className="p-8 print-page-break">
        <h2 className="text-lg font-semibold mb-4 border-l-4 border-bb-red pl-3">Assumptions & Sources</h2>
        <AssumptionSnapshot
          providerLabel={providerLabel}
          meta={meta}
          modelConfig={modelConfig}
          b2StorageRateLabel={b2StorageRateLabel}
          growthLabel={growthLabel}
          migratedStorageGb={migratedStorageGb}
          migratedTierCount={migratedTiers.length}
          customerMigrationCost={customerMigrationCost}
          udmEnabled={costModel.udmEnabled}
          b2ServiceTier={b2ServiceTier}
        />
        <table className="w-full text-sm">
          <tbody className="divide-y">
            <tr>
              <td className="py-2 font-medium text-gray-600 w-1/3">Source Bill</td>
              <td className="py-2">{meta.provider.toUpperCase()} {meta.billType} — {meta.billingPeriod || 'N/A'}</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Your B2 Storage Price</td>
              <td className="py-2">{b2StorageRateLabel} (List: {formatCurrency(b2Pricing.storage.perTbMonth)}/TB/month)</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">B2 Service Level</td>
              <td className="py-2">
                {serviceTierComparison[0].customerLabel} — {formatThroughput(serviceTierComparison[0].throughputGbitGet)} GET / {formatThroughput(serviceTierComparison[0].throughputGbitPut)} PUT
              </td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">B2 Transactions</td>
              <td className="py-2">Free for standard API classes, including PUT/write-class and GET/read-class request charges</td>
            </tr>
            {actionCostSummary.putRelated.currentCost > 0 && (
              <tr>
                <td className="py-2 font-medium text-gray-600">PUT / Write-Class Charges</td>
                <td className="py-2">
                  {formatCurrency(actionCostSummary.putRelated.currentCost)}/mo identified across {formatActionSignal(actionCostSummary.putRelated)}; modeled B2 standard transaction cost is $0.00
                </td>
              </tr>
            )}
            {actionCostSummary.getRelated.currentCost > 0 && (
              <tr>
                <td className="py-2 font-medium text-gray-600">GET / Read-Class Charges</td>
                <td className="py-2">
                  {formatCurrency(actionCostSummary.getRelated.currentCost)}/mo identified across {formatActionSignal(actionCostSummary.getRelated)}; modeled B2 standard transaction cost is $0.00
                </td>
              </tr>
            )}
            {coldTierAccess.totalCost > 0 && (
              <tr>
                <td className="py-2 font-medium text-gray-600">Cold-Tier Access Charges</td>
                <td className="py-2">{formatCurrency(coldTierAccess.totalCost)}/mo identified in AWS S3 or GCS retrieval, restore, tiering, early deletion, or cold-tier operation rows; B2 has no retrieval or restore fees</td>
              </tr>
            )}
            <tr>
              <td className="py-2 font-medium text-gray-600">B2 Egress</td>
              <td className="py-2">
                {hasUnlimitedEgress(b2ServiceTier) ? 'Unlimited, free (Overdrive tier)' : '3x stored data free, $0.01/GB overage'}
              </td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Growth Model</td>
              <td className="py-2">{growthLabel}</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Projection Term</td>
              <td className="py-2">{modelConfig?.projectionTermMonths || 12} months</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Modeled Scope</td>
              <td className="py-2">{formatReportStorage(migratedStorageGb)} across {migratedTiers.length} storage tier{migratedTiers.length === 1 ? '' : 's'} selected for B2 migration</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Migration Cost to You</td>
              <td className="py-2">{formatCurrency(customerMigrationCost)}{costModel.udmEnabled ? ' through Backblaze Universal Data Migration' : ''}</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Pricing Date</td>
              <td className="py-2">June 2026 (verified against published rates)</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-8 p-4 bg-gray-50 rounded-lg keep-together">
          <p className="text-xs text-gray-500 leading-relaxed">
            This report is intended to help you evaluate whether moving the modeled storage scope to Backblaze B2 improves your storage economics.
            It is based on the billing data provided and current published pricing.
            Actual costs may vary based on usage patterns, negotiated rates, and pricing changes.
            All B2 pricing reflects standard pay-as-you-go rates unless otherwise noted.
            Migration costs are one-time estimates based on hyperscaler egress rates at the time of analysis.
          </p>
        </div>

        <div className="mt-8 pt-4 border-t-2 border-bb-red flex items-center justify-between gap-4 text-sm text-gray-400">
          <BackblazeLogo compact />
          <p className="min-w-0 flex-1 text-right leading-snug">
            <span className="block">
              Prepared by {aeInfo
                ? `${aeInfo.name}${aeInfo.title ? `, ${aeInfo.title}` : ''} (${aeInfo.email})`
                : 'Backblaze'}
            </span>
            <span className="block">Backblaze | {new Date().toLocaleDateString()}</span>
          </p>
        </div>
      </div>
    </div>
    </div>
    </>
  );
}

/** A single headline stat tile in the executive summary. `tone="green"` flags a favorable value. */
function OutcomeMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green';
}) {
  const valueColor = tone === 'green' ? 'text-green-700' : 'text-gray-900';

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 font-display text-lg font-bold leading-tight ${valueColor}`}>{value}</p>
    </div>
  );
}

/**
 * "What this unlocks" — the value-in counterpart to the savings hero. Up to three tiles built from
 * the customer's own numbers: storage-capacity headroom and free egress (aimed at the technical
 * buyer), and reclaimable capital (aimed at the financial buyer). Tiles drop out when the bill
 * doesn't support the claim, and the strip renders nothing if none qualify, so it never shows an
 * empty band or an unsupported "NaN" figure.
 */
function BusinessPotentialStrip({
  potential,
  companyName,
  providerLabel,
  termYears,
}: {
  potential: BusinessPotential;
  companyName: string;
  providerLabel: string;
  termYears: number;
}) {
  const tiles: Array<{
    key: string;
    value: string;
    label: string;
    support: string;
    tone: 'red' | 'green';
  }> = [];

  if (potential.hasCapacityUnlock) {
    tiles.push({
      key: 'capacity',
      value: formatCapacityMultiplier(potential.capacityMultiplier),
      label: 'More data for the same storage budget',
      support: `Your effective storage rate drops from ${formatEffectiveRate(potential.currentStoragePerTb)} to ${formatEffectiveRate(potential.b2StoragePerTb)}, so the budget you spend on storage today stretches much further on Backblaze B2.`,
      tone: 'red',
    });
  }

  if (potential.freeEgressGbPerMonth > 0) {
    tiles.push({
      key: 'egress',
      value: `${formatReportStorage(potential.freeEgressGbPerMonth)}/mo`,
      label: 'Egress included free every month',
      support: potential.eliminatedEgressMonthly > 0
        ? `${providerLabel} bills you to move your own data — about ${formatCurrency(potential.eliminatedEgressMonthly)}/month on this scope today. B2 includes 3x your stored data, so you can use and share it without the per-GB egress toll.`
        : `B2 includes 3x your stored data in free egress, so reading, serving, and sharing it stops being a metered cost the way it is on ${providerLabel}.`,
      tone: 'green',
    });
  }

  // Avoid a lonely single tile (e.g. an archive-heavy bill that priced below B2 on storage alone, so
  // there's no capacity unlock to show): fall back to the reclaimable-capital framing for finance.
  if (tiles.length < 2 && potential.hasReclaimableCapital) {
    tiles.push({
      key: 'capital',
      value: `${formatCurrency(potential.annualSavings)}/yr`,
      label: 'Freed up to reinvest in the business',
      support: `About ${formatPercent(potential.reclaimedPercent)} of your storage spend comes back as budget — ${formatCurrency(potential.cumulativeSavings)} over ${termYears} year${termYears === 1 ? '' : 's'} — to redirect toward growth.`,
      tone: 'green',
    });
  }

  if (tiles.length === 0) return null;

  const gridCols = tiles.length >= 3 ? 'md:grid-cols-3' : tiles.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1';

  return (
    <div className="mb-6 rounded-lg border border-gray-200 p-4 keep-together">
      <h2 className="border-l-4 border-bb-red pl-3 text-base font-semibold text-gray-900">What This Unlocks for {companyName}</h2>
      <p className="mb-4 mt-1 pl-3 text-xs text-gray-500">
        Beyond the line-item savings, the same migration economics create room to grow — every figure below is drawn from your bill.
      </p>
      <div className={`grid grid-cols-1 gap-3 ${gridCols}`}>
        {tiles.map((tile) => (
          <PotentialTile key={tile.key} value={tile.value} label={tile.label} support={tile.support} tone={tile.tone} />
        ))}
      </div>
    </div>
  );
}

/** One tile in the "What this unlocks" strip: a big headline figure with a label and a one-line
 *  plain-language explanation. `tone` tints the figure B2 red (capability) or green (financial). */
function PotentialTile({
  value,
  label,
  support,
  tone,
}: {
  value: string;
  label: string;
  support: string;
  tone: 'red' | 'green';
}) {
  const valueColor = tone === 'green' ? 'text-green-700' : 'text-bb-red-dark';
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className={`font-display text-2xl font-bold leading-tight ${valueColor}`}>{value}</p>
      <p className="mt-2 text-sm font-semibold text-gray-900">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">{support}</p>
    </div>
  );
}

/**
 * "Action Fees B2 Removes" panel: itemizes per-operation charges on the source bill (PUT/GET
 * requests, cold-tier access/restore) that B2 eliminates. Renders nothing when none are present.
 */
function ActionCostSignalSection({
  actionCostSummary,
  providerLabel,
}: {
  actionCostSummary: OperationActionCostSummary;
  providerLabel: string;
}) {
  const rows: Array<{
    id: 'put' | 'get' | 'cold';
    label: string;
    description: string;
    currentCost: number;
    b2Label: string;
    b2Detail: string;
    signal: string;
    tone: 'red' | 'sky' | 'orange';
  }> = [];

  if (actionCostSummary.putRelated.currentCost > 0) {
    rows.push({
      id: 'put',
      label: 'PUT / Write-Class Requests',
      description: 'Source bill rows for PUT, upload, write, copy, post, delete, or Class A style operations.',
      currentCost: actionCostSummary.putRelated.currentCost,
      b2Label: '$0.00',
      b2Detail: 'Free standard B2 transactions',
      signal: formatActionSignal(actionCostSummary.putRelated),
      tone: 'red',
    });
  }

  if (actionCostSummary.getRelated.currentCost > 0) {
    rows.push({
      id: 'get',
      label: 'GET / Read-Class Requests',
      description: 'Source bill rows for GET, download, read, select, head, or Class B style operations.',
      currentCost: actionCostSummary.getRelated.currentCost,
      b2Label: '$0.00',
      b2Detail: 'Free standard B2 transactions',
      signal: formatActionSignal(actionCostSummary.getRelated),
      tone: 'sky',
    });
  }

  if (actionCostSummary.coldTierAccess.totalCost > 0) {
    rows.push({
      id: 'cold',
      label: 'Cold-Tier Access, Tiering, and Restore Fees',
      description: 'Source bill rows for retrieval, restore, lifecycle/tiering, early deletion, minimum-duration, or cold-tier operation fees.',
      currentCost: actionCostSummary.coldTierAccess.totalCost,
      b2Label: 'No retrieval or restore fees',
      b2Detail: 'No cold-access exposure on B2',
      signal: formatLineUsageSignal(
        actionCostSummary.coldTierAccess.lineCount,
        actionCostSummary.coldTierAccess.usageQuantity,
        actionCostSummary.coldTierAccess.usageUnit,
      ),
      tone: 'orange',
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 keep-together">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-green-900">Action Fees B2 Removes</p>
          <p className="mt-1 text-xs leading-relaxed text-green-800">
            The {providerLabel} bill includes action-based charges that are either free standard operations on B2 or avoided cold-tier access exposure.
          </p>
        </div>
        <div className="shrink-0 rounded-lg bg-white px-4 py-3 text-right ring-1 ring-green-200">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700">Identified Today</p>
          <p className="text-xl font-bold leading-tight text-green-900">{formatCurrency(actionCostSummary.distinctCurrentCost)}/mo</p>
          <p className="mt-0.5 text-[10px] text-green-700">{actionCostSummary.distinctLineCount} bill line{actionCostSummary.distinctLineCount === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-green-200 bg-white">
        <div className="report-action-fees-header hidden grid-cols-[minmax(0,1.35fr)_0.6fr_0.8fr_0.65fr] gap-3 bg-green-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-white md:grid">
          <span>Action Charge</span>
          <span className="text-right">Current Cost</span>
          <span className="text-right">B2 Cost</span>
          <span className="text-right">Signal</span>
        </div>
        <div className="divide-y divide-green-100">
          {rows.map((row) => {
            const toneClasses = getActionSignalToneClasses(row.tone);
            return (
              <div key={row.id} className="report-action-fees-row grid grid-cols-1 gap-3 px-3 py-3 text-xs md:grid-cols-[minmax(0,1.35fr)_0.6fr_0.8fr_0.65fr] md:items-start">
                <div className="min-w-0">
                  <p className={`font-semibold ${toneClasses.title}`}>{row.label}</p>
                  <p className="mt-1 leading-relaxed text-gray-600">{row.description}</p>
                  {row.id === 'cold' && actionCostSummary.coldTierAccess.groups.length > 0 && (
                    <div className="report-action-fees-detail-grid mt-2 grid gap-1.5 md:grid-cols-2">
                      {actionCostSummary.coldTierAccess.groups.slice(0, 4).map((group) => (
                        <div key={group.id} className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ring-1 ${toneClasses.detail}`}>
                          <span className="min-w-0 truncate text-[10px] font-medium">{group.label}</span>
                          <span className="shrink-0 text-[10px] font-semibold">{formatCurrency(group.cost)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="report-action-fees-right min-w-0 md:text-right">
                  <p className="report-action-fees-mobile-label text-[10px] font-semibold uppercase tracking-wide text-gray-500 md:hidden">Current Cost</p>
                  <p className={`font-bold ${toneClasses.title}`}>{formatCurrency(row.currentCost)}/mo</p>
                </div>
                <div className="report-action-fees-right min-w-0 md:text-right">
                  <p className="report-action-fees-mobile-label text-[10px] font-semibold uppercase tracking-wide text-gray-500 md:hidden">B2 Cost</p>
                  <p className="font-bold text-green-700">{row.b2Label}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-green-700">{row.b2Detail}</p>
                </div>
                <div className="report-action-fees-right min-w-0 md:text-right">
                  <p className="report-action-fees-mobile-label text-[10px] font-semibold uppercase tracking-wide text-gray-500 md:hidden">Signal</p>
                  <p className="font-medium text-gray-700">{row.signal}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getActionSignalToneClasses(tone: 'red' | 'sky' | 'orange'): {
  title: string;
  detail: string;
} {
  switch (tone) {
    case 'red':
      return {
        title: 'text-red-900',
        detail: 'bg-red-50 text-red-900 ring-red-100',
      };
    case 'sky':
      return {
        title: 'text-sky-900',
        detail: 'bg-sky-50 text-sky-900 ring-sky-100',
      };
    case 'orange':
      return {
        title: 'text-orange-900',
        detail: 'bg-orange-50 text-orange-900 ring-orange-100',
      };
  }
}

function formatActionSignal(detail: ActionCostDetail): string {
  return formatLineUsageSignal(detail.lineCount, detail.usageQuantity, detail.usageUnit);
}

// "Signal" = evidence shown to the customer for an action-fee row: how many bill lines it spans and
// the underlying usage quantity, e.g. "3 lines - 1,200,000 requests". Usage is omitted when unknown.
function formatLineUsageSignal(lineCount: number, usageQuantity: number, usageUnit?: string): string {
  const lineLabel = `${lineCount} line${lineCount === 1 ? '' : 's'}`;
  if (usageQuantity <= 0) return lineLabel;
  return `${lineLabel} - ${formatNumber(usageQuantity, 0)}${usageUnit ? ` ${usageUnit}` : ''}`;
}

/**
 * "Where the Savings Come From" — a two-column bar comparison of current monthly fees removed
 * versus the recurring B2 replacement cost that takes their place.
 */
function SavingsDrivers({
  costModel,
  modeledCurrentMonthly,
  modeledB2Monthly,
}: {
  costModel: CostModelResult;
  modeledCurrentMonthly: number;
  modeledB2Monthly: number;
}) {
  const replacementCosts = [
    { description: 'Backblaze B2 replacement cost', amountUsd: costModel.b2Monthly.total },
    ...costModel.newCosts,
  ].filter((row) => row.amountUsd > 0);
  // Single scale shared across both columns so bar lengths are visually comparable side to side;
  // floored at 1 to avoid divide-by-zero when there are no fees.
  const maxAmount = Math.max(
    1,
    ...costModel.eliminatedFees.map((fee) => fee.amountUsd),
    ...replacementCosts.map((cost) => cost.amountUsd),
  );

  return (
    <div className="mb-6 rounded-lg border border-gray-200 p-4 keep-together">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Where the Savings Come From</h2>
          <p className="mt-1 text-xs text-gray-500">
            Monthly fees removed from the modeled scope compared with the recurring B2 replacement cost.
          </p>
        </div>
        <div className="shrink-0 border-l border-gray-200 pl-4 text-right">
          <p className="text-xs text-gray-600">Net Monthly Savings</p>
          <p className="text-xl font-bold text-green-700">{formatCurrency(costModel.monthlySavings)}</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
        <div>
          <div className="mb-2 flex justify-between text-xs font-semibold text-gray-600">
            <span>Current fees removed</span>
            <span>{formatCurrency(modeledCurrentMonthly)}</span>
          </div>
          <div className="space-y-2">
            {costModel.eliminatedFees.map((fee) => (
              <SavingsDriverRow
                key={`${fee.category}-${fee.description}`}
                label={fee.description}
                amount={fee.amountUsd}
                maxAmount={maxAmount}
                tone="savings"
              />
            ))}
          </div>
        </div>

        <div className="w-px bg-gray-200" />

        <div>
          <div className="mb-2 flex justify-between text-xs font-semibold text-gray-600">
            <span>B2 replacement costs</span>
            <span>{formatCurrency(modeledB2Monthly)}</span>
          </div>
          <div className="space-y-2">
            {replacementCosts.map((cost) => (
              <SavingsDriverRow
                key={cost.description}
                label={cost.description}
                amount={cost.amountUsd}
                maxAmount={maxAmount}
                tone="cost"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SavingsDriverRow({
  label,
  amount,
  maxAmount,
  tone,
}: {
  label: string;
  amount: number;
  maxAmount: number;
  tone: 'savings' | 'cost';
}) {
  // Clamp to a 5%–100% bar so even a tiny non-zero amount stays visible rather than collapsing.
  const width = `${Math.max(5, Math.min(100, (amount / maxAmount) * 100))}%`;
  const barColor = tone === 'savings' ? 'bg-green-600' : 'bg-bb-red';
  const amountColor = tone === 'savings' ? 'text-green-700' : 'text-bb-red-dark';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className="text-gray-600">{label}</span>
        <span className={`font-semibold ${amountColor}`}>{formatCurrency(amount)}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${barColor}`} style={{ width }} />
      </div>
    </div>
  );
}

/**
 * Optional upside panel: if the write path later moves to a B2 bandwidth-alliance compute partner,
 * additional hyperscaler egress is avoided. Hidden unless the model produced this scenario.
 */
function PartnerScenarioComparison({ costModel }: { costModel: CostModelResult }) {
  if (!costModel.partnerComputeScenario) return null;

  const scenario = costModel.partnerComputeScenario;
  // Incremental savings over the primary case — what the partner-compute path adds on top.
  const addedMonthlyValue = scenario.monthlySavings - costModel.monthlySavings;

  return (
    <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 p-4 keep-together">
      <h2 className="text-base font-semibold text-gray-900">Optional Partner Compute Scenario</h2>
      <p className="mt-1 text-xs text-sky-800">
        If the processed-data write path moves to a B2 bandwidth alliance compute partner, this model avoids additional hyperscaler egress.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <ScenarioMetric label="Primary Monthly Savings" value={formatCurrency(costModel.monthlySavings)} />
        <ScenarioMetric label="Partner Compute Savings" value={formatCurrency(scenario.monthlySavings)} tone="green" />
        <ScenarioMetric label="Added Monthly Value" value={formatCurrency(addedMonthlyValue)} tone="green" />
      </div>
    </div>
  );
}

function ScenarioMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green';
}) {
  return (
    <div className="border-l border-sky-200 pl-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone === 'green' ? 'text-green-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

/**
 * Hand-rolled SVG line chart of the projected monthly cost curves (current vs. B2) with the savings
 * gap shaded and the break-even / savings-start moment marked. Built inline (no chart library) so it
 * renders identically in the browser and the print-to-PDF path.
 */
function ProjectionGraph({
  points,
  providerLabel,
  termMonths,
  savingsTimingLabel,
  savingsTimingValue,
  hasCustomerMigrationPayback,
}: {
  points: ProjectionPoint[];
  providerLabel: string;
  termMonths: number;
  savingsTimingLabel: string;
  savingsTimingValue: string;
  hasCustomerMigrationPayback: boolean;
}) {
  if (points.length === 0) return null;

  // SVG viewBox geometry, in user units. left/bottom are larger to leave room for axis labels.
  const width = 760;
  const height = 310;
  const left = 68;
  const right = 30;
  const top = 24;
  const bottom = 44;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxCost = getNiceChartMax(Math.max(...points.map((p) => Math.max(p.currentCost, p.b2Cost)), 1));
  const currentCoords = points.map((point) => ({
    x: xForMonth(point.month, termMonths, left, chartWidth),
    y: yForValue(point.currentCost, maxCost, top, chartHeight),
  }));
  const b2Coords = points.map((point) => ({
    x: xForMonth(point.month, termMonths, left, chartWidth),
    y: yForValue(point.b2Cost, maxCost, top, chartHeight),
  }));
  const currentPath = buildLinePath(currentCoords);
  const b2Path = buildLinePath(b2Coords);
  const gapPath = buildAreaPath(currentCoords, b2Coords);
  const ticks = getProjectionTicks(termMonths);
  const yTicks = [0, maxCost / 2, maxCost];
  // The marked moment: first month cumulative savings turn non-negative (break-even) when there's a
  // migration cost, otherwise month 1 (savings from day one).
  const timingPoint = hasCustomerMigrationPayback
    ? points.find((point) => point.cumulativeSavings >= 0)
    : points[0];
  const timingMonthLabel = timingPoint ? `Month ${timingPoint.month}` : savingsTimingValue;
  const timingMarkerLabel = timingPoint
    ? `${savingsTimingLabel}: ${timingMonthLabel}`
    : savingsTimingLabel;
  const timingX = timingPoint ? xForMonth(timingPoint.month, termMonths, left, chartWidth) : 0;
  // Keep the dashed marker line and its label box inside the plot area regardless of where the
  // timing point falls (e.g. break-even at month 1 or near the end of the term).
  const timingLineX = Math.max(left + 2, Math.min(left + chartWidth - 2, timingX));
  const timingLabelWidth = hasCustomerMigrationPayback ? 134 : 146;
  const timingLabelX = Math.min(
    left + chartWidth - timingLabelWidth - 8,
    Math.max(left + 8, timingX + 8),
  );
  const finalPoint = points[points.length - 1];

  return (
    <div className="mb-6 rounded-lg border border-gray-200 p-4 keep-together">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Projected Monthly Cost Curve</h3>
          <p className="mt-1 text-xs text-gray-500">
            The shaded gap is the modeled monthly savings between {providerLabel} and Backblaze B2.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-gray-500">{savingsTimingLabel}</p>
          <p className="text-base font-bold text-gray-900">{savingsTimingValue}</p>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-600">
        <GraphLegend colorClass="bg-slate-500" label={providerLabel} />
        <GraphLegend colorClass="bg-bb-red" label="Backblaze B2" />
        <GraphLegend colorClass="bg-green-600" label="Monthly Savings Gap" />
      </div>
      <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Projected monthly cost comparison">
        <rect x={left} y={top} width={chartWidth} height={chartHeight} fill="#f8fafc" rx="6" />
        {yTicks.map((tick) => {
          const y = yForValue(tick, maxCost, top, chartHeight);
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={left + chartWidth} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">
                {formatCompactCurrency(tick)}
              </text>
            </g>
          );
        })}
        {ticks.map((tick) => {
          const x = xForMonth(tick, termMonths, left, chartWidth);
          return (
            <g key={tick}>
              <line x1={x} y1={top} x2={x} y2={top + chartHeight} stroke="#edf2f7" strokeWidth="1" />
              <text x={x} y={height - 16} textAnchor="middle" fontSize="11" fill="#6b7280">
                {formatProjectionMonthTick(tick)}
              </text>
            </g>
          );
        })}
        <path d={gapPath} fill="#16a34a" opacity="0.14" />
        <path d={currentPath} fill="none" stroke="#64748b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={b2Path} fill="none" stroke="#e20626" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        {timingPoint && (
          <g>
            <line
              x1={timingLineX}
              y1={top}
              x2={timingLineX}
              y2={top + chartHeight}
              stroke={hasCustomerMigrationPayback ? '#111827' : '#047857'}
              strokeDasharray="5 5"
              strokeWidth="1.2"
            />
            <rect
              x={timingLabelX}
              y={top + 8}
              width={timingLabelWidth}
              height="22"
              rx="5"
              fill={hasCustomerMigrationPayback ? '#111827' : '#047857'}
            />
            <text
              x={timingLabelX + timingLabelWidth / 2}
              y={top + 23}
              textAnchor="middle"
              fontSize="11"
              fill="#ffffff"
            >
              {timingMarkerLabel}
            </text>
          </g>
        )}
        <text x={left + chartWidth - 4} y={currentCoords[currentCoords.length - 1].y - 8} textAnchor="end" fontSize="11" fill="#475569">
          {formatCompactCurrency(finalPoint.currentCost)}/mo
        </text>
        <text x={left + chartWidth - 4} y={b2Coords[b2Coords.length - 1].y + 16} textAnchor="end" fontSize="11" fill="#b40a23">
          {formatCompactCurrency(finalPoint.b2Cost)}/mo
        </text>
        <line x1={left} y1={top + chartHeight} x2={left + chartWidth} y2={top + chartHeight} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={left} y1={top} x2={left} y2={top + chartHeight} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
    </div>
  );
}

function GraphLegend({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
      {label}
    </span>
  );
}

/** Compact grid of the headline modeling assumptions, shown above the full assumptions table. */
function AssumptionSnapshot({
  providerLabel,
  meta,
  modelConfig,
  b2StorageRateLabel,
  growthLabel,
  migratedStorageGb,
  migratedTierCount,
  customerMigrationCost,
  udmEnabled,
  b2ServiceTier,
}: {
  providerLabel: string;
  meta: Analysis;
  modelConfig: ModelConfig;
  b2StorageRateLabel: string;
  growthLabel: string;
  migratedStorageGb: number;
  migratedTierCount: number;
  customerMigrationCost: number;
  udmEnabled: boolean;
  b2ServiceTier: B2ServiceTier;
}) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 text-xs keep-together">
      <AssumptionItem label="Source Bill" value={`${providerLabel} ${meta.billType}${meta.billingPeriod ? `, ${meta.billingPeriod}` : ''}`} />
      <AssumptionItem label="Modeled Scope" value={`${formatReportStorage(migratedStorageGb)} across ${migratedTierCount} tier${migratedTierCount === 1 ? '' : 's'}`} />
      <AssumptionItem label="Projection" value={`${formatTermLabel(modelConfig.projectionTermMonths)} with ${growthLabel}`} />
      <AssumptionItem label="Your B2 Storage Price" value={b2StorageRateLabel} />
      <AssumptionItem label="B2 Service Level" value={getServiceTierSpec(b2ServiceTier).customerLabel} />
      <AssumptionItem label="B2 Egress" value={hasUnlimitedEgress(b2ServiceTier) ? 'Unlimited, free' : '3x stored data free, then $0.01/GB'} />
      <AssumptionItem
        label="Migration Cost to You"
        value={udmEnabled ? '$0 through Universal Data Migration' : formatCurrency(customerMigrationCost)}
      />
    </div>
  );
}

function AssumptionItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="font-medium text-gray-500">{label}</p>
      <p className="mt-1 font-semibold text-gray-900">{value}</p>
    </div>
  );
}

/** One cell in the Decision Summary grid. `emphasis` tints the value green (good) or B2 red (B2 figure). */
function DecisionMetric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: 'green' | 'red';
}) {
  const valueColor = emphasis === 'green'
    ? 'text-green-700'
    : emphasis === 'red'
      ? 'text-bb-red-dark'
      : 'text-gray-900';

  return (
    <div className="bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 font-display text-base font-bold ${valueColor}`}>{value}</p>
    </div>
  );
}

/** Service-level comparison: the modeled tier, and the one tier up when there is one. */
function ServiceTierComparisonCard({
  tiers,
  companyName,
}: {
  tiers: ServiceTierSpec[];
  companyName: string;
}) {
  const modeled = tiers[0];
  const upgrade = tiers[1] ?? null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 overflow-hidden print:break-inside-avoid keep-together">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">
          {upgrade ? 'Your tier — and the ceiling above it' : 'Your B2 service level'}
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {upgrade
            ? `${companyName} is modeled on ${modeled.customerLabel}. ${upgrade.customerLabel} is there when throughput demands it.`
            : `${companyName} is modeled on ${modeled.customerLabel} — Backblaze's top service level.`}
        </p>
      </div>
      <div className={`grid ${upgrade ? 'grid-cols-[1fr_1fr]' : 'grid-cols-[1fr]'}`}>
        <ServiceTierPanel spec={modeled} role="modeled" />
        {upgrade && <ServiceTierPanel spec={upgrade} role="upgrade" />}
      </div>
    </div>
  );
}

/**
 * One tier panel, framed as an upgrade path rather than a comparison of equals: the modeled tier is
 * "Your plan"; the tier above is a purple-tinted "Upgrade path" so it reads as optional headroom, not
 * what the customer bought. GET/PUT collapse to one paired line so each figure survives print.
 */
function ServiceTierPanel({ spec, role }: { spec: ServiceTierSpec; role: 'modeled' | 'upgrade' }) {
  const isUpgrade = role === 'upgrade';
  const valueClass = isUpgrade ? 'text-bb-purple' : 'text-gray-900';
  return (
    <div className={`p-4 ${isUpgrade ? 'border-l border-gray-200 bg-bb-purple-soft' : 'bg-white'}`}>
      <div className="mb-3 flex items-center gap-2">
        <p className={`font-display text-[15px] font-bold ${isUpgrade ? 'text-bb-purple' : 'text-gray-900'}`}>{spec.customerLabel}</p>
        {isUpgrade ? (
          <span className="rounded bg-bb-purple-pale px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-bb-purple">Upgrade path</span>
        ) : (
          <span className="rounded bg-bb-navy px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Your plan</span>
        )}
      </div>
      <div className="text-xs">
        <PanelSpec label="Bandwidth GET / PUT" valueClass={valueClass}>
          {pairedThroughput(spec)}
          {spec.throughputGbitMax != null && (
            <span className="ml-1 text-[10px] font-normal text-gray-400">→ {formatThroughput(spec.throughputGbitMax)}</span>
          )}
        </PanelSpec>
        <PanelSpec label="Requests / sec" valueClass={valueClass}>
          {spec.rpsGet === null ? 'Scales w/ throughput' : spec.rpsGet.toLocaleString()}
        </PanelSpec>
        <PanelSpec label="Included egress" valueClass={valueClass} last>
          {spec.unlimitedEgress ? 'Unlimited' : '3× stored'}
        </PanelSpec>
      </div>
    </div>
  );
}

/** One labeled figure inside a tier panel: a small caption above a display-weight value. */
function PanelSpec({ label, valueClass, last, children }: { label: string; valueClass: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`py-1.5 ${last ? '' : 'border-b border-gray-100'}`}>
      <span className="block text-[10px] text-gray-400">{label}</span>
      <span className={`font-display text-[13px] font-semibold ${valueClass}`}>{children}</span>
    </div>
  );
}

/** Paired GET / PUT throughput for a tier panel, e.g. "50 / 50 Gbit/s" (rolls to Tbps at ≥1000). */
function pairedThroughput(spec: ServiceTierSpec): string {
  const rollsToTbps = spec.throughputGbitGet >= 1000 || spec.throughputGbitPut >= 1000;
  const fmt = (n: number) => (rollsToTbps ? (n / 1000).toLocaleString() : n.toLocaleString());
  return `${fmt(spec.throughputGbitGet)} / ${fmt(spec.throughputGbitPut)} ${rollsToTbps ? 'Tbps' : 'Gbit/s'}`;
}

// Pick a readable set of x-axis month ticks scaled to the term length (denser for short terms,
// sparser past a few years), always clamped to months that actually exist in the projection.
function getProjectionTicks(termMonths: number): number[] {
  if (termMonths <= 12) return [1, 3, 6, 9, 12].filter((month) => month <= termMonths);
  if (termMonths <= 24) return [1, 6, 12, 18, 24].filter((month) => month <= termMonths);
  if (termMonths <= 36) return [1, 6, 12, 18, 24, 30, 36].filter((month) => month <= termMonths);
  return [1, 12, 24, 36, 48, 60].filter((month) => month <= termMonths);
}

function formatProjectionMonthTick(value: number): string {
  if (value > 0 && value % 12 === 0) return `${value / 12}Y`;
  return `M${value}`;
}

// Abbreviated currency for axis labels and end-of-line callouts (e.g. $1.2M, $850k). Fewer decimals
// at larger magnitudes to keep tick labels short; falls back to full formatting under $1k.
function formatCompactCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1_000_000) {
    const decimals = abs >= 10_000_000 ? 0 : 1;
    return `${sign}$${(abs / 1_000_000).toFixed(decimals)}M`;
  }

  if (abs >= 1_000) {
    const decimals = abs >= 100_000 ? 0 : 1;
    return `${sign}$${(abs / 1_000).toFixed(decimals)}k`;
  }

  return formatCurrency(value, 0);
}

// Round a max value up to a "nice" round number (1/2/5 x a power of ten) so the y-axis top and its
// half-way tick land on clean figures instead of an arbitrary peak cost.
function getNiceChartMax(value: number): number {
  const safeValue = Math.max(value, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(safeValue)));
  const normalized = safeValue / magnitude;
  const niceNormalized = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

// Map a 1-based month onto an x pixel. A single-month term has no span to divide by, so pin to the
// left edge to avoid a NaN coordinate.
function xForMonth(month: number, termMonths: number, left: number, chartWidth: number): number {
  if (termMonths <= 1) return left;
  return left + ((month - 1) / (termMonths - 1)) * chartWidth;
}

function yForValue(value: number, maxValue: number, top: number, chartHeight: number): number {
  return top + (1 - value / maxValue) * chartHeight;
}

function buildLinePath(coords: { x: number; y: number }[]): string {
  return coords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'} ${formatSvgNumber(coord.x)} ${formatSvgNumber(coord.y)}`)
    .join(' ');
}

// Build the closed polygon for the shaded savings gap: trace the top (current-cost) line forward,
// then the bottom (B2) line in reverse so the path closes cleanly into a filled band.
function buildAreaPath(topCoords: { x: number; y: number }[], bottomCoords: { x: number; y: number }[]): string {
  if (topCoords.length === 0 || bottomCoords.length === 0) return '';

  const upper = topCoords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'} ${formatSvgNumber(coord.x)} ${formatSvgNumber(coord.y)}`)
    .join(' ');
  const lower = [...bottomCoords]
    .reverse()
    .map((coord) => `L ${formatSvgNumber(coord.x)} ${formatSvgNumber(coord.y)}`)
    .join(' ');
  return `${upper} ${lower} Z`;
}

function formatSvgNumber(value: number): string {
  return value.toFixed(1);
}

function ReportLoading() {
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
