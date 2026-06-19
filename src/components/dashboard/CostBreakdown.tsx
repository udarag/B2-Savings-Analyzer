'use client';

import type { CostModelResult } from '@/types/model';
import { formatCurrency } from '../shared/FormatCurrency';

interface CostBreakdownProps {
  result: CostModelResult;
}

export function CostBreakdown({ result }: CostBreakdownProps) {
  const { currentMonthly, b2Monthly, eliminatedFees, newCosts } = result;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Cost Breakdown</h3>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Current Costs */}
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Current Hyperscaler Costs</h4>
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

          {/* B2 Costs */}
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Projected B2 Costs</h4>
            <div className="space-y-2">
              <Row label="B2 Storage" value={b2Monthly.storage} />
              <Row label="B2 Egress" value={b2Monthly.egress} />
              <Row label="B2 Transactions" value={b2Monthly.transactions} />
              <div className="border-t pt-2 mt-2">
                <Row label="Total" value={b2Monthly.total} bold />
              </div>
            </div>
          </div>
        </div>

        {/* Eliminated fees */}
        {eliminatedFees.length > 0 && (
          <div className="mt-6 pt-6 border-t">
            <h4 className="font-medium text-green-800 mb-3">Eliminated Fees</h4>
            <div className="space-y-1">
              {eliminatedFees.map((fee, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-600">{fee.description}</span>
                  <span className="text-green-700 font-medium">
                    -{formatCurrency(fee.amountUsd)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* New costs */}
        {newCosts.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="font-medium text-amber-800 mb-3">New Costs</h4>
            <div className="space-y-1">
              {newCosts.map((cost, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-600">{cost.description}</span>
                  <span className="text-amber-700 font-medium">
                    +{formatCurrency(cost.amountUsd)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
