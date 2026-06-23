'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Analysis, ParsedBill, ModelConfig, TierInventoryRow, EgressConfig, Provider } from '@/types/analysis';
import { TIER_SELECTION_VERSION } from '@/types/analysis';
import type { CostModelResult, ProjectionPoint, PricingDetectionResult } from '@/types/model';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { applyTierSelectionConfig } from '@/lib/engine/tier-selection';
import {
  computeCostModel,
  getStorageScopeCurrentMonthly,
  getStorageScopeReplacementMonthly,
} from '@/lib/engine/cost-model';
import { computeProjections } from '@/lib/engine/projections';
import { detectCustomPricing } from '@/lib/pricing/detection';
import { ParseReview } from '@/components/upload/ParseReview';
import { TierInventory } from '@/components/dashboard/TierInventory';
import { EgressQuestionnaire } from '@/components/dashboard/EgressQuestionnaire';
import { SavingsSummary } from '@/components/dashboard/SavingsSummary';
import { CostBreakdown } from '@/components/dashboard/CostBreakdown';
import { ProjectionChart } from '@/components/dashboard/ProjectionChart';
import { PricingDetection } from '@/components/dashboard/PricingDetection';
import { PricingFreshnessWarning } from '@/components/dashboard/PricingFreshnessWarning';
import { DealSizing } from '@/components/dashboard/DealSizing';
import { TransactionAnalysis } from '@/components/dashboard/TransactionAnalysis';
import { FileUpload } from '@/components/upload/FileUpload';
import { InlineEditText } from '@/components/shared/InlineEditText';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';
import { getPricingFreshnessWarning } from '@/lib/pricing/freshness';
import { formatGrowthAssumption } from '@/lib/engine/projections';
import b2Pricing from '@/lib/pricing/b2.json';
import { normalizeEgressConfig } from '@/types/analysis';

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

