'use client';

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { ProjectionPoint } from '@/types/model';
import { formatCurrency } from '../shared/FormatCurrency';
import { AnimatedMetricValue } from '../shared/AnimatedMetricValue';

interface ProjectionChartProps {
  points: ProjectionPoint[];
  termMonths: number;
  onTermChange: (months: number) => void;
  growthLabel: string;
  providerLabel?: string;
}

export function ProjectionChart({
  points,
  termMonths,
  onTermChange,
  growthLabel,
  providerLabel = 'Current Provider',
}: ProjectionChartProps) {
  const breakEven = points.find((p) => p.cumulativeSavings >= 0);
  const finalPoint = points[points.length - 1];
  const totalSavings = finalPoint?.cumulativeSavings ?? 0;
  const endingStorageGb = finalPoint?.storageGb ?? 0;
  const endingMonthlySavings = finalPoint?.monthlySavings ?? 0;
  const xAxisTicks = getXAxisTicks(termMonths);
  const savingsTrend =
    endingMonthlySavings > 0
      ? `The gap between ${providerLabel} and Backblaze B2 widens with storage growth, reaching ${formatCurrency(endingMonthlySavings)}/month across ${formatStorage(endingStorageGb)}.`
      : `The projection does not show monthly savings by the final month across ${formatStorage(endingStorageGb)}.`;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex flex-col gap-4 border-b border-gray-200 px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Cost projections</h3>
          <p className="mt-1 text-sm text-gray-500">
            {formatTerm(termMonths)} projection · {growthLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[12, 24, 36, 60].map((m) => (
            <button
              key={m}
              onClick={() => onTermChange(m)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                termMonths === m
                  ? 'bg-bb-red text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {formatShortTerm(m)}
            </button>
          ))}
        </div>
      </div>
      <div className="p-6">
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <ChartMetric label="Total savings" value={totalSavings} formatter={formatCurrency} tone="savings" />
          <ChartMetric label="Final monthly savings" value={endingMonthlySavings} formatter={formatCurrency} tone="savings" />
          <ChartMetric label="Break-even" value={breakEven ? `Month ${breakEven.month}` : 'Not in term'} />
          <ChartMetric label="Ending storage" value={endingStorageGb} formatter={formatStorage} />
        </div>

        <p className="mb-4 text-sm font-medium text-gray-600">{savingsTrend}</p>

        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-gray-600">
          <ChartLegendItem colorClass="bg-slate-500" label={providerLabel} />
          <ChartLegendItem colorClass="bg-bb-red" label="Backblaze B2" />
          <ChartLegendItem colorClass="bg-emerald-600" label="Cumulative Savings" />
        </div>

        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 14, right: 12, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="projectionSavings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                type="number"
                domain={[1, termMonths]}
                ticks={xAxisTicks}
                interval={0}
                allowDecimals={false}
                axisLine={{ stroke: '#e5e7eb' }}
                tick={{ fill: '#6b7280', fontSize: 12 }}
                tickLine={false}
                tickFormatter={formatMonthTick}
              />
              <YAxis
                yAxisId="cost"
                axisLine={false}
                tick={{ fill: '#6b7280', fontSize: 12 }}
                tickFormatter={formatCompactCurrency}
                tickLine={false}
                width={64}
              />
              <YAxis
                yAxisId="savings"
                orientation="right"
                axisLine={false}
                tick={{ fill: '#6b7280', fontSize: 12 }}
                tickFormatter={formatCompactCurrency}
                tickLine={false}
                width={64}
              />
              <Tooltip
                content={(props) => <ProjectionTooltip {...props} providerLabel={providerLabel} />}
                cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4' }}
              />
              <ReferenceLine yAxisId="savings" y={0} stroke="#d1d5db" strokeDasharray="4 4" />
              {breakEven && (
                <ReferenceLine
                  x={breakEven.month}
                  stroke="#111827"
                  strokeDasharray="4 4"
                  label={{ value: 'Break-Even', position: 'top', fill: '#4b5563', fontSize: 12 }}
                />
              )}
              <Area
                yAxisId="savings"
                type="monotone"
                dataKey="cumulativeSavings"
                stroke="#16a34a"
                fill="url(#projectionSavings)"
                strokeWidth={2.5}
                dot={false}
                name="Cumulative Savings"
              />
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="currentCost"
                stroke="#64748b"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0 }}
                name={providerLabel}
              />
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="b2Cost"
                stroke="#D1232A"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0 }}
                name="Backblaze B2"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ChartMetric({
  label,
  value,
  formatter,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  formatter?: (value: number) => string;
  tone?: 'default' | 'savings';
}) {
  const valueClass = tone === 'savings' ? 'text-emerald-700' : 'text-gray-900';

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueClass}`}>
        {typeof value === 'number'
          ? <AnimatedMetricValue value={value} formatter={formatter} />
          : value}
      </p>
    </div>
  );
}

function ChartLegendItem({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
      {label}
    </span>
  );
}

function formatTerm(months: number): string {
  const years = months / 12;
  return `${years.toLocaleString(undefined, { maximumFractionDigits: 1 })}-year`;
}

function formatShortTerm(months: number): string {
  return `${months / 12}Y`;
}

function getXAxisTicks(termMonths: number): number[] {
  if (termMonths <= 12) return [1, 3, 6, 9, 12].filter((month) => month <= termMonths);
  if (termMonths <= 24) return [1, 6, 12, 18, 24].filter((month) => month <= termMonths);
  if (termMonths <= 36) return [1, 6, 12, 18, 24, 30, 36].filter((month) => month <= termMonths);
  return [1, 12, 24, 36, 48, 60].filter((month) => month <= termMonths);
}

function formatMonthTick(value: number): string {
  const month = Number(value);
  if (month > 0 && month % 12 === 0) return `${month / 12}Y`;
  return `M${month}`;
}

function formatCompactCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1_000_000) {
    const decimals = abs >= 10_000_000 ? 0 : 1;
    return `${sign}$${(abs / 1_000_000).toFixed(decimals)}M`;
  }

  if (abs >= 1_000) {
    const decimals = abs >= 100_000 ? 0 : 1;
    return `${sign}$${(abs / 1_000).toFixed(decimals)}k`;
  }

  return formatCurrency(value, 0);
}

function formatStorage(gb: number): string {
  const tb = gb / 1000;
  return `${tb.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} TB`;
}

function ProjectionTooltip({
  active,
  payload,
  label,
  providerLabel,
}: TooltipContentProps & { providerLabel: string }) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload as ProjectionPoint | undefined;
  if (!point) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-gray-900">Month {point.month || label}</p>
      <div className="space-y-1.5">
        <TooltipRow label="Data Stored" value={formatStorage(point.storageGb)} />
        <TooltipRow label={providerLabel} value={formatCurrency(point.currentCost)} colorClass="bg-slate-500" />
        <TooltipRow label="Backblaze B2" value={formatCurrency(point.b2Cost)} colorClass="bg-bb-red" />
        <TooltipRow label="Monthly Savings" value={formatCurrency(point.monthlySavings)} colorClass="bg-emerald-500" />
        <TooltipRow label="Cumulative Savings" value={formatCurrency(point.cumulativeSavings)} colorClass="bg-green-600" />
      </div>
    </div>
  );
}

function TooltipRow({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div className="flex min-w-48 items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-gray-500">
        {colorClass && <span className={`h-2 w-2 rounded-full ${colorClass}`} />}
        {label}
      </span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  );
}
