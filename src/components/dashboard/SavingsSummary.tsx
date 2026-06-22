'use client';

import type { CostModelResult } from '@/types/model';
import { formatCurrency, formatPercent } from '../shared/FormatCurrency';

interface SavingsSummaryProps {
  result: CostModelResult;
}

export function SavingsSummary({ result }: SavingsSummaryProps) {
  const positive = result.monthlySavings > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <div className={`rounded-lg p-5 border-l-4 ${positive ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-400'}`}>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monthly Savings</p>
        <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-700' : 'text-red-600'}`}>
          {formatCurrency(result.monthlySavings)}
        </p>
      </div>

      <div className={`rounded-lg p-5 border-l-4 ${positive ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-400'}`}>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Annual Savings</p>
        <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-700' : 'text-red-600'}`}>
          {formatCurrency(result.annualSavings)}
        </p>
      </div>

      <div className={`rounded-lg p-5 border-l-4 ${positive ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-400'}`}>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Savings %</p>
        <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-700' : 'text-red-600'}`}>
          {formatPercent(result.savingsPercent)}
        </p>
      </div>

      <div className={`rounded-lg p-5 border-l-4 ${
        result.udmEnabled ? 'bg-green-50 border-green-500' : 'bg-gray-50 border-gray-300'
      }`}>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Migration Cost</p>
        <p className={`text-2xl font-bold mt-1 ${result.udmEnabled ? 'text-green-700' : 'text-gray-900'}`}>
          {result.udmEnabled ? '$0' : formatCurrency(result.migrationCost.egressCost + result.migrationCost.restoreCost)}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {result.udmEnabled
            ? 'Covered by Backblaze UDM'
            : result.breakEvenMonth
              ? `Break-even: Month ${result.breakEvenMonth}`
              : positive ? 'Immediate savings' : 'No break-even within term'}
        </p>
      </div>
    </div>
  );
}