function formatProviderName(provider: Provider): string {
  switch (provider) {
    case 'aws': return 'Amazon Web Services (AWS)';
    case 'gcp': return 'Google Cloud Platform (GCP)';
    case 'azure': return 'Microsoft Azure';
    case 'r2': return 'Cloudflare R2';
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
          const builtTiers = applyTierSelectionConfig(
            buildTierInventory(d.parsed.lineItems, d.modelConfig?.b2PricePerTb),
            d.modelConfig,
          );
          setTiers(builtTiers);
          if (d.modelConfig) {
            setEgressConfig(normalizeEgressConfig(d.modelConfig.egressConfig));
            setB2PricePerTb(d.modelConfig.b2PricePerTb);
            setTermMonths(d.modelConfig.projectionTermMonths);
            setPricingDiscountConfirmed(Boolean(d.modelConfig.pricingDiscountConfirmed));
          }
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
            tierSelectionVersion: TIER_SELECTION_VERSION,
            egressConfig,
            b2PricePerTb,
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
  }, [id, tiers, egressConfig, b2PricePerTb, termMonths, pricingDiscountConfirmed]);

  const handleToggleTier = useCallback((tierId: string, migrateToB2: boolean) => {
    setTiers((prev) => prev.map((t) => t.id === tierId ? { ...t, migrateToB2 } : t));
  }, []);

  const handleEgressChange = useCallback((config: EgressConfig) => {
    setEgressConfig(normalizeEgressConfig(config));
  }, []);

  const handleGrowthChange = useCallback((updates: Partial<Pick<EgressConfig, 'dataGrowthMode' | 'dataGrowthRatePercent' | 'dataGrowthFixedTbPerMonth'>>) => {
    setEgressConfig((prev) => normalizeEgressConfig({ ...prev, ...updates }));
  }, []);

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

  // Debounced save
  useEffect(() => {
    if (!data?.parsed) return;
    const timer = setTimeout(() => saveConfig({}), 1000);
    return () => clearTimeout(timer);
  }, [tiers, egressConfig, b2PricePerTb, termMonths, pricingDiscountConfirmed, data?.parsed, saveConfig]);

  const parsedLineItems = data?.parsed?.lineItems;
  const parsedDiscounts = data?.parsed?.discounts;

  // Compute model results
  const costModel: CostModelResult | null = useMemo(() => {
    if (!parsedLineItems) return null;
    return computeCostModel(parsedLineItems, tiers, egressConfig, b2PricePerTb);
  }, [parsedLineItems, tiers, egressConfig, b2PricePerTb]);

  const projections: ProjectionPoint[] = useMemo(() => {
    if (!costModel) return [];
    const baseStorageGb = tiers.filter((t) => t.migrateToB2).reduce((s, t) => s + t.gbStored, 0);
    return computeProjections({
      currentMonthlyCost: getStorageScopeCurrentMonthly(costModel),
      b2MonthlyCost: getStorageScopeReplacementMonthly(costModel),
      migrationCostTotal: costModel.migrationCost.total,
      baseStorageGb,
      growthMode: egressConfig.dataGrowthMode,
      annualGrowthPercent: egressConfig.dataGrowthRatePercent,
      fixedGrowthTbPerMonth: egressConfig.dataGrowthFixedTbPerMonth,
      termMonths,
    });
  }, [costModel, tiers, egressConfig, termMonths]);

  const growthLabel = formatGrowthAssumption({
    growthMode: egressConfig.dataGrowthMode,
    annualGrowthPercent: egressConfig.dataGrowthRatePercent,
    fixedGrowthTbPerMonth: egressConfig.dataGrowthFixedTbPerMonth,
  });

  const pricingDetection: PricingDetectionResult[] = useMemo(() => {
    if (!parsedLineItems) return [];
    return detectCustomPricing(parsedLineItems, parsedDiscounts);
  }, [parsedLineItems, parsedDiscounts]);

  const pricingFreshnessWarning = data?.meta.provider
    ? getPricingFreshnessWarning(data.meta.provider)
    : null;
  const reportCompanyName = data?.meta.companyName || data?.meta.prospectName || '';

  const migratedStorageGb = useMemo(() => {
    return tiers.filter((t) => t.migrateToB2).reduce((s, t) => s + t.gbStored, 0);
  }, [tiers]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="relative w-12 h-12 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-bb-red border-t-transparent animate-spin" />
        </div>
        <p className="text-gray-500 text-sm">Loading analysis...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-[1600px] mx-auto px-6 py-12">
        <div className="bg-red-50 rounded-lg p-6">
          <p className="text-red-800">{error || 'Something went wrong'}</p>
          <Link href="/" className="text-sm text-red-600 underline mt-2 inline-block">Back to Home</Link>
        </div>
      </div>
    );
  }

  if (!data.parsed) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{data.meta.prospectName}</h1>
        <p className="text-sm text-gray-500 mb-2">Company Name: {reportCompanyName}</p>
        <p className="text-gray-500 mb-8">Upload a Cloud Bill to Begin Analysis</p>
        <FileUpload
          analysisId={id}
          onUploadComplete={() => window.location.reload()}
          onError={setError}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              <InlineEditText
                value={data.meta.prospectName}
                onSave={(name) => patchMeta({ prospectName: name } as Partial<Analysis>)}
                placeholder="Opportunity Name"
                maxLength={100}
              />
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Company Name</span>
              <span className="font-medium text-gray-700">
                <InlineEditText
                  value={reportCompanyName}
                  onSave={(companyName) => patchMeta({ companyName } as Partial<Analysis>)}
                  placeholder="Company Name"
                  maxLength={100}
                />
              </span>
            </div>
          </div>
          {saving && <span className="text-xs text-gray-400 shrink-0">Saving...</span>}
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs font-medium text-gray-500 tracking-wide">Source:</span>
          <span className="text-sm font-semibold text-gray-900">{formatProviderName(data.meta.provider)}</span>
          <span className="text-xs text-gray-400">|</span>
          <span className="text-sm text-gray-600">{formatBillType(data.meta.billType)}</span>
          {data.meta.billingPeriod && (
            <>
              <span className="text-xs text-gray-400">|</span>
              <span className="text-sm text-gray-600">{data.meta.billingPeriod}</span>
            </>
          )}
          {data.meta.detectionSignals && data.meta.detectionSignals.length > 0 && (
            <span className="relative group">
              <span className="text-xs text-gray-400 cursor-help underline decoration-dotted">
                Auto-Detected
              </span>
              <span className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-80 bg-bb-navy text-white text-xs rounded-lg p-3 shadow-lg">
                <span className="font-semibold block mb-1">Detection Signals:</span>
                {data.meta.detectionSignals.map((s, i) => (
                  <span key={i} className="block py-0.5">• {s}</span>
                ))}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowSourceOverride((shown) => !shown)}
            className="text-xs text-gray-400 underline decoration-dotted underline-offset-2 transition-colors hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-bb-red focus:ring-offset-2"
            aria-expanded={showSourceOverride}
            aria-controls="source-override-panel"
          >
            Fix source
          </button>
        </div>
        {showSourceOverride && (
          <div
            id="source-override-panel"
            className="mt-2 inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
          >
            <label htmlFor="source-override-select" className="text-xs font-medium text-gray-500">
              Parser source override
            </label>
            <select
              id="source-override-select"
              value={data.meta.provider}
              onChange={(e) => patchMeta({ provider: e.target.value as Provider } as Partial<Analysis>)}
              className="max-w-full text-sm font-semibold bg-white border border-gray-300 rounded-md px-2 py-1 pr-7 cursor-pointer focus:ring-2 focus:ring-bb-red focus:border-transparent"
            >
              <option value="aws">Amazon Web Services (AWS)</option>
              <option value="gcp">Google Cloud Platform (GCP)</option>
              <option value="azure">Microsoft Azure</option>
              <option value="r2">Cloudflare R2</option>
            </select>
            <span className="text-xs text-gray-500">Use only when the detected source is clearly wrong.</span>
          </div>
        )}
        {/* Notes */}
        <div className="mt-2">
          <InlineEditText
            value={data.meta.notes || ''}
            onSave={(notes) => patchMeta({ notes } as Partial<Analysis>)}
            placeholder="+ Add Notes"
            className="text-sm text-gray-500"
            multiline
            maxLength={500}
          />
        </div>
        {/* Actions */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <a
            href={`/analyses/${id}/report`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-bb-red px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-bb-red-dark focus:outline-none focus:ring-2 focus:ring-bb-red focus:ring-offset-2"
            aria-label="Open customer-facing report"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 2.75H6.75A2.75 2.75 0 0 0 4 5.5v13A2.75 2.75 0 0 0 6.75 21.25h10.5A2.75 2.75 0 0 0 20 18.5V7.75L15 2.75Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.75 2.75v3.5A1.75 1.75 0 0 0 16.5 8h3.5M8 12.25h8M8 15.75h8M8 9.25h3" />
            </svg>
            Customer Report
          </a>
          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
            aria-label={linkCopied ? 'Analysis link copied' : 'Copy analysis link'}
          >
            {linkCopied ? (
              <svg className="h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.81 15.312a4.5 4.5 0 0 1-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757" />
              </svg>
            )}
            {linkCopied ? 'Copied!' : 'Copy Link'}
          </button>
          <button
            onClick={() => setShowReplaceConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            Replace
          </button>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <a
            href={`/api/analyses/${id}/pdf`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            PDF
          </a>
        </div>
      </div>

      {data.meta.provider !== 'aws' && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white leading-none">Beta</span>
          <p className="text-sm text-amber-800">
            Support for {data.meta.provider === 'gcp' ? 'GCP' : data.meta.provider === 'azure' ? 'Azure' : 'Cloudflare R2'} bill
            parsing is in beta. Please work with your SE to verify the numbers before sharing with the customer so we can improve analysis for this provider.
          </p>
        </div>
      )}

      <PricingFreshnessWarning warning={pricingFreshnessWarning} className="mb-4" />

      {/* Replace bill confirmation modal */}
      {showReplaceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Replace Bill?</h3>
            <p className="text-sm text-gray-600 mb-1">
              This will overwrite the current parsed data and reset the model configuration (tier toggles, egress settings, and B2 pricing) to defaults.
            </p>
            <p className="text-sm text-amber-600 mb-5">All manual adjustments will be lost.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowReplaceConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowReplaceConfirm(false); setShowReplaceUpload(true); }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700"
              >
                Replace Bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace bill upload modal */}
      {showReplaceUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Upload New Bill</h3>
              <button
                onClick={() => setShowReplaceUpload(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main content */}
        <div className="min-w-0 space-y-6">
          {costModel && <SavingsSummary result={costModel} />}
          <ParseReview
            parsed={data.parsed}
            billType={data.meta.billType}
            provider={data.meta.provider}
            pricingDiscountConfirmed={pricingDiscountConfirmed}
            onPricingDiscountConfirmedChange={setPricingDiscountConfirmed}
          />
          {projections.length > 0 && (
            <ProjectionChart
              points={projections}
              termMonths={termMonths}
              onTermChange={setTermMonths}
              growthLabel={growthLabel}
              providerLabel={formatProviderStorageLabel(data.meta.provider)}
            />
          )}
          <TierInventory tiers={tiers} onToggle={handleToggleTier} accountBreakdowns={data.parsed.accountServiceBreakdowns} />
          <TransactionAnalysis lineItems={data.parsed.lineItems} />
          <EgressQuestionnaire
            config={egressConfig}
            onChange={handleEgressChange}
            partnerComputeScenario={costModel?.partnerComputeScenario}
            b2FreeAllowanceGb={migratedStorageGb * b2Pricing.egress.freeMultiplier}
            computeSignals={data.parsed.computeSignals}
            egressProfileSuggestion={data.parsed.egressProfileSuggestion}
          />
          {costModel && <CostBreakdown result={costModel} provider={data.meta.provider} />}
        </div>

        {/* Sidebar — internal only */}
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-amber-800">Internal Only</p>
            <p className="text-xs text-amber-600 mt-1">
              Sidebar panels are not included in customer-facing reports.
            </p>
          </div>
          {costModel && (
            <DealSizing
              b2PricePerTb={b2PricePerTb}
              onB2PriceChange={setB2PricePerTb}
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
        </div>
      </div>
    </div>
  );
}
