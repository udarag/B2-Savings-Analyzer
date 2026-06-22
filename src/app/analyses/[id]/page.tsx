'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import type { Analysis, ParsedBill, ModelConfig, TierInventoryRow, EgressConfig, Provider } from '@/types/analysis';
import type { CostModelResult, ProjectionPoint, PricingDetectionResult } from '@/types/model';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { computeCostModel } from '@/lib/engine/cost-model';
import { computeProjections } from '@/lib/engine/projections';
import { detectCustomPricing } from '@/lib/pricing/detection';
import { ParseReview } from '@/components/upload/ParseReview';
import { TierInventory } from '@/components/dashboard/TierInventory';
import { EgressQuestionnaire } from '@/components/dashboard/EgressQuestionnaire';
import { SavingsSummary } from '@/components/dashboard/SavingsSummary';
import { CostBreakdown } from '@/components/dashboard/CostBreakdown';
import { ProjectionChart } from '@/components/dashboard/ProjectionChart';
import { SensitivitySliders } from '@/components/dashboard/SensitivitySliders';
import { PricingDetection } from '@/components/dashboard/PricingDetection';
import { DealSizing } from '@/components/dashboard/DealSizing';
import { TransactionAnalysis } from '@/components/dashboard/TransactionAnalysis';
import { FileUpload } from '@/components/upload/FileUpload';
import { InlineEditText } from '@/components/shared/InlineEditText';
import b2Pricing from '@/lib/pricing/b2.json';

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

  const [tiers, setTiers] = useState<TierInventoryRow[]>([]);
  const [egressConfig, setEgressConfig] = useState<EgressConfig>({
    computeStaysInHyperscaler: false,
    computeMovingToPartner: false,
    gbPerMonthHyperscalerToB2: 0,
    gbPerMonthServedToUsers: 0,
    usesPartnerCdn: false,
    dataGrowthRatePercent: 0,
    dataGrowthPeriod: 'yearly',
    udmEnabled: false,
  });
  const [b2PricePerTb, setB2PricePerTb] = useState(b2Pricing.storage.perTbMonth);
  const [termMonths, setTermMonths] = useState(36);
  const [growthRate, setGrowthRate] = useState(10);

  useEffect(() => {
    fetch(`/api/analyses/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((d: AnalysisData) => {
        setData(d);
        if (d.parsed) {
          const builtTiers = buildTierInventory(d.parsed.lineItems, d.modelConfig?.b2PricePerTb);
          if (d.modelConfig?.tierToggles) {
            for (const tier of builtTiers) {
              if (tier.id in d.modelConfig.tierToggles) {
                tier.migrateToB2 = d.modelConfig.tierToggles[tier.id];
              }
            }
          }
          setTiers(builtTiers);
          if (d.modelConfig) {
            setEgressConfig(d.modelConfig.egressConfig);
            setB2PricePerTb(d.modelConfig.b2PricePerTb);
            setTermMonths(d.modelConfig.projectionTermMonths);
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
            egressConfig,
            b2PricePerTb,
            projectionTermMonths: termMonths,
            ...config,
          },
        }),
      });
    } catch {
      // Silently fail on save — non-critical
    } finally {
      setSaving(false);
    }
  }, [id, tiers, egressConfig, b2PricePerTb, termMonths]);

  const handleToggleTier = useCallback((tierId: string, migrateToB2: boolean) => {
    setTiers((prev) => prev.map((t) => t.id === tierId ? { ...t, migrateToB2 } : t));
  }, []);

  const handleEgressChange = useCallback((config: EgressConfig) => {
    setEgressConfig(config);
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
  }, [tiers, egressConfig, b2PricePerTb, termMonths, data?.parsed, saveConfig]);

  // Compute model results
  const costModel: CostModelResult | null = useMemo(() => {
    if (!data?.parsed) return null;
    return computeCostModel(data.parsed.lineItems, tiers, egressConfig, b2PricePerTb);
  }, [data?.parsed, tiers, egressConfig, b2PricePerTb]);

  const projections: ProjectionPoint[] = useMemo(() => {
    if (!costModel) return [];
    const addressableCurrent = costModel.currentMonthly.storage +
      costModel.currentMonthly.egress +
      costModel.currentMonthly.operations +
      costModel.currentMonthly.retrieval;
    return computeProjections({
      currentMonthlyCost: addressableCurrent,
      b2MonthlyCost: costModel.b2Monthly.total,
      migrationCostTotal: costModel.migrationCost.total,
      annualGrowthPercent: growthRate,
      termMonths,
    });
  }, [costModel, growthRate, termMonths]);

  const pricingDetection: PricingDetectionResult[] = useMemo(() => {
    if (!data?.parsed) return [];
    return detectCustomPricing(data.parsed.lineItems, data.parsed.discounts);
  }, [data?.parsed]);

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
          <a href="/" className="text-sm text-red-600 underline mt-2 inline-block">Back to home</a>
        </div>
      </div>
    );
  }

  if (!data.parsed) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{data.meta.prospectName}</h1>
        <p className="text-gray-500 mb-8">Upload a cloud bill to begin analysis</p>
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
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            <InlineEditText
              value={data.meta.prospectName}
              onSave={(name) => patchMeta({ prospectName: name } as Partial<Analysis>)}
              placeholder="Prospect name"
              maxLength={100}
            />
          </h1>
          {saving && <span className="text-xs text-gray-400 shrink-0">Saving...</span>}
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Source:</span>
          <select
            value={data.meta.provider}
            onChange={(e) => patchMeta({ provider: e.target.value as Provider } as Partial<Analysis>)}
            className="text-sm font-semibold bg-white border border-gray-300 rounded-md px-2 py-1 pr-7 cursor-pointer focus:ring-2 focus:ring-bb-red focus:border-transparent"
          >
            <option value="aws">Amazon Web Services (AWS)</option>
            <option value="gcp">Google Cloud Platform (GCP)</option>
            <option value="azure">Microsoft Azure</option>
            <option value="r2">Cloudflare R2</option>
          </select>
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
                Auto-detected
              </span>
              <span className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-80 bg-bb-navy text-white text-xs rounded-lg p-3 shadow-lg">
                <span className="font-semibold block mb-1">Detection signals:</span>
                {data.meta.detectionSignals.map((s, i) => (
                  <span key={i} className="block py-0.5">• {s}</span>
                ))}
              </span>
            </span>
          )}
        </div>
        {/* Notes */}
        <div className="mt-2">
          <InlineEditText
            value={data.meta.notes || ''}
            onSave={(notes) => patchMeta({ notes } as Partial<Analysis>)}
            placeholder="+ Add notes"
            className="text-sm text-gray-500"
            multiline
            maxLength={500}
          />
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1.5 mt-3">
          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 0 0-1.242-7.244l-4.5-4.5a4.5 4.5 0 0 0-6.364 6.364L5.25 9.879" /></svg>
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
            href={`/analyses/${id}/report`}
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bb-red text-white rounded-md hover:bg-bb-red-dark transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
            Report
          </a>
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

      {/* Replace bill confirmation modal */}
      {showReplaceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Replace bill?</h3>
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
          <ParseReview parsed={data.parsed} />
          <TierInventory tiers={tiers} onToggle={handleToggleTier} accountBreakdowns={data.parsed.accountServiceBreakdowns} />
          <TransactionAnalysis lineItems={data.parsed.lineItems} />
          <EgressQuestionnaire config={egressConfig} onChange={handleEgressChange} />
          {costModel && <CostBreakdown result={costModel} />}
          {projections.length > 0 && (
            <ProjectionChart
              points={projections}
              termMonths={termMonths}
              onTermChange={setTermMonths}
            />
          )}
          <SensitivitySliders
            growthRate={growthRate}
            onGrowthRateChange={setGrowthRate}
          />
        </div>

        {/* Sidebar — internal only */}
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-amber-800 uppercase">Internal Only</p>
            <p className="text-xs text-amber-600 mt-1">
              Sidebar panels are not included in customer-facing reports.
            </p>
          </div>
          {pricingDetection.length > 0 && <PricingDetection results={pricingDetection} />}
          {costModel && (
            <DealSizing
              b2PricePerTb={b2PricePerTb}
              onB2PriceChange={setB2PricePerTb}
              monthlyB2Revenue={costModel.b2Monthly.total}
              termMonths={termMonths}
              totalStorageGb={migratedStorageGb}
              udmEnabled={egressConfig.udmEnabled}
              onUdmChange={(enabled) => setEgressConfig((prev) => ({ ...prev, udmEnabled: enabled }))}
              udmCostToBackblaze={costModel.udmCostToBackblaze}
            />
          )}
        </div>
      </div>
    </div>
  );
}
