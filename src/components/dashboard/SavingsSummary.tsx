'use client';

import type { CostModelResult } from '@/types/model';
import { formatCurrency, formatPercent } from '../shared/FormatCurrency';
import { AnimatedMetricValue } from '../shared/AnimatedMetricValue';

interface SavingsSummaryProps {
  result: CostModelResult;
}

export function SavingsSummary({ result }: SavingsSummaryProps) {
  const positive = result.monthlySavings > 0;
  const migrationCost = result.udmEnabled ? 0 : result.migrationCost.egressCost + result.migrationCost.restoreCost;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <div className={`rounded-lg p-5 border-l-4 ${positive ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-400'}`}>
        <p className="text-xs font-medium text-gray-500 tracking-wide">Monthly savings</p>
        <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-700' : 'text-red-600'}`}>
          <AnimatedMetricValue value={result.monthlySavings} formatter={formatCurrency} />
        </p>
      </div>

      <div className={`rounded-lg p-5 border-l-4 ${positive ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-400'}`}>
        <p className="text-xs font-medium text-gray-500 tracking-wide">Annual savings</p>
        <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-700' : 'text-red-600'}`}>
          <AnimatedMetricValue value={result.annualSavings} formatter={formatCurrency} />
        </p>
      </div>

      <div className={`rounded-lg p-5 border-l-4 ${positive ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-400'}`}>
        <p className="text-xs font-medium text-gray-500 tracking-wide">Savings rate</p>
        <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-700' : 'text-red-600'}`}>
          <AnimatedMetricValue value={result.savingsPercent} formatter={formatPercent} />
        </p>
      </div>

      <div className={`rounded-lg p-5 border-l-4 ${
        result.udmEnabled ? 'bg-green-50 border-green-500' : 'bg-gray-50 border-gray-300'
      }`}>
        <p className="text-xs font-medium text-gray-500 tracking-wide">Migration cost</p>
        <p className={`text-2xl font-bold mt-1 ${result.udmEnabled ? 'text-green-700' : 'text-gray-900'}`}>
          <AnimatedMetricValue value={migrationCost} formatter={formatMigrationCost} />
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {result.udmEnabled
            ? 'Covered by Backblaze UDM'
              : result.breakEvenMonth
              ? `Break-even: month ${result.breakEvenMonth}`
              : positive ? 'Immediate savings' : 'No break-even within term'}
        </p>
      </div>
    </div>
  );
}

function formatMigrationCost(value: number): string {
  return value === 0 ? '$0' : formatCurrency(value);
}
