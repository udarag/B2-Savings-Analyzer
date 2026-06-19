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
  const [b2PricePerTb, setB2PricePerTb] = useState(6.95);
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
      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-gray-500">Loading analysis...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12">
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
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{data.meta.prospectName}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Source:</span>
            <select
              value={data.meta.provider}
              onChange={async (e) => {
                const newProvider = e.target.value as Provider;
                setData((prev) => prev ? { ...prev, meta: { ...prev.meta, provider: newProvider } } : prev);
                await fetch(`/api/analyses/${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ meta: { provider: newProvider } }),
                });
              }}
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
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
          <a
            href={`/analyses/${id}/report`}
            target="_blank"
            className="px-4 py-2 bg-bb-red text-white text-sm font-medium rounded-lg hover:bg-bb-red-dark"
          >
            View Report
          </a>
          <a
            href={`/api/analyses/${id}/pdf`}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
          >
            Download PDF
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main content */}
        <div className="lg:col-span-3 space-y-6">
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
