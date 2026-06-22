'use client';

import type { CostModelResult } from '@/types/model';
import { formatCurrency } from '../shared/FormatCurrency';

interface CostBreakdownProps {
  result: CostModelResult;
}

export function CostBreakdown({ result }: CostBreakdownProps) {
  const { currentMonthly, b2Monthly, eliminatedFees, newCosts } = result;

  const eliminatedTotal = eliminatedFees.reduce((s, f) => s + f.amountUsd, 0);
  const newCostTotal = newCosts.reduce((s, c) => s + c.amountUsd, 0);
  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Cost Breakdown</h3>
      </div>
      <div className="p-6 space-y-8">
        {/* Current bill */}
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

        {/* Savings walkthrough */}
        <div className="bg-gray-50 rounded-lg p-5">
          <h4 className="text-xs font-semibold text-gray-500 tracking-wide mb-4">Savings Calculation</h4>

          <div className="space-y-3">
            {/* What's being migrated */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Costs Eliminated by Migrating to B2</p>
              <div className="space-y-1.5 pl-3 border-l-2 border-green-300">
                {eliminatedFees.map((fee, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-600">{fee.description}</span>
                    <span className="text-green-700 font-medium">{formatCurrency(fee.amountUsd)}</span>
                  </div>
                ))}
              </div>
              {eliminatedFees.length > 1 && (
                <div className="flex justify-between text-sm font-medium mt-2 pl-3">
                  <span className="text-gray-700">Total Eliminated</span>
                  <span className="text-green-700">{formatCurrency(eliminatedTotal)}</span>
                </div>
              )}
            </div>

            {/* What replaces it */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Replaced By</p>
              <div className="space-y-1.5 pl-3 border-l-2 border-blue-300">
                <Row label="B2 Storage" value={b2Monthly.storage} />
                <Row label="B2 Egress" value={b2Monthly.egress} />
                <Row label="B2 Transactions" value={b2Monthly.transactions} />
                {newCosts.map((cost, i) => (
                  <div key={i} className="flex justify-between text-sm text-gray-600">
                    <span>{cost.description}</span>
                    <span>{formatCurrency(cost.amountUsd)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-medium mt-2 pl-3">
                <span className="text-gray-700">Total B2 Costs</span>
                <span className="text-gray-900">{formatCurrency(b2Monthly.total + newCostTotal)}</span>
              </div>
            </div>

            {/* Net savings */}
            <div className="border-t-2 border-gray-300 pt-3 mt-1">
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>{formatCurrency(eliminatedTotal)} eliminated − {formatCurrency(b2Monthly.total + newCostTotal)} B2 costs</span>
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

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  if (value === 0 && !bold) return null;
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );
}
