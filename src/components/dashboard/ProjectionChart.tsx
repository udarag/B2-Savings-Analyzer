'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { ProjectionPoint } from '@/types/model';
import { formatCurrency } from '../shared/FormatCurrency';

interface ProjectionChartProps {
  points: ProjectionPoint[];
  termMonths: number;
  onTermChange: (months: number) => void;
}

export function ProjectionChart({ points, termMonths, onTermChange }: ProjectionChartProps) {
  const breakEven = points.find((p) => p.cumulativeSavings >= 0);
  const totalSavings = points.length > 0 ? points[points.length - 1].cumulativeSavings : 0;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Cost Projections</h3>
          <p className="text-sm text-gray-500 mt-1">
            {breakEven
              ? `Break-even at month ${breakEven.month}. Total ${termMonths}-month savings: ${formatCurrency(totalSavings)}`
              : `Total ${termMonths}-month savings: ${formatCurrency(totalSavings)}`}
          </p>
        </div>
        <div className="flex gap-2">
          {[12, 36, 60].map((m) => (
            <button
              key={m}
              onClick={() => onTermChange(m)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                termMonths === m
                  ? 'bg-bb-red text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {m / 12}yr
            </button>
          ))}
        </div>
      </div>
      <div className="p-6">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12 }}
                label={{ value: 'Month', position: 'insideBottomRight', offset: -5, style: { fontSize: 12 } }}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  formatCurrency(Number(value)),
                  String(name) === 'currentCost' ? 'Current Costs' :
                  String(name) === 'b2Cost' ? 'B2 Costs' :
                  'Cumulative Savings',
                ]}
                labelFormatter={(label: unknown) => `Month ${label}`}
              />
              <Legend
                formatter={(value: string) =>
                  value === 'currentCost' ? 'Current Costs' :
                  value === 'b2Cost' ? 'B2 Costs' :
                  'Cumulative Savings'
                }
              />
              <Area
                type="monotone"
                dataKey="cumulativeSavings"
                stroke="#16a34a"
                fill="#dcfce7"
                fillOpacity={0.5}
                strokeWidth={2}
              />
              <Line type="monotone" dataKey="currentCost" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="b2Cost" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
