'use client';

import { useEffect, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { ProjectionPoint } from '@/types/model';
import { formatCurrency } from '../shared/FormatCurrency';
import { AnimatedMetricValue } from '../shared/AnimatedMetricValue';
import { prefersReducedMotion } from '../shared/prefersReducedMotion';

interface ProjectionChartProps {
  /** One entry per projected month; assumed ordered month 1..termMonths. */
  points: ProjectionPoint[];
  termMonths: number;
  onTermChange: (months: number) => void;
  /** Human-readable growth assumption (e.g. "10%/yr growth"), shown in the subheader. */
  growthLabel: string;
  /** Label for the customer's existing provider line; falls back to a generic name when unknown. */
  providerLabel?: string;
}

/**
 * Multi-year cost-projection chart: customer-provider vs. B2 monthly cost over the term, with a
 * cumulative-savings area and break-even marker. Term length is selectable (12/24/36/60 months).
 */
export function ProjectionChart({
  points,
  termMonths,
  onTermChange,
  growthLabel,
  providerLabel = 'Current Provider',
}: ProjectionChartProps) {
  // Draw the lines on deliberately when the chart first mounts, then freeze the
  // animation. Recharts otherwise replays its draw-on every time the data changes,
  // which makes flipping the projection term feel busy; freezing after the initial
  // reveal lets term toggles update the lines in place. Starts off under
  // prefers-reduced-motion so nothing animates for those users.
  const [drawOn, setDrawOn] = useState(() => !prefersReducedMotion());
  useEffect(() => {
    if (!drawOn) return;
    // Longest series finishes at animationBegin (300) + animationDuration (1100);
    // a little headroom past that, then stop animating.
    const timer = window.setTimeout(() => setDrawOn(false), 1500);
    return () => window.clearTimeout(timer);
  }, [drawOn]);

  // Break-even = first month cumulative savings turn non-negative (repaid the one-time migration cost).
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
    // Design-system card: rounded-2xl surface with soft border + shadow.
    <div className="rounded-2xl border border-c-border bg-c-surface shadow-sm">
      <div className="flex flex-col gap-4 border-b border-c-border px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-c-text">Cost projections</h3>
          <p className="mt-1 text-sm text-c-muted">
            {formatTerm(termMonths)} projection · {growthLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[12, 24, 36, 60].map((m) => (
            <button
              key={m}
              onClick={() => onTermChange(m)}
              // Active term = solid brand red; inactive = muted text on hover surface.
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                termMonths === m
                  ? 'bg-[#e20626] text-white shadow-sm hover:bg-[#b40a23]'
                  : 'text-c-muted hover:bg-c-surface2'
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

        <p className="mb-4 text-sm font-medium text-c-muted">{savingsTrend}</p>

        {/* Legend dots match the recharts series colors: navy current-cost, brand-red B2, green savings. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-c-muted">
          <ChartLegendItem colorClass="bg-[#000033]" label={providerLabel} />
          <ChartLegendItem colorClass="bg-[#e20626]" label="Backblaze B2" />
          <ChartLegendItem colorClass="bg-[#1f8a5b]" label="Cumulative Savings" />
        </div>

        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 14, right: 12, left: 4, bottom: 4 }}>
              <defs>
                {/* Cumulative-savings area: soft green fade matching the design's #1F8A5B gradient. */}
                <linearGradient id="projectionSavings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1f8a5b" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#1f8a5b" stopOpacity={0.03} />
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
              {/* Two independent scales: monthly cost on the left, cumulative savings on the right,
                  so the cost lines and the savings area each fill the plot rather than one dwarfing the other. */}
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
              {/* Cumulative-savings area: green stroke (#1F8A5B) over the soft green gradient fill.
                  Draws on first, then the cost lines stagger in behind it. */}
              <Area
                yAxisId="savings"
                type="monotone"
                dataKey="cumulativeSavings"
                stroke="#1f8a5b"
                fill="url(#projectionSavings)"
                strokeWidth={2.5}
                dot={false}
                name="Cumulative Savings"
                isAnimationActive={drawOn}
                animationBegin={0}
                animationDuration={1100}
                animationEasing="ease-out"
              />
              {/* Current-provider cost line: navy (#000033) per the design spec. */}
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="currentCost"
                stroke="#000033"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0 }}
                name={providerLabel}
                isAnimationActive={drawOn}
                animationBegin={150}
                animationDuration={1100}
                animationEasing="ease-out"
              />
              {/* B2 cost line: brand red (#E20626). */}
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="b2Cost"
                stroke="#e20626"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0 }}
                name="Backblaze B2"
                isAnimationActive={drawOn}
                animationBegin={300}
                animationDuration={1100}
                animationEasing="ease-out"
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
  // Savings values read in green; everything else in primary text color.
  const valueClass = tone === 'savings' ? 'text-c-green' : 'text-c-text';

  return (
    <div className="rounded-lg border border-c-border bg-c-surface2 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-c-subtle">{label}</p>
      {/* Big display values use the heading font. */}
      <p className={`mt-1 font-display text-lg font-semibold ${valueClass}`}>
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

// Pick a readable set of month ticks scaled to the term so longer projections don't crowd the axis.
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

// Display storage in TB on the app's decimal basis (1 TB = 1000 GB, not GiB).
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
    <div className="rounded-lg border border-c-border bg-c-surface p-3 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-c-text">Month {point.month || label}</p>
      <div className="space-y-1.5">
        {/* Row dots mirror the chart series colors: navy current cost, brand-red B2, green savings. */}
        <TooltipRow label="Data Stored" value={formatStorage(point.storageGb)} />
        <TooltipRow label={providerLabel} value={formatCurrency(point.currentCost)} colorClass="bg-[#000033]" />
        <TooltipRow label="Backblaze B2" value={formatCurrency(point.b2Cost)} colorClass="bg-[#e20626]" />
        <TooltipRow label="Monthly Savings" value={formatCurrency(point.monthlySavings)} colorClass="bg-[#1f8a5b]" />
        <TooltipRow label="Cumulative Savings" value={formatCurrency(point.cumulativeSavings)} colorClass="bg-[#1f8a5b]" />
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
      <span className="flex items-center gap-2 text-c-muted">
        {colorClass && <span className={`h-2 w-2 rounded-full ${colorClass}`} />}
        {label}
      </span>
      <span className="font-semibold text-c-text">{value}</span>
    </div>
  );
}
