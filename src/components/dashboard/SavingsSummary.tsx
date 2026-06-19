'use client';

import type { CostModelResult } from '@/types/model';
import { formatCurrency, formatPercent } from '../shared/FormatCurrency';

interface SavingsSummaryProps {
  result: CostModelResult;
}

export function SavingsSummary({ result }: SavingsSummaryProps) {
  const cards = [
    {
      label: 'Monthly Savings',
      value: formatCurrency(result.monthlySavings),
      color: result.monthlySavings > 0 ? 'text-green-700' : 'text-red-600',
      bg: result.monthlySavings > 0 ? 'bg-green-50' : 'bg-red-50',
    },
    {
      label: 'Annual Savings',
      value: formatCurrency(result.annualSavings),
      color: result.annualSavings > 0 ? 'text-green-700' : 'text-red-600',
      bg: result.annualSavings > 0 ? 'bg-green-50' : 'bg-red-50',
    },
    {
      label: 'Savings %',
      value: formatPercent(result.savingsPercent),
      color: result.savingsPercent > 0 ? 'text-green-700' : 'text-red-600',
      bg: 'bg-bb-red-light',
    },
    {
      label: 'Migration Cost',
      value: result.udmEnabled ? '$0' : formatCurrency(result.migrationCost.egressCost + result.migrationCost.restoreCost),
      sublabel: result.udmEnabled
        ? 'Covered by Backblaze UDM'
        : result.breakEvenMonth
          ? `Break-even: month ${result.breakEvenMonth}`
          : result.monthlySavings > 0 ? 'Immediate savings' : 'No break-even within term',
      color: result.udmEnabled ? 'text-green-700' : 'text-gray-900',
      bg: result.udmEnabled ? 'bg-green-50' : 'bg-amber-50',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className={`${card.bg} rounded-lg p-5`}>
          <p className="text-sm font-medium text-gray-600 mb-1">{card.label}</p>
          <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          {card.sublabel && (
            <p className="text-xs text-gray-500 mt-1">{card.sublabel}</p>
          )}
        </div>
      ))}
    </div>
  );
}
