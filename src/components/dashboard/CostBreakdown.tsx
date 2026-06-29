'use client';

import { useState } from 'react';
import type { Provider } from '@/types/analysis';
import type { CostModelResult } from '@/types/model';
import { getStorageScopeCurrentMonthly, getStorageScopeReplacementMonthly } from '@/lib/engine/cost-model';
import { formatCurrency } from '../shared/FormatCurrency';
import { AnimatedMetricValue } from '../shared/AnimatedMetricValue';
import { Collapse } from '../shared/Collapse';

interface CostBreakdownProps {
  result: CostModelResult;
  provider: Provider;
}

export function CostBreakdown({ result, provider }: CostBreakdownProps) {
  const { b2Monthly, eliminatedFees, newCosts } = result;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const eliminatedTotal = getStorageScopeCurrentMonthly(result);
  const newCostTotal = roundCurrency(newCosts.reduce((s, c) => s + c.amountUsd, 0));
  const replacementCostTotal = getStorageScopeReplacementMonthly(result);
  const currentBillLabel = `Current customer ${formatProviderName(provider)} bill`;
  const newB2BillLabel = 'New B2 bill';
  const hasSavings = result.monthlySavings > 0;
  const savingsPercent = eliminatedTotal > 0 ? Math.round((result.monthlySavings / eliminatedTotal) * 100) : 0;
  const currentScopeByCategory = eliminatedFees.reduce(
    (totals, fee) => {
      switch (fee.category) {
        case 'storage':
          totals.storage += fee.amountUsd;
          break;
        case 'egress':
          totals.egress += fee.amountUsd;
          break;
        case 'operations':
          totals.operations += fee.amountUsd;
          break;
        case 'retrieval':
          totals.retrieval += fee.amountUsd;
          break;
        default:
          totals.otherFees += fee.amountUsd;
      }
      return totals;
    },
    { storage: 0, egress: 0, operations: 0, retrieval: 0, otherFees: 0 },
  );

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Storage cost breakdown</h3>
        <p className="mt-1 text-sm text-gray-500">
          Monthly view of the modeled storage costs selected for migration. Non-storage spend is outside this view.
        </p>
      </div>

      <div className="p-6 space-y-5">
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Monthly cost comparison</h4>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
              Storage scope only
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
            <Metric
              label={currentBillLabel}
              value={eliminatedTotal}
              caption="Modeled monthly storage spend today"
            />
            <OperatorSymbol symbol="-" />
            <Metric
              label={newB2BillLabel}
              value={replacementCostTotal}
              tone="b2"
              caption="Estimated monthly B2 spend"
            />
            <OperatorSymbol symbol="=" />
            <Metric
              label="Net monthly savings"
              value={result.monthlySavings}
              tone="savings"
              caption={hasSavings && savingsPercent > 0 ? `${savingsPercent}% lower modeled bill` : 'Review savings assumptions'}
              emphasized
            />
          </div>
        </div>

        <div className={`rounded-lg border px-4 py-3 ${
          hasSavings
            ? 'border-green-200 bg-green-50 text-green-900'
            : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}>
          <p className="text-sm font-semibold">
            AE takeaway: {hasSavings ? 'B2 lowers the modeled monthly storage bill.' : 'This model needs a closer review.'}
          </p>
          <p className="mt-1 text-sm">
            {currentBillLabel} is {formatCurrency(eliminatedTotal)}. {newB2BillLabel} is {formatCurrency(replacementCostTotal)}.
            {' '}
            {hasSavings
              ? `That creates ${formatCurrency(result.monthlySavings)} in estimated monthly savings.`
              : `The modeled change is ${formatCurrency(result.monthlySavings)} per month.`}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <BillPanel
            title={currentBillLabel}
            total={eliminatedTotal}
            tone="current"
            rows={[
              { label: 'Storage', value: currentScopeByCategory.storage },
              { label: 'Egress', value: currentScopeByCategory.egress },
              { label: 'Operations', value: currentScopeByCategory.operations },
              { label: 'Retrieval and policy fees', value: currentScopeByCategory.retrieval },
              { label: 'Other storage-adjacent fees', value: currentScopeByCategory.otherFees },
            ]}
          />

          <BillPanel
            title={newB2BillLabel}
            total={replacementCostTotal}
            tone="b2"
            rows={[
              { label: 'B2 storage', value: b2Monthly.storage },
              { label: 'B2 egress', value: b2Monthly.egress },
              { label: 'B2 transactions', value: b2Monthly.transactions },
              { label: 'New storage-path data transfer', value: newCostTotal },
            ]}
          />
        </div>

        <div className="rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            aria-expanded={detailsOpen}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-gray-900">Line-item savings detail</p>
              <p className="mt-0.5 text-xs text-gray-500">For AE follow-up, SE review, or customer validation.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-700">
              {detailsOpen ? 'Hide details' : 'Show details'}
              <svg
                className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>

          <Collapse open={detailsOpen}>
            <div className="border-t border-gray-200 bg-gray-50 p-4">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Costs removed</p>
                  <div className="mt-3 space-y-2 border-l-2 border-green-300 pl-3">
                    {eliminatedFees.map((fee, i) => (
                      <div key={i} className="flex justify-between gap-4 text-sm">
                        <span className="min-w-0 text-gray-600">{fee.description}</span>
                        <span className="shrink-0 font-medium text-green-700">{formatCurrency(fee.amountUsd)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-between gap-4 border-t border-gray-200 pt-3 text-sm font-semibold">
                    <span className="text-gray-900">Total removed</span>
                    <span className="shrink-0 text-green-700">{formatCurrency(eliminatedTotal)}</span>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">New B2 bill</p>
                  <div className="mt-3 space-y-2 border-l-2 border-bb-red/60 pl-3">
                    <Row label="B2 Storage" value={b2Monthly.storage} tone="b2" showZero />
                    <Row label="B2 Egress" value={b2Monthly.egress} tone="b2" />
                    <Row label="B2 Transactions" value={b2Monthly.transactions} tone="b2" />
                    {newCosts.map((cost, i) => (
                      <div key={i} className="flex justify-between gap-4 text-sm text-gray-600">
                        <span className="min-w-0">{cost.description}</span>
                        <span className="shrink-0">{formatCurrency(cost.amountUsd)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-between gap-4 border-t border-gray-200 pt-3 text-sm font-semibold">
                    <span className="text-gray-900">Total new B2 bill</span>
                    <span className="shrink-0 text-bb-red-dark">{formatCurrency(replacementCostTotal)}</span>
                  </div>
                </div>
              </div>

              {result.partnerComputeScenario && (
                <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="font-medium text-emerald-900">Bandwidth alliance compute scenario</span>
                    <span className="font-semibold text-emerald-900">
                      {formatCurrency(result.partnerComputeScenario.monthlySavings)}/mo savings
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-emerald-800">
                    Avoids {formatCurrency(result.partnerComputeScenario.monthlyEgressAvoided)}/mo in hyperscaler-to-B2 processed-data egress.
                  </p>
                </div>
              )}

              <div className="mt-5 border-t-2 border-gray-300 pt-4">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>{formatCurrency(eliminatedTotal)} removed - {formatCurrency(replacementCostTotal)} new B2 bill</span>
                </div>
                <div className="mt-1 flex justify-between gap-4 text-base font-semibold">
                  <span className="text-green-800">Net storage-scope savings</span>
                  <span className="text-green-700">
                    <AnimatedMetricValue value={result.monthlySavings} formatter={formatCurrency} />
                  </span>
                </div>
              </div>
            </div>
          </Collapse>
        </div>
      </div>
    </div>
  );
}

function BillPanel({
  title,
  total,
  rows,
  tone,
}: {
  title: string;
  total: number;
  rows: Array<{ label: string; value: number }>;
  tone: 'current' | 'b2';
}) {
  const accentClass = tone === 'b2' ? 'border-bb-red/60' : 'border-gray-300';
  const totalTone = tone === 'b2' ? 'b2' : 'default';

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <p className={`mt-1 text-xl font-bold ${getValueClass(totalTone, total)}`}>
          <AnimatedMetricValue value={total} formatter={formatCurrency} />
        </p>
      </div>
      <div className={`space-y-2 border-l-2 pl-3 ${accentClass}`}>
        {rows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} tone={totalTone} />
        ))}
      </div>
    </div>
  );
}

function OperatorSymbol({ symbol }: { symbol: '-' | '=' }) {
  return (
    <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-500 md:flex">
      {symbol}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
  caption,
  emphasized = false,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'b2' | 'savings';
  caption?: string;
  emphasized?: boolean;
}) {
  const valueClass = getValueClass(tone, value);
  const containerClass = emphasized
    ? value >= 0
      ? 'rounded-lg border border-green-200 bg-green-50 p-4'
      : 'rounded-lg border border-amber-200 bg-amber-50 p-4'
    : 'rounded-lg border border-gray-200 bg-white p-4';

  return (
    <div className={containerClass}>
      <p className="text-xs font-semibold text-gray-500 tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>
        <AnimatedMetricValue value={value} formatter={formatCurrency} />
      </p>
      {caption && <p className="mt-1 text-xs text-gray-500">{caption}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  showZero = false,
  tone = 'default',
}: {
  label: string;
  value: number;
  bold?: boolean;
  showZero?: boolean;
  tone?: 'default' | 'b2' | 'savings';
}) {
  if (value === 0 && !bold && !showZero) return null;
  const labelClass = bold ? 'font-semibold text-gray-900' : 'text-gray-600';
  const valueClass = bold
    ? `font-semibold ${getValueClass(tone, value)}`
    : tone === 'default' ? 'text-gray-600' : getValueClass(tone, value);

  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className={`min-w-0 ${labelClass}`}>{label}</span>
      <span className={`shrink-0 ${valueClass}`}>{formatCurrency(value)}</span>
    </div>
  );
}

function getValueClass(tone: 'default' | 'b2' | 'savings', value: number): string {
  if (tone === 'b2') return 'text-bb-red-dark';
  if (tone === 'savings') return value >= 0 ? 'text-green-700' : 'text-red-600';
  return 'text-gray-900';
}

function roundCurrency(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
}

function formatProviderName(provider: Provider): string {
  switch (provider) {
    case 'aws':
      return 'AWS';
    case 'gcp':
      return 'GCP';
    case 'azure':
      return 'Azure';
    case 'r2':
      return 'Cloudflare R2';
  }
}
