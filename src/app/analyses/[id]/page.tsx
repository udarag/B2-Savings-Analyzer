'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Analysis, ParsedBill, ModelConfig, TierInventoryRow, EgressConfig, Provider, B2ServiceTier } from '@/types/analysis';
import { TIER_SELECTION_VERSION } from '@/types/analysis';
import { buildTierState, computeAnalysisView } from '@/lib/analysis/analysis-model';
import { ParseReview } from '@/components/upload/ParseReview';
import { TierInventory } from '@/components/dashboard/TierInventory';
import { EgressQuestionnaire } from '@/components/dashboard/EgressQuestionnaire';
import { CostBreakdown } from '@/components/dashboard/CostBreakdown';
import { ProjectionChart } from '@/components/dashboard/ProjectionChart';
import { PricingDetection } from '@/components/dashboard/PricingDetection';
import { PricingFreshnessWarning } from '@/components/dashboard/PricingFreshnessWarning';
import { DealSizing } from '@/components/dashboard/DealSizing';
import { CommitUpsellDashboard } from '@/components/dashboard/CommitUpsellDashboard';
import { TransactionAnalysis } from '@/components/dashboard/TransactionAnalysis';
import { FileUpload } from '@/components/upload/FileUpload';
import { InlineEditText } from '@/components/shared/InlineEditText';
import { AnimatedMetricValue } from '@/components/shared/AnimatedMetricValue';
import { Reveal } from '@/components/shared/Reveal';
import { formatCurrency, formatPercent } from '@/components/shared/FormatCurrency';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';
import { getPricingFreshnessWarning } from '@/lib/pricing/freshness';
import { formatGrowthAssumption } from '@/lib/engine/projections';
import b2Pricing from '@/lib/pricing/b2.json';
import { normalizeEgressConfig } from '@/types/analysis';

/** What GET /api/analyses/[id] returns. `parsed`/`modelConfig` are null until a bill is uploaded. */
interface AnalysisData {
  meta: Analysis;
  parsed: ParsedBill | null;
  modelConfig: ModelConfig | null;
}

function formatBillType(billType: string): string {
  switch (billType) {
    case 'sku-export': return 'S3 Cost Export';
    case 'detailed-statement': return 'Detailed Statement';
    case 'summary-invoice': return 'Summary Invoice';
    default: return billType;
  }
}

/** Short provider chip label for the source meta row. */
function formatProviderChip(provider: Provider): string {
  switch (provider) {
    case 'aws': return 'AWS';
    case 'gcp': return 'GCP';
    case 'azure': return 'Azure';
    case 'r2': return 'R2';
  }
}

function formatProviderStorageLabel(provider: Provider): string {
  switch (provider) {
    case 'aws': return 'AWS S3';
    case 'gcp': return 'Google Cloud Storage';
    case 'azure': return 'Azure Blob Storage';
    case 'r2': return 'Cloudflare R2';
  }
}

