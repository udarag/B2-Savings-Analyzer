'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { Analysis, ParsedBill, ModelConfig, TierInventoryRow } from '@/types/analysis';
import type { CostModelResult, ProjectionPoint, PricingDetectionResult } from '@/types/model';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { computeCostModel } from '@/lib/engine/cost-model';
import { computeProjections } from '@/lib/engine/projections';
import { detectCustomPricing } from '@/lib/pricing/detection';
import { formatCurrency, formatNumber, formatPercent } from '@/components/shared/FormatCurrency';
import b2Pricing from '@/lib/pricing/b2.json';

interface AEInfo {
  name: string;
  email: string;
  title?: string;
}

function emailToDisplayName(email: string): string {
  const local = email.split('@')[0];
  return local
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function ReportPage() {
  const params = useParams();
  const id = params.id as string;
  const searchParams = useSearchParams();

  const [meta, setMeta] = useState<Analysis | null>(null);
  const [parsed, setParsed] = useState<ParsedBill | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [aeInfo, setAeInfo] = useState<AEInfo | null>(null);

  useEffect(() => {
    const aeEmail = searchParams.get('ae');
    const aeName = searchParams.get('aeName');
    const aeTitle = searchParams.get('aeTitle');
    if (aeEmail) {
      setAeInfo({
        name: aeName || emailToDisplayName(aeEmail),
        email: aeEmail,
        title: aeTitle || undefined,
      });
    } else {
      Promise.all([
        fetch('/api/auth/me').then((r) => r.json()),
        fetch('/api/auth/profile').then((r) => r.json()),
      ]).then(([me, prof]) => {
        const email = me.user?.email;
        if (email) {
          setAeInfo({
            name: prof.profile?.displayName || emailToDisplayName(email),
            email,
            title: prof.profile?.title || undefined,
          });
        }
      }).catch(() => {});
    }
  }, [searchParams]);

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
    const built = buildTierInventory(parsed.lineItems, modelConfig.b2PricePerTb);
    for (const tier of built) {
      if (tier.id in modelConfig.tierToggles) {
        tier.migrateToB2 = modelConfig.tierToggles[tier.id];
      }
    }
    return built;
  }, [parsed, modelConfig]);

  const costModel: CostModelResult | null = useMemo(() => {
    if (!parsed || !modelConfig) return null;
    return computeCostModel(parsed.lineItems, tiers, modelConfig.egressConfig, modelConfig.b2PricePerTb);
  }, [parsed, modelConfig, tiers]);

  const projections: ProjectionPoint[] = useMemo(() => {
    if (!costModel || !modelConfig) return [];
    const addressable = costModel.currentMonthly.storage +
      costModel.currentMonthly.egress +
      costModel.currentMonthly.operations +
      costModel.currentMonthly.retrieval;
    return computeProjections({
      currentMonthlyCost: addressable,
      b2MonthlyCost: costModel.b2Monthly.total,
      migrationCostTotal: costModel.migrationCost.total,
      annualGrowthPercent: modelConfig.egressConfig.dataGrowthRatePercent || 10,
      termMonths: modelConfig.projectionTermMonths,
    });
  }, [costModel, modelConfig]);

  const pricingDetection: PricingDetectionResult[] = useMemo(() => {
    if (!parsed) return [];
    return detectCustomPricing(parsed.lineItems, parsed.discounts);
  }, [parsed]);

  // Save a snapshot when the report is viewed
  useEffect(() => {
    if (!costModel || !modelConfig || !tiers.length) return;
    const migratedTiers = tiers.filter((t) => t.migrateToB2);
    fetch(`/api/analyses/${id}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger: 'report-view',
        monthlySavings: costModel.monthlySavings,
        annualSavings: costModel.annualSavings,
        savingsPercent: costModel.savingsPercent,
        totalStorageGb: migratedTiers.reduce((s, t) => s + t.gbStored, 0),
        migratedTierCount: migratedTiers.length,
        b2PricePerTb: modelConfig.b2PricePerTb,
        termMonths: modelConfig.projectionTermMonths,
        udmEnabled: modelConfig.egressConfig.udmEnabled,
      }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!costModel]);

  if (loading || !meta || !parsed || !costModel) {
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

  const migratedTiers = tiers.filter((t) => t.migrateToB2);
  const totalSavings = projections.length > 0 ? projections[projections.length - 1].cumulativeSavings : 0;
  const termYears = (modelConfig?.projectionTermMonths || 36) / 12;

  return (
    <div className="report-container max-w-4xl mx-auto bg-white print:max-w-none">
      <style>{`
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
          .report-header-flush { margin: 0 -0.65in; }
          table { break-inside: avoid; }
          .keep-together { break-inside: avoid; }
        }
      `}</style>

      {/* Download PDF button */}
      <div className="no-print p-4 text-center bg-gray-100">
        <button
          onClick={() => {
            const btn = document.getElementById('pdf-btn') as HTMLButtonElement;
            btn.disabled = true;
            btn.textContent = 'Generating PDF...';
            fetch(`/api/analyses/${id}/pdf`)
              .then(r => {
                if (!r.ok) throw new Error('PDF generation failed');
                return r.blob();
              })
              .then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'report.pdf';
                a.click();
                URL.revokeObjectURL(url);
              })
              .catch(() => alert('PDF generation failed. Make sure Playwright is installed.'))
              .finally(() => { btn.disabled = false; btn.textContent = 'Download PDF'; });
          }}
          id="pdf-btn"
          className="px-6 py-2 bg-bb-red text-white rounded-lg hover:bg-bb-red-dark disabled:opacity-50"
        >
          Download PDF
        </button>
      </div>

      {/* Page 1: Executive Summary */}
      <div>
        <div className="h-1.5 bg-bb-red report-header-flush" />
        <div className="bg-bb-navy px-8 py-5 flex items-center gap-4 report-header-flush">
          <img src="/backblaze-webclip.png" alt="Backblaze" className="w-10 h-10" />
          <div>
            <h1 className="text-xl font-bold text-white">B2 Cloud Storage Savings Report</h1>
            <p className="text-sm text-gray-400">Prepared for {meta.prospectName}</p>
          </div>
        </div>

        <div className="px-8 pt-6 pb-8">
          {meta.provider !== 'aws' && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 print:hidden">
              <span className="mt-0.5 shrink-0 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white leading-none">Beta</span>
              <p className="text-sm text-amber-800">
                This report was generated from a {meta.provider === 'gcp' ? 'GCP' : meta.provider === 'azure' ? 'Azure' : 'Cloudflare R2'} bill
                using beta parsing. Please work with your SE to verify the numbers before sharing with the customer.
              </p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-green-50 rounded-lg p-5 text-center">
              <p className="text-sm text-gray-600 mb-1">Monthly Savings</p>
              <p className="text-2xl font-bold text-green-700">{formatCurrency(costModel.monthlySavings)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-5 text-center">
              <p className="text-sm text-gray-600 mb-1">Annual Savings</p>
              <p className="text-2xl font-bold text-green-700">{formatCurrency(costModel.annualSavings)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-5 text-center">
              <p className="text-sm text-gray-600 mb-1">Savings %</p>
              <p className="text-2xl font-bold text-green-700">{formatPercent(costModel.savingsPercent)}</p>
            </div>
          </div>
          <div className="bg-bb-navy rounded-lg p-6 text-center mb-8">
            <p className="text-sm text-gray-300 mb-1">Estimated {termYears}-Year Savings</p>
            <p className="text-3xl font-bold text-white">{formatCurrency(totalSavings)}</p>
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3 border-l-4 border-bb-red pl-3">Summary</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              By migrating {migratedTiers.length} storage tier{migratedTiers.length !== 1 ? 's' : ''} ({formatNumber(migratedTiers.reduce((s, t) => s + t.gbStored, 0))} GB) to Backblaze B2 Cloud Storage, {meta.prospectName} can
              reduce addressable storage costs by {formatPercent(costModel.savingsPercent)}, saving {formatCurrency(costModel.monthlySavings)}/month.
              {costModel.udmEnabled
                ? ' Migration costs are covered by Backblaze through the Universal Data Migration program — there is no upfront cost to migrate.'
                : costModel.breakEvenMonth ? ` Migration costs of ${formatCurrency(costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost)} are recovered within ${costModel.breakEvenMonth} month${costModel.breakEvenMonth !== 1 ? 's' : ''}.` : ''}
            </p>
          </div>

          {(() => {
            const programs = pricingDetection.filter(r => r.category === 'discount-program');
            if (programs.length === 0) return null;
            const effectiveRate = programs[0].effectiveRate;
            const listRate = programs[0].listRate;
            return (
              <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200 print:break-inside-avoid">
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                  <p className="text-sm font-semibold text-amber-800">Discounted pricing detected</p>
                </div>
                <p className="text-xs text-amber-700 mb-2">
                  This analysis reflects the customer&apos;s negotiated rates, not list pricing. The following discount programs are applied on their current bill:
                </p>
                <div className="space-y-1">
                  {programs.map((p, i) => {
                    const pctOff = p.storagePercentOff || p.discountPercent || 0;
                    return (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-amber-800">
                          {p.programName}
                          {pctOff > 0 && (
                            <span className="text-amber-600 ml-1">(~{formatPercent(pctOff)} off list)</span>
                          )}
                        </span>
                        <span className="font-medium text-amber-900">-{formatCurrency(p.totalAmountUsd || 0)}</span>
                      </div>
                    );
                  })}
                </div>
                {effectiveRate > 0 && listRate > 0 && (
                  <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between text-xs">
                    <span className="text-amber-800 font-medium">Effective storage rate</span>
                    <span className="font-semibold text-amber-900">
                      ~${(effectiveRate * 1000).toFixed(2)}/TB/mo
                      <span className="font-normal text-amber-600 ml-1">(list: ${(listRate * 1000).toFixed(2)}/TB)</span>
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
        <h2 className="text-lg font-semibold mb-4 border-l-4 border-bb-red pl-3">Storage tier comparison</h2>
        <table className="w-full text-xs">
          <thead className="bg-bb-navy text-white">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Storage Class</th>
              <th className="px-3 py-2 text-left font-medium">Region</th>
              <th className="px-3 py-2 text-right font-medium">GB Stored</th>
              <th className="px-3 py-2 text-right font-medium">Current Cost</th>
              <th className="px-3 py-2 text-right font-medium">B2 Cost</th>
              <th className="px-3 py-2 text-right font-medium">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {migratedTiers.map((tier) => (
              <tr key={tier.id}>
                <td className="px-3 py-2 font-medium">{tier.storageClass}</td>
                <td className="px-3 py-2 text-gray-600">{tier.region}</td>
                <td className="px-3 py-2 text-right">{formatNumber(tier.gbStored)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(tier.totalTrueCost)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(tier.modeledB2Cost)}</td>
                <td className="px-3 py-2 text-right text-green-700 font-medium">{formatCurrency(tier.delta)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-medium bg-gray-50">
            <tr>
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right">{formatNumber(migratedTiers.reduce((s, t) => s + t.gbStored, 0))}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(migratedTiers.reduce((s, t) => s + t.totalTrueCost, 0))}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(migratedTiers.reduce((s, t) => s + t.modeledB2Cost, 0))}</td>
              <td className="px-3 py-2 text-right text-green-700">{formatCurrency(migratedTiers.reduce((s, t) => s + t.delta, 0))}</td>
            </tr>
          </tfoot>
        </table>

        {costModel.udmEnabled ? (
          <div className="mt-8 keep-together">
            <h3 className="text-sm font-semibold mb-3 border-l-4 border-bb-red pl-3">Data migration</h3>
            <div className="p-4 bg-gray-50 rounded-lg mb-3">
              <p className="text-xs font-semibold text-gray-500 tracking-wide mb-2">Cost to leave hyperscaler</p>
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
                    <span className="text-gray-600">Cold-tier restore fees</span>
                    <span>{formatCurrency(costModel.migrationCost.restoreCost)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
                  <span>Total egress cost</span>
                  <span>{formatCurrency(costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost)}</span>
                </div>
              </div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-green-800">Covered by Backblaze</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    Backblaze covers your migration costs through the Universal Data Migration (UDM) program.
                  </p>
                </div>
                <span className="text-lg font-bold text-green-800">$0</span>
              </div>
            </div>
          </div>
        ) : (costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost) > 0 ? (
          <div className="mt-8 p-4 bg-amber-50 rounded-lg">
            <h3 className="text-sm font-semibold mb-2">One-time migration cost</h3>
            <div className="text-sm space-y-1">
              {costModel.migrationCost.egressCost > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Data egress from hyperscaler</span>
                  <span>{formatCurrency(costModel.migrationCost.egressCost)}</span>
                </div>
              )}
              {costModel.migrationCost.restoreCost > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Cold-tier restore fees</span>
                  <span>{formatCurrency(costModel.migrationCost.restoreCost)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-1">
                <span>Total migration cost</span>
                <span>{formatCurrency(costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Projections */}
      <div className="p-8">
        <h2 className="text-lg font-semibold mb-4 border-l-4 border-bb-red pl-3">Cost projections ({termYears}-year)</h2>
        <p className="text-sm text-gray-600 mb-6">
          Based on current pricing with {modelConfig?.egressConfig.dataGrowthRatePercent || 10}% annual storage growth.
        </p>

        <table className="w-full text-xs">
          <thead className="bg-bb-navy text-white">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Current Cost</th>
              <th className="px-3 py-2 text-right font-medium">B2 Cost</th>
              <th className="px-3 py-2 text-right font-medium">Monthly Savings</th>
              <th className="px-3 py-2 text-right font-medium">Cumulative Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {projections
              .filter((_, i) => i === 0 || (i + 1) % 6 === 0 || i === projections.length - 1)
              .map((p) => (
                <tr key={p.month} className={p.cumulativeSavings >= 0 ? '' : 'text-gray-400'}>
                  <td className="px-3 py-2">{p.month}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(p.currentCost)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(p.b2Cost)}</td>
                  <td className="px-3 py-2 text-right text-green-700">{formatCurrency(p.monthlySavings)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(p.cumulativeSavings)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Assumptions */}
      <div className="p-8">
        <h2 className="text-lg font-semibold mb-4 border-l-4 border-bb-red pl-3">Assumptions & sources</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            <tr>
              <td className="py-2 font-medium text-gray-600 w-1/3">Source Bill</td>
              <td className="py-2">{meta.provider.toUpperCase()} {meta.billType} — {meta.billingPeriod || 'N/A'}</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">B2 Storage Price</td>
              <td className="py-2">${modelConfig?.b2PricePerTb || b2Pricing.storage.perTbMonth}/TB/month (list: ${b2Pricing.storage.perTbMonth})</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">B2 Transactions</td>
              <td className="py-2">Free (all standard API classes)</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">B2 Egress</td>
              <td className="py-2">3x stored data free, $0.01/GB overage</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Growth Rate</td>
              <td className="py-2">{modelConfig?.egressConfig.dataGrowthRatePercent || 10}% annual</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Projection Term</td>
              <td className="py-2">{modelConfig?.projectionTermMonths || 36} months</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">Pricing Date</td>
              <td className="py-2">June 2026 (verified against published rates)</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-8 p-4 bg-gray-50 rounded-lg keep-together">
          <p className="text-xs text-gray-500 leading-relaxed">
            This analysis is based on the billing data provided and current published pricing.
            Actual costs may vary based on usage patterns, negotiated rates, and pricing changes.
            All B2 pricing reflects standard pay-as-you-go rates unless otherwise noted.
            Migration costs are one-time estimates based on hyperscaler egress rates at the time of analysis.
          </p>
        </div>

        <div className="mt-8 pt-4 border-t-2 border-bb-red text-center text-sm text-gray-400">
          <p>
            Prepared by {aeInfo
              ? `${aeInfo.name}${aeInfo.title ? `, ${aeInfo.title}` : ''} (${aeInfo.email}) — `
              : ''}Backblaze | {new Date().toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
