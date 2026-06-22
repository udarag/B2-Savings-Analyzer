'use client';

import type { CostModelResult } from '@/types/model';
import { formatCurrency } from '../shared/FormatCurrency';

interface CostBreakdownProps {
  result: CostModelResult;
}

export function CostBreakdown({ result }: CostBreakdownProps) {
  const { currentMonthly, b2Monthly, eliminatedFees, newCosts } = result;

  const eliminatedTotal = eliminatedFees.reduce((s, f) => s + f.amountUsd, 0);
  const newCostTotal = roundCurrency(newCosts.reduce((s, c) => s + c.amountUsd, 0));
  const replacementCostTotal = roundCurrency(b2Monthly.total + newCostTotal);
  const newMonthlyBill = roundCurrency(currentMonthly.total - result.monthlySavings);
  const currentProviderCostsThatStay = roundCurrency(newMonthlyBill - replacementCostTotal);
  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Cost Breakdown</h3>
      </div>
      <div className="p-6 space-y-6">
        <div className="border-b border-gray-200 pb-6">
          <h4 className="text-xs font-semibold text-gray-500 tracking-wide mb-4">Monthly Cost Comparison</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Metric label="Current Monthly Bill" value={currentMonthly.total} />
            <Metric label="New Monthly Bill with B2" value={newMonthlyBill} tone="b2" />
            <Metric label="Net Monthly Savings" value={result.monthlySavings} tone="savings" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
            <span>{formatCurrency(currentMonthly.total)} current bill</span>
            <span>-</span>
            <span className="font-medium text-bb-red-dark">{formatCurrency(newMonthlyBill)} new bill</span>
            <span>=</span>
            <span className="font-medium text-green-700">{formatCurrency(result.monthlySavings)} savings</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h4 className="text-xs font-semibold text-gray-500 tracking-wide mb-3">Current Monthly Bill</h4>
            <div className="space-y-2">
              <Row label="Storage" value={currentMonthly.storage} />
              <Row label="Egress" value={currentMonthly.egress} />
              <Row label="Operations" value={currentMonthly.operations} />
              <Row label="Retrieval" value={currentMonthly.retrieval} />
              <Row label="Other Fees" value={currentMonthly.otherFees} />
              <div className="border-t pt-2 mt-2">
                <Row label="Total" value={currentMonthly.total} bold />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 tracking-wide mb-3">New Monthly Bill with Backblaze B2</h4>
            <div className="space-y-2">
              <Row label="Current-provider charges that stay" value={currentProviderCostsThatStay} showZero />
              <Row label="Backblaze B2 monthly charges" value={b2Monthly.total} tone="b2" />
              <Row label="Other new modeled charges" value={newCostTotal} />
              <div className="border-t pt-2 mt-2">
                <Row label="Total" value={newMonthlyBill} bold tone="b2" />
              </div>
            </div>
          </div>
        </div>

        {/* Savings walkthrough */}
        <div className="bg-gray-50 rounded-lg p-5">
          <h4 className="text-xs font-semibold text-gray-500 tracking-wide mb-4">Savings Detail</h4>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Current-provider costs removed</p>
              <div className="space-y-1.5 pl-3 border-l-2 border-green-300">
                {eliminatedFees.map((fee, i) => (
                  <div key={i} className="flex justify-between gap-4 text-sm">
                    <span className="min-w-0 text-gray-600">{fee.description}</span>
                    <span className="shrink-0 text-green-700 font-medium">{formatCurrency(fee.amountUsd)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-4 text-sm font-medium mt-2 pl-3">
                <span className="text-gray-700">Total removed</span>
                <span className="shrink-0 text-green-700">{formatCurrency(eliminatedTotal)}</span>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1.5">New B2 and modeled replacement costs</p>
              <div className="space-y-1.5 pl-3 border-l-2 border-bb-red/60">
                <Row label="B2 Storage" value={b2Monthly.storage} tone="b2" />
                <Row label="B2 Egress" value={b2Monthly.egress} tone="b2" />
                <Row label="B2 Transactions" value={b2Monthly.transactions} tone="b2" />
                {newCosts.map((cost, i) => (
                  <div key={i} className="flex justify-between gap-4 text-sm text-gray-600">
                    <span className="min-w-0">{cost.description}</span>
                    <span className="shrink-0">{formatCurrency(cost.amountUsd)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-4 text-sm font-medium mt-2 pl-3">
                <span className="text-gray-700">Total replacement cost</span>
                <span className="shrink-0 text-bb-red-dark">{formatCurrency(replacementCostTotal)}</span>
              </div>
            </div>

            {result.partnerComputeScenario && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
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

            {/* Net savings */}
            <div className="border-t-2 border-gray-300 pt-3 mt-1">
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>{formatCurrency(eliminatedTotal)} removed - {formatCurrency(replacementCostTotal)} replacement cost</span>
              </div>
              <div className="flex justify-between font-semibold text-base">
                <span className="text-green-800">Net Monthly Savings</span>
                <span className="text-green-700">{formatCurrency(result.monthlySavings)}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'b2' | 'savings';
}) {
  const valueClass = getValueClass(tone, value);

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{formatCurrency(value)}</p>
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