// Storage is tracked in GB internally; display migrated scope as whole TB (decimal, not binary).
function formatStorageTb(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} TB`;
  return `${Math.round(gb)} GB`;
}

/**
 * Internal analysis dashboard for one opportunity. Loads the parsed bill + saved model config, lets
 * the AE tune tier toggles / egress / B2 pricing / term, recomputes the cost model live, and
 * autosaves. This is the internal view; the customer-facing report lives at /analyses/[id]/report.
 */
export default function AnalysisDashboard() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [showReplaceUpload, setShowReplaceUpload] = useState(false);
  const [showSourceOverride, setShowSourceOverride] = useState(false);

  const [tiers, setTiers] = useState<TierInventoryRow[]>([]);
  const [egressConfig, setEgressConfig] = useState<EgressConfig>(() => normalizeEgressConfig());
  const [b2PricePerTb, setB2PricePerTb] = useState(b2Pricing.storage.perTbMonth);
  const [b2ServiceTier, setB2ServiceTier] = useState<B2ServiceTier>('committed');
  const [termMonths, setTermMonths] = useState(12);
  const [pricingDiscountConfirmed, setPricingDiscountConfirmed] = useState(false);
  useDocumentTitle(data?.meta.prospectName ? `${data.meta.prospectName} Analysis` : 'Analysis');

  useEffect(() => {
    fetch(`/api/analyses/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((d: AnalysisData) => {
        setData(d);
        if (d.parsed) {
          // buildTierState reconciles the saved config against the parsed bill and the current
          // TIER_SELECTION_VERSION, re-deriving tier toggles when a stale config predates the
          // current tiering logic. We seed all editable state from its normalized output.
          const { tiers: builtTiers, modelConfig: norm } = buildTierState(d.parsed, d.modelConfig);
          setTiers(builtTiers);
          setEgressConfig(norm.egressConfig);
          setB2PricePerTb(norm.b2PricePerTb);
          setB2ServiceTier(norm.b2ServiceTier);
          setTermMonths(norm.projectionTermMonths);
          setPricingDiscountConfirmed(Boolean(norm.pricingDiscountConfirmed));
        }
      })
      .catch(() => setError('Analysis not found'))
      .finally(() => setLoading(false));
  }, [id]);

  const saveConfig = useCallback(async (config: Partial<ModelConfig>) => {
    setSaving(true);
    try {
      await fetch(`/api/analyses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelConfig: {
            tierToggles: Object.fromEntries(tiers.map((t) => [t.id, t.migrateToB2])),
            // Stamp the version we saved under so a later load can tell whether the persisted toggles
            // need re-normalizing against newer tiering logic (see buildTierState).
            tierSelectionVersion: TIER_SELECTION_VERSION,
            egressConfig,
            b2PricePerTb,
            b2ServiceTier,
            projectionTermMonths: termMonths,
            pricingDiscountConfirmed,
            ...config,
          },
        }),
      });
    } catch {
      // Silently fail on save — non-critical
    } finally {
      setSaving(false);
    }
  }, [id, tiers, egressConfig, b2PricePerTb, b2ServiceTier, termMonths, pricingDiscountConfirmed]);

  const handleToggleTier = useCallback((tierId: string, migrateToB2: boolean) => {
    setTiers((prev) => prev.map((t) => t.id === tierId ? { ...t, migrateToB2 } : t));
  }, []);

  const handleEgressChange = useCallback((config: EgressConfig) => {
    setEgressConfig(normalizeEgressConfig(config));
  }, []);

  const handleGrowthChange = useCallback((updates: Partial<Pick<EgressConfig, 'dataGrowthMode' | 'dataGrowthRatePercent' | 'dataGrowthFixedTbPerMonth'>>) => {
    setEgressConfig((prev) => normalizeEgressConfig({ ...prev, ...updates }));
  }, []);

  // Optimistically merge meta edits (name, company, notes, provider override) into local state, then
  // persist. No rollback here: these are low-stakes text fields and the inline editors stay editable.
  const patchMeta = useCallback(async (fields: Partial<Analysis>) => {
    setData((prev) => prev ? { ...prev, meta: { ...prev.meta, ...fields } } : prev);
    await fetch(`/api/analyses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: fields }),
    });
  }, [id]);

  const handleCopyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, []);

  // Debounced autosave: every config tweak (tier toggles, egress, pricing, term) schedules a save
  // 1s later, collapsing rapid edits into one PATCH. Skipped until a bill is parsed.
  useEffect(() => {
    if (!data?.parsed) return;
    const timer = setTimeout(() => saveConfig({}), 1000);
    return () => clearTimeout(timer);
  }, [tiers, egressConfig, b2PricePerTb, b2ServiceTier, termMonths, pricingDiscountConfirmed, data?.parsed, saveConfig]);

  const parsedLineItems = data?.parsed?.lineItems;
  const parsedDiscounts = data?.parsed?.discounts;

  // Compute model results through the shared analysis-model path (same as report + rerun)
  const view = useMemo(() => {
    if (!parsedLineItems) return null;
    return computeAnalysisView({
      lineItems: parsedLineItems,
      discounts: parsedDiscounts,
      tiers,
      egressConfig,
      b2PricePerTb,
      b2ServiceTier,
      termMonths,
    });
  }, [parsedLineItems, parsedDiscounts, tiers, egressConfig, b2PricePerTb, b2ServiceTier, termMonths]);

  const costModel = view?.costModel ?? null;
  const projections = view?.projections ?? [];
  const pricingDetection = view?.pricingDetection ?? [];
  const migratedStorageGb = view?.migratedStorageGb ?? 0;

  // Savings-timing story for the hero, mirroring the customer report (report/page.tsx): with an
  // unrecovered migration cost it's "break-even at month N"; otherwise savings begin day one.
  // `migrationCost.total` is already $0 under UDM (see cost-model.ts), so no separate UDM check is
  // needed here — this is exactly the condition the report uses, keeping the two surfaces in agreement.
  const hasMigrationPayback = (costModel?.migrationCost.total ?? 0) > 0;
  const savingsTimingLabel = hasMigrationPayback ? 'Break-even' : 'Savings start';
  const savingsTimingValue = !costModel || costModel.monthlySavings <= 0
    ? '—'
    : hasMigrationPayback
      ? costModel.breakEvenMonth ? `Month ${costModel.breakEvenMonth}` : 'Review required'
      : 'Day 1';

  const growthLabel = formatGrowthAssumption({
    growthMode: egressConfig.dataGrowthMode,
    annualGrowthPercent: egressConfig.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: egressConfig.dataGrowthFixedTbPerMonth,
  });

  const pricingFreshnessWarning = data?.meta.provider
    ? getPricingFreshnessWarning(data.meta.provider)
    : null;
  // Customer-facing name defaults to the internal opportunity name until the AE sets a distinct
  // company name (e.g. opportunity "Acme Q3 renewal" vs. report company "Acme Corp").
  const reportCompanyName = data?.meta.companyName || data?.meta.prospectName || '';

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-[1240px] flex-col items-center justify-center px-6 py-12">
        <div className="relative mb-4 h-12 w-12">
          <div className="absolute inset-0 rounded-full border-4 border-c-border" />
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-c-red border-t-transparent" />
        </div>
        <p className="text-sm text-c-muted">Loading analysis...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-12">
        <div className="rounded-2xl border border-c-red/40 bg-c-red-soft p-6">
          <p className="text-c-red-dark">{error || 'Something went wrong'}</p>
          <Link href="/" className="mt-2 inline-block text-sm text-c-red underline">Back to opportunities</Link>
        </div>
      </div>
    );
  }

  if (data.meta.opportunityType === 'commit-upsell') {
    return <CommitUpsellDashboard analysisId={id} meta={data.meta} />;
  }

  if (!data.parsed) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.14em] text-c-red">New opportunity</p>
        <h1 className="mb-1 text-2xl font-semibold text-c-text">{data.meta.prospectName}</h1>
        <p className="mb-8 text-c-muted">Upload a customer cloud bill to begin the analysis.</p>
        <FileUpload
          analysisId={id}
          onUploadComplete={() => window.location.reload()}
          onError={setError}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1680px] px-3 pb-16 pt-6 sm:px-5">
      {/* Breadcrumb */}
      <div className="mb-3.5 flex items-center gap-2 text-[13px] text-c-subtle">
        <Link href="/" className="font-medium text-c-muted transition-colors hover:text-c-text">Opportunities</Link>
        <span>/</span>
        <span className="truncate font-semibold text-c-text">{data.meta.prospectName}</span>
      </div>

      {/* Title + source meta + actions */}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold text-c-text sm:text-[30px]">
              <InlineEditText
                value={data.meta.prospectName}
                onSave={(name) => patchMeta({ prospectName: name } as Partial<Analysis>)}
                placeholder="Opportunity name"
                maxLength={100}
              />
            </h1>
            {costModel && (
              <span className="rounded-full bg-c-green-soft px-2.5 py-1 text-[11px] font-semibold text-c-green">Report ready</span>
            )}
          </div>

          {/* Source meta row */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-[13px]">
            <span className="rounded-md bg-c-surface2 px-2 py-[3px] text-[11px] font-bold tracking-[0.04em] text-c-muted">
              {formatProviderChip(data.meta.provider)}
            </span>
            <span className="text-c-muted">{formatBillType(data.meta.billType)}</span>
            {data.meta.billingPeriod && (
              <>
                <span className="text-c-subtle">·</span>
                <span className="text-c-muted">{data.meta.billingPeriod}</span>
              </>
            )}
            {data.meta.detectionSignals && data.meta.detectionSignals.length > 0 && (
              <>
                <span className="text-c-subtle">·</span>
                <span className="group relative">
                  <span className="cursor-help text-c-subtle underline decoration-dotted underline-offset-2">Auto-detected</span>
                  <span className="absolute left-0 top-full z-10 mt-1 hidden w-80 rounded-lg bg-c-nav p-3 text-xs text-white shadow-lg group-hover:block">
                    <span className="mb-1 block font-semibold">Detection signals:</span>
                    {data.meta.detectionSignals.map((s, i) => (
                      <span key={i} className="block py-0.5">• {s}</span>
                    ))}
                  </span>
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowSourceOverride((shown) => !shown)}
              className="text-c-subtle underline decoration-dotted underline-offset-2 transition-colors hover:text-c-muted focus:outline-none"
              aria-expanded={showSourceOverride}
              aria-controls="source-override-panel"
            >
              Fix source
            </button>
          </div>

          {showSourceOverride && (
            <div
              id="source-override-panel"
              className="mt-2.5 inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-c-border bg-c-surface2 px-3 py-2"
            >
              <label htmlFor="source-override-select" className="text-xs font-medium text-c-muted">
                Parser source override
              </label>
              <select
                id="source-override-select"
                value={data.meta.provider}
                onChange={(e) => patchMeta({ provider: e.target.value as Provider } as Partial<Analysis>)}
                className="max-w-full cursor-pointer rounded-md border border-c-border2 bg-c-surface px-2 py-1 pr-7 text-sm font-semibold text-c-text focus:border-c-red focus:outline-none"
              >
                <option value="aws">Amazon Web Services (AWS)</option>
                <option value="gcp">Google Cloud Platform (GCP)</option>
                <option value="azure">Microsoft Azure</option>
                <option value="r2">Cloudflare R2</option>
              </select>
              <span className="text-xs text-c-subtle">Use only when the detected source is clearly wrong.</span>
            </div>
          )}

          {/* Company name + notes */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="text-xs font-semibold uppercase tracking-wide text-c-subtle">Company</span>
            <span className="font-medium text-c-muted">
              <InlineEditText
                value={reportCompanyName}
                onSave={(companyName) => patchMeta({ companyName } as Partial<Analysis>)}
                placeholder="Company name"
                maxLength={100}
              />
            </span>
          </div>
          <div className="mt-1.5">
            <InlineEditText
              value={data.meta.notes || ''}
              onSave={(notes) => patchMeta({ notes } as Partial<Analysis>)}
              placeholder="+ Add notes"
              className="text-sm text-c-subtle"
              multiline
              maxLength={500}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
          <span className="text-xs text-c-subtle">{saving ? 'Saving…' : 'All changes saved'}</span>
          <a
            href={`/analyses/${id}/report`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[10px] bg-c-brand px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-[background-color,box-shadow] duration-200 hover:bg-c-brand-hover hover:shadow-[0_8px_22px_rgba(226,6,38,0.4)]"
            aria-label="Open customer-facing report"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 2.75H6.75A2.75 2.75 0 0 0 4 5.5v13A2.75 2.75 0 0 0 6.75 21.25h10.5A2.75 2.75 0 0 0 20 18.5V7.75L15 2.75Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.75 2.75v3.5A1.75 1.75 0 0 0 16.5 8h3.5M8 12.25h8M8 15.75h8M8 9.25h3" />
            </svg>
            Customer report
          </a>
          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-c-border2 bg-c-surface px-3 py-2.5 text-[13px] font-semibold text-c-muted transition-colors hover:bg-c-surface2"
            aria-label={linkCopied ? 'Analysis link copied' : 'Copy analysis link'}
          >
            {linkCopied ? (
              <svg className="h-3.5 w-3.5 text-c-green" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.81 15.312a4.5 4.5 0 0 1-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757" />
              </svg>
            )}
            {linkCopied ? 'Copied!' : 'Copy link'}
          </button>
          <button
            onClick={() => setShowReplaceConfirm(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-c-border2 bg-c-surface px-3 py-2.5 text-[13px] font-semibold text-c-muted transition-colors hover:bg-c-surface2"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            Replace
          </button>
          <a
            href={`/api/analyses/${id}/pdf`}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-c-border2 bg-c-surface px-3 py-2.5 text-[13px] font-semibold text-c-muted transition-colors hover:bg-c-surface2"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            PDF
          </a>
          {data.meta.linkedAnalysisId && (
            <Link
              href={`/analyses/${data.meta.linkedAnalysisId}`}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-c-border2 bg-c-surface px-3 py-2.5 text-[13px] font-semibold text-c-muted transition-colors hover:bg-c-surface2"
            >
              View {data.meta.serviceTierVariant === 'overdrive' ? 'Standard' : 'Overdrive'} variant →
            </Link>
          )}
        </div>
      </div>

      {/* AWS is the most battle-tested parser path; everything else is flagged beta so the AE
          double-checks the numbers before sharing them with the customer. */}
      {data.meta.provider !== 'aws' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-c-amber/30 bg-c-amber-soft px-4 py-3">
          <span className="mt-0.5 shrink-0 rounded bg-c-amber px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">Beta</span>
          <p className="text-sm text-c-amber">
            Support for {data.meta.provider === 'gcp' ? 'GCP' : data.meta.provider === 'azure' ? 'Azure' : 'Cloudflare R2'} bill
            parsing is in beta. Please work with your SE to verify the numbers before sharing with the customer so we can improve analysis for this provider.
          </p>
        </div>
      )}

      <PricingFreshnessWarning warning={pricingFreshnessWarning} className="mb-4" />

      {/* Replace bill confirmation modal */}
      {showReplaceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-c-border bg-c-surface p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-c-text">Replace bill?</h3>
            <p className="mb-1 text-sm text-c-muted">
              This will overwrite the current parsed data and reset the model configuration (tier toggles, egress settings, and B2 pricing) to defaults.
            </p>
            <p className="mb-5 text-sm text-c-amber">All manual adjustments will be lost.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowReplaceConfirm(false)}
                className="rounded-[10px] bg-c-surface2 px-4 py-2 text-sm font-semibold text-c-text transition-colors hover:opacity-80"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowReplaceConfirm(false); setShowReplaceUpload(true); }}
                className="rounded-[10px] bg-c-amber px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Replace bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace bill upload modal */}
      {showReplaceUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-c-border bg-c-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-c-text">Upload new bill</h3>
              <button
                onClick={() => setShowReplaceUpload(false)}
                className="rounded p-1 text-c-subtle hover:text-c-text"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <FileUpload
              analysisId={id}
              onUploadComplete={() => window.location.reload()}
              onError={setError}
            />
          </div>
        </div>
      )}

      {/* Hero savings band */}
      {costModel && (
        <Reveal index={0} className="mb-4">
          <div
            className="bb-gradient-drift relative overflow-hidden rounded-[20px] bg-[#000033] p-7 text-white shadow-[0_18px_50px_rgba(0,0,51,0.30)] sm:p-8"
            style={{ backgroundImage: "url('/gradient-dark.png')" }}
          >
            <div className="relative flex flex-wrap items-center justify-between gap-9">
              <div className="min-w-[280px]">
                <p className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Modeled outcome</p>
                <p className="mt-3 font-display text-[44px] font-semibold leading-none sm:text-[58px]">
                  <AnimatedMetricValue value={costModel.annualSavings} formatter={(v) => formatCurrency(v, 0)} />
                  <span className="text-[22px] font-medium text-white/70"> / year</span>
                </p>
                <p className="mt-3 max-w-[380px] text-[15px] text-white/80">
                  Saved by moving <b className="text-white">{formatStorageTb(migratedStorageGb)}</b> of {formatProviderStorageLabel(data.meta.provider)} storage to Backblaze B2 Cloud Storage.
                </p>
              </div>
              <div className="grid min-w-[300px] grid-cols-2 gap-3.5">
                {/* Monthly savings + savings rate count up so the whole band animates as one when
                    the AE changes tier selection or pricing; migration cost / start stay as labels. */}
                <HeroStat label="Monthly savings" value={costModel.monthlySavings} formatter={(v) => formatCurrency(v, 0)} />
                <HeroStat label="Savings rate" value={costModel.savingsPercent} formatter={formatPercent} />
                <HeroStat
                  label="Migration cost"
                  value={costModel.udmEnabled ? '$0' : formatCurrency(costModel.migrationCost.total, 0)}
                  caption={costModel.udmEnabled ? 'Covered by UDM' : undefined}
                />
                <HeroStat label={savingsTimingLabel} value={savingsTimingValue} />
              </div>
            </div>
          </div>
        </Reveal>
      )}

      {/* Internal-only UDM nudge: when the model still charges the customer a migration cost, remind the
          AE that Backblaze can cover it via UDM — the strongest version of the report is one click away.
          Lives on the dashboard only, so it never reaches the customer report/PDF. */}
      {costModel && hasMigrationPayback && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-c-amber/40 bg-c-amber-soft px-4 py-3">
          <span className="mt-0.5 shrink-0 rounded bg-c-amber px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">Internal</span>
          <p className="text-sm text-c-amber">
            This model shows a <span className="font-semibold">{formatCurrency(costModel.migrationCost.total, 0)}</span> migration cost to the customer. Backblaze can often cover it — turn on <span className="font-semibold">Universal Data Migration</span>{' '}in &ldquo;Size the deal&rdquo; to model it at $0 and start savings on day one.
          </p>
        </div>
      )}

      {/* Cost comparison strip */}
      {costModel && (
        <Reveal index={1} className="mb-5">
          <div className="rounded-2xl border border-c-border bg-c-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-5">
              {/* Both cost columns are equal width (flex-1) and centre their content, so the arrow —
                  which sits at the boundary between them — lands exactly midway between the two figures. */}
              <div className="min-w-[200px] flex-1 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-c-subtle">Current modeled cost</p>
                <p className="mt-1 font-display text-[30px] font-semibold text-c-text">
                  <AnimatedMetricValue value={costModel.currentMonthly.total} formatter={(v) => formatCurrency(v, 0)} /><span className="text-sm font-medium text-c-subtle">/mo</span>
                </p>
              </div>
              {/* Mirror the cost columns' label + value rows (with a transparent placeholder label) so
                  the arrow lines up with the dollar figures instead of centering against the labels above them. */}
              <div className="shrink-0" aria-hidden="true">
                <p className="select-none text-xs font-semibold uppercase tracking-[0.06em] text-transparent">→</p>
                <p className="mt-1 font-display text-[30px] font-semibold text-c-subtle">→</p>
              </div>
              <div className="min-w-[200px] flex-1 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-c-red">Estimated Backblaze B2 cost</p>
                <p className="mt-1 font-display text-[30px] font-semibold text-c-red">
                  <AnimatedMetricValue value={costModel.b2Monthly.total} formatter={(v) => formatCurrency(v, 0)} /><span className="text-sm font-medium text-c-subtle">/mo</span>
                </p>
              </div>
              <div className="min-w-[240px] flex-[1.4]">
                <div className="flex h-[30px] overflow-hidden rounded-lg bg-c-surface2">
                  {/* The track is your migrated storage spend. Red = what you'd pay on Backblaze B2
                      (matching the projection chart's red B2 line); navy = the savings. Both are sized
                      from savingsPercent — the one official rate — so the navy width equals its
                      "X% lower" label and the strip agrees with the hero. Sizing red from the raw
                      $B2 / $current ratio would understate it, because savingsPercent also nets out any
                      new hyperscaler-to-B2 transfer cost. The red width animates on change. */}
                  <div
                    className="flex items-center justify-center bg-c-brand text-[11px] font-semibold text-white transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.max(8, Math.min(92, 100 - costModel.savingsPercent))}%` }}
                  >
                    B2
                  </div>
                  <div className="flex flex-1 items-center justify-center bg-[#000033] text-[11px] font-bold text-white">
                    {formatPercent(costModel.savingsPercent)} lower
                  </div>
                </div>
                <p className="mt-2 text-[11.5px] text-c-muted">
                  Share of your migrated storage spend — the red slice is the Backblaze B2 cost, the rest is your savings across storage, egress, and transactions.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      )}

      {/* Two-column layout: main analysis + internal-only sidebar */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_344px] lg:items-start">
        {/* Main content. Each block reveals on entry for a top-to-bottom cascade (indices continue
            from the hero=0 / cost-strip=1 above). */}
        <div className="min-w-0 space-y-5">
          {projections.length > 0 && (
            <Reveal index={2}>
              <ProjectionChart
                points={projections}
                termMonths={termMonths}
                onTermChange={setTermMonths}
                growthLabel={growthLabel}
                providerLabel={formatProviderStorageLabel(data.meta.provider)}
              />
            </Reveal>
          )}
          <Reveal index={3}>
            <TierInventory tiers={tiers} onToggle={handleToggleTier} accountBreakdowns={data.parsed.accountServiceBreakdowns} />
          </Reveal>
          <Reveal index={4}>
            <TransactionAnalysis lineItems={data.parsed.lineItems} />
          </Reveal>
          {costModel && (
            <Reveal index={5}>
              <CostBreakdown result={costModel} provider={data.meta.provider} />
            </Reveal>
          )}
          <Reveal index={6}>
            <EgressQuestionnaire
              config={egressConfig}
              onChange={handleEgressChange}
              partnerComputeScenario={costModel?.partnerComputeScenario}
              // B2's free monthly egress allowance is a multiple of the data actually migrated to B2,
              // so it scales with migrated (not total provider) storage.
              b2FreeAllowanceGb={migratedStorageGb * b2Pricing.egress.freeMultiplier}
              computeSignals={data.parsed.computeSignals}
              egressProfileSuggestion={data.parsed.egressProfileSuggestion}
            />
          </Reveal>
          <Reveal index={7}>
            <ParseReview
              parsed={data.parsed}
              billType={data.meta.billType}
              provider={data.meta.provider}
              pricingDiscountConfirmed={pricingDiscountConfirmed}
              onPricingDiscountConfirmedChange={setPricingDiscountConfirmed}
            />
          </Reveal>
        </div>

        {/* Sidebar — internal only. Deal sizing and pricing-detection drivers live here, never in
            the customer report, so internal pricing levers stay off the customer deliverable.
            Revealed as one block alongside the top of the main column. */}
        <Reveal index={2} className="space-y-4">
          <div className="rounded-xl border border-c-border bg-c-amber-soft p-3.5">
            <p className="text-xs font-bold text-c-amber">Internal only</p>
            <p className="mt-1 text-[11.5px] text-c-muted">These panels never appear in the customer report.</p>
          </div>
          {costModel && (
            <DealSizing
              b2PricePerTb={b2PricePerTb}
              onB2PriceChange={setB2PricePerTb}
              b2ServiceTier={b2ServiceTier}
              onServiceTierChange={setB2ServiceTier}
              monthlyB2Revenue={costModel.b2Monthly.total}
              termMonths={termMonths}
              onTermChange={setTermMonths}
              growthMode={egressConfig.dataGrowthMode}
              growthRatePercent={egressConfig.dataGrowthRatePercent}
              growthFixedTbPerMonth={egressConfig.dataGrowthFixedTbPerMonth}
              onGrowthChange={handleGrowthChange}
              totalStorageGb={migratedStorageGb}
              udmEnabled={egressConfig.udmEnabled}
              onUdmChange={(enabled) => setEgressConfig((prev) => ({ ...prev, udmEnabled: enabled }))}
              udmCostToBackblaze={costModel.udmCostToBackblaze}
            />
          )}
          {pricingDetection.length > 0 && <PricingDetection results={pricingDetection} />}
        </Reveal>
      </div>
    </div>
  );
}

/**
 * A single stat tile inside the navy hero band. Colors are fixed (the band is always dark).
 * A numeric `value` counts up via AnimatedMetricValue (mirrors ChartMetric); a string renders as-is
 * for label-style stats like "Day 1" or "$0".
 */
function HeroStat({
  label,
  value,
  formatter,
  caption,
}: {
  label: string;
  value: number | string;
  formatter?: (value: number) => string;
  caption?: string;
}) {
  return (
    <div className="rounded-[14px] border border-white/12 bg-white/[0.08] px-4 py-[15px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">{label}</p>
      <p className="mt-1.5 font-display text-[26px] font-semibold text-c-hero-pos">
        {typeof value === 'number'
          ? <AnimatedMetricValue value={value} formatter={formatter} />
          : value}
      </p>
      {caption && <p className="mt-0.5 text-[11px] text-white/55">{caption}</p>}
    </div>
  );
}
