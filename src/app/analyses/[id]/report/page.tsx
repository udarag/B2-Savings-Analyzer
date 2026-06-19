'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { Analysis, ParsedBill, ModelConfig, TierInventoryRow } from '@/types/analysis';
import type { CostModelResult, ProjectionPoint } from '@/types/model';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { computeCostModel } from '@/lib/engine/cost-model';
import { computeProjections } from '@/lib/engine/projections';
import { formatCurrency, formatNumber, formatPercent } from '@/components/shared/FormatCurrency';

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
    return <div className="p-12 text-gray-500">Loading report...</div>;
  }

  const migratedTiers = tiers.filter((t) => t.migrateToB2);
  const totalSavings = projections.length > 0 ? projections[projections.length - 1].cumulativeSavings : 0;
  const termYears = (modelConfig?.projectionTermMonths || 36) / 12;

  return (
    <div className="report-container max-w-4xl mx-auto bg-white print:max-w-none">
      <style>{`
        @media print {
          @page { size: letter; margin: 0.75in; }
          .page-break { break-before: page; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Print button */}
      <div className="no-print p-4 text-center bg-gray-100">
        <button
          onClick={() => window.print()}
          className="px-6 py-2 bg-bb-red text-white rounded-lg hover:bg-bb-red-dark"
        >
          Print / Save as PDF
        </button>
      </div>

      {/* Page 1: Executive Summary */}
      <div className="p-8">
        <div className="flex items-center gap-3 mb-8">
          <img src="/backblaze-webclip.png" alt="Backblaze" className="w-10 h-10" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Cloud Storage Cost Analysis</h1>
            <p className="text-sm text-gray-500">Prepared for {meta.prospectName}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-green-50 rounded-lg p-5 text-center">
            <p className="text-sm text-gray-600 mb-1">Monthly Savings</p>
            <p className="text-2xl font-bold text-green-700">{formatCurrency(costModel.monthlySavings)}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-5 text-center">
            <p className="text-sm text-gray-600 mb-1">Annual Savings</p>
            <p className="text-2xl font-bold text-green-700">{formatCurrency(costModel.annualSavings)}</p>
          </div>
          <div className="bg-bb-red-light rounded-lg p-5 text-center">
            <p className="text-sm text-gray-600 mb-1">{termYears}-Year Savings</p>
            <p className="text-2xl font-bold text-bb-navy">{formatCurrency(totalSavings)}</p>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Summary</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            By migrating {migratedTiers.length} storage tier{migratedTiers.length !== 1 ? 's' : ''} ({formatNumber(migratedTiers.reduce((s, t) => s + t.gbStored, 0))} GB) to Backblaze B2 Cloud Storage, {meta.prospectName} can
            reduce addressable storage costs by {formatPercent(costModel.savingsPercent)}, saving {formatCurrency(costModel.monthlySavings)}/month.
            {costModel.udmEnabled
              ? ' Migration costs are covered by Backblaze through the Universal Data Migration program — there is no upfront cost to migrate.'
              : costModel.breakEvenMonth ? ` Migration costs of ${formatCurrency(costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost)} are recovered within ${costModel.breakEvenMonth} month${costModel.breakEvenMonth !== 1 ? 's' : ''}.` : ''}
          </p>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Eliminated Fees</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {costModel.eliminatedFees.map((fee, i) => (
                <tr key={i}>
                  <td className="py-2 text-gray-600">{fee.description}</td>
                  <td className="py-2 text-right font-medium text-green-700">-{formatCurrency(fee.amountUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Page 2: Tier Comparison */}
      <div className="page-break p-8">
        <h2 className="text-lg font-semibold mb-4">Storage Tier Comparison</h2>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Storage Class</th>
              <th className="px-3 py-2 text-left">Region</th>
              <th className="px-3 py-2 text-right">GB Stored</th>
              <th className="px-3 py-2 text-right">Current Cost</th>
              <th className="px-3 py-2 text-right">B2 Cost</th>
              <th className="px-3 py-2 text-right">Savings</th>
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
          <div className="mt-8 p-4 bg-green-50 rounded-lg">
            <h3 className="text-sm font-semibold mb-2">Migration Cost</h3>
            <p className="text-sm text-green-800">
              Migration costs are covered by Backblaze through the Universal Data Migration (UDM) program.
              There is no upfront cost to migrate your data.
            </p>
          </div>
        ) : (costModel.migrationCost.egressCost + costModel.migrationCost.restoreCost) > 0 ? (
          <div className="mt-8 p-4 bg-amber-50 rounded-lg">
            <h3 className="text-sm font-semibold mb-2">One-Time Migration Cost</h3>
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

      {/* Page 3: Projections */}
      <div className="page-break p-8">
        <h2 className="text-lg font-semibold mb-4">Cost Projections ({termYears}-Year)</h2>
        <p className="text-sm text-gray-600 mb-6">
          Based on current pricing with {modelConfig?.egressConfig.dataGrowthRatePercent || 10}% annual storage growth.
        </p>

        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-3 py-2 text-right">Current Cost</th>
              <th className="px-3 py-2 text-right">B2 Cost</th>
              <th className="px-3 py-2 text-right">Monthly Savings</th>
              <th className="px-3 py-2 text-right">Cumulative Savings</th>
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

      {/* Page 4: Assumptions */}
      <div className="page-break p-8">
        <h2 className="text-lg font-semibold mb-4">Assumptions & Sources</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            <tr>
              <td className="py-2 font-medium text-gray-600 w-1/3">Source Bill</td>
              <td className="py-2">{meta.provider.toUpperCase()} {meta.billType} — {meta.billingPeriod || 'N/A'}</td>
            </tr>
            <tr>
              <td className="py-2 font-medium text-gray-600">B2 Storage Price</td>
              <td className="py-2">${modelConfig?.b2PricePerTb || 6.95}/TB/month (list: $6.95)</td>
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

        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 leading-relaxed">
            This analysis is based on the billing data provided and current published pricing.
            Actual costs may vary based on usage patterns, negotiated rates, and pricing changes.
            All B2 pricing reflects standard pay-as-you-go rates unless otherwise noted.
            Migration costs are one-time estimates based on hyperscaler egress rates at the time of analysis.
          </p>
        </div>

        <div className="mt-8 text-center text-sm text-gray-400">
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
