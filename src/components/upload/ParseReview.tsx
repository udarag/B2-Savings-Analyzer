'use client';

import type { ParsedBill, Category, BillType, Provider } from '@/types/analysis';
import type { ReadinessCheckTone, ReadinessStatus } from '@/lib/analysis/readiness';
import { assessReadiness } from '@/lib/analysis/readiness';
import { formatCurrency } from '../shared/FormatCurrency';

interface ParseReviewProps {
  parsed: ParsedBill;
  billType?: BillType;
  provider?: Provider;
  pricingDiscountConfirmed?: boolean;
  onPricingDiscountConfirmedChange?: (confirmed: boolean) => void;
}

const CATEGORY_ORDER: Category[] = ['storage', 'egress', 'operations', 'retrieval', 'storage-adjacent', 'out-of-scope'];
const CATEGORY_LABELS: Record<Category, string> = {
  'storage': 'Storage',
  'egress': 'Egress / Data Transfer',
  'operations': 'API Operations',
  'retrieval': 'Retrieval / Early Deletion',
  'storage-adjacent': 'Storage-adjacent (EBS, EFS, ECR, CloudFront)',
  'out-of-scope': 'Out of Scope',
};
const CATEGORY_COLORS: Record<Category, string> = {
  'storage': 'bg-red-100 text-red-800',
  'egress': 'bg-purple-100 text-purple-800',
  'operations': 'bg-green-100 text-green-800',
  'retrieval': 'bg-orange-100 text-orange-800',
  'storage-adjacent': 'bg-gray-100 text-gray-700',
  'out-of-scope': 'bg-gray-50 text-gray-500',
};

const READINESS_STYLES: Record<ReadinessStatus, {
  dot: string;
  badge: string;
  panel: string;
  text: string;
}> = {
  ready: {
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-800 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-400/40',
    panel: 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-400/30',
    text: 'text-green-900 dark:text-green-300',
  },
  directional: {
    dot: 'bg-yellow-500',
    badge: 'bg-yellow-100 text-yellow-800 ring-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:ring-yellow-400/40',
    panel: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-400/30',
    text: 'text-yellow-900 dark:text-yellow-300',
  },
  'needs-detail': {
    dot: 'bg-orange-500',
    badge: 'bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-400/40',
    panel: 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-400/30',
    text: 'text-orange-900 dark:text-orange-300',
  },
  'not-useful': {
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-400/40',
    panel: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-400/30',
    text: 'text-red-900 dark:text-red-300',
  },
};

const CHECK_STYLES: Record<ReadinessCheckTone, {
  dot: string;
  value: string;
}> = {
  good: {
    dot: 'bg-green-500',
    value: 'text-green-800 dark:text-green-300',
  },
  warning: {
    dot: 'bg-yellow-500',
    value: 'text-yellow-800 dark:text-yellow-300',
  },
  missing: {
    dot: 'bg-red-500',
    value: 'text-red-800 dark:text-red-300',
  },
  neutral: {
    dot: 'bg-gray-400',
    value: 'text-gray-800 dark:text-gray-200',
  },
};

const GCP_COST_MIX: Array<{
  category: Category;
  label: string;
  detail: string;
}> = [
  { category: 'storage', label: 'Storage capacity', detail: 'At-rest object storage' },
  { category: 'egress', label: 'Transfer / egress', detail: 'Replication, network transfer, and downloads' },
  { category: 'operations', label: 'Operations', detail: 'Class A and Class B API requests' },
  { category: 'retrieval', label: 'Retrieval', detail: 'Nearline, Coldline, and Archive retrieval fees' },
];

function isGcpListPriceSignal(message: string): boolean {
  return /savings programs|list price/i.test(message);
}

export function ParseReview({
  parsed,
  billType,
  provider,
  pricingDiscountConfirmed = false,
  onPricingDiscountConfirmedChange,
}: ParseReviewProps) {
  const categorySums = new Map<Category, { count: number; total: number }>();

  for (const item of parsed.lineItems) {
    const existing = categorySums.get(item.category) || { count: 0, total: 0 };
    existing.count++;
    existing.total += item.costUsd;
    categorySums.set(item.category, existing);
  }

  const addressable = (categorySums.get('storage')?.total || 0) +
    (categorySums.get('egress')?.total || 0) +
    (categorySums.get('operations')?.total || 0) +
    (categorySums.get('retrieval')?.total || 0);
  const readiness = assessReadiness(parsed, billType, provider, { pricingDiscountConfirmed });
  const readinessStyle = READINESS_STYLES[readiness.status];
  const isGcp = provider === 'gcp';
  const parserWarnings = isGcp
    ? parsed.warnings.filter((warning) => !isGcpListPriceSignal(warning))
    : parsed.warnings;
  const commercialSignals = [
    ...(parsed.commercialSignals || []),
    ...(isGcp ? parsed.warnings.filter(isGcpListPriceSignal) : []),
  ].filter((signal, index, signals) => signals.indexOf(signal) === index);
  const addressableLabel = isGcp ? 'Addressable Cloud Storage spend' : 'Addressable storage spend';
  const categoryLabels = isGcp
    ? {
      ...CATEGORY_LABELS,
      storage: 'Storage Capacity',
      egress: 'Transfer / Egress',
      operations: 'Operations',
      retrieval: 'Retrieval',
    }
    : CATEGORY_LABELS;
  const gcpCostMix = GCP_COST_MIX
    .map((item) => ({
      ...item,
      count: categorySums.get(item.category)?.count || 0,
      total: categorySums.get(item.category)?.total || 0,
    }))
    .filter((item) => item.count > 0 || item.total > 0);

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Parse Review</h3>
            <p className="text-sm text-gray-500 mt-1">
              {parsed.lineItems.length} line items parsed. Grand total: {formatCurrency(parsed.grandTotal)}.
              {addressableLabel}: {formatCurrency(addressable)}.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${readinessStyle.badge}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${readinessStyle.dot}`} />
              {readiness.label}
            </span>
            <span className="text-xs text-gray-500">{readiness.score}/100 readiness</span>
          </div>
        </div>
        {parserWarnings.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 rounded-lg">
            {parserWarnings.map((w, i) => (
              <p key={i} className="text-sm text-amber-800">{w}</p>
            ))}
          </div>
        )}
        {commercialSignals.length > 0 && (
          <div className="mt-3 p-3 bg-sky-50 rounded-lg dark:bg-sky-950/20">
            {commercialSignals.map((signal, i) => (
              <p key={i} className="text-sm text-sky-900 dark:text-sky-200">{signal}</p>
            ))}
          </div>
        )}
      </div>
      <div className="p-6">
        <div className={`mb-5 rounded-lg border p-4 ${readinessStyle.panel}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${readinessStyle.text}`}>Bill Savings Report Readiness</p>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-gray-700 dark:text-gray-300">{readiness.summary}</p>
            </div>
            <div className="rounded-md bg-white/70 px-3 py-2 ring-1 ring-black/5 dark:bg-[#11141a] dark:ring-white/10">
              <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Readiness Score</p>
              <p className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">{readiness.score}/100</p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Readiness Checks</p>
            <div className="mt-2 overflow-hidden rounded-md bg-white/70 ring-1 ring-black/5 divide-y divide-gray-200 dark:bg-[#11141a] dark:ring-white/10 dark:divide-gray-800">
              {readiness.checks.map((check) => (
                <ReadinessCheckRow
                  key={check.label}
                  label={check.label}
                  value={check.value}
                  detail={check.detail}
                  tone={check.tone}
                  action={check.action}
                  actionLabel={check.actionLabel}
                  actionChecked={pricingDiscountConfirmed}
                  onActionChange={onPricingDiscountConfirmedChange}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <ReadinessList title="Reliable Signals" items={readiness.trustedSignals} empty="No strong reliability signals yet." />
            <ReadinessList title="Gaps to Understand" items={readiness.attentionItems} empty="No major bill-detail gaps detected." />
            <ReadinessList title="AE Next Steps" items={readiness.nextSteps} empty="Confirm assumptions before sharing externally." />
          </div>

          <div className="mt-3 border-t border-black/10 pt-3 text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">
            Parser confidence: {Math.round(parsed.parseConfidence * 100)}%. Readiness scores whether the bill has enough commercial detail to sell B2 against it.
          </div>
        </div>

        {isGcp && gcpCostMix.length > 0 && (
          <div className="mb-4 border-y border-gray-200 py-3 dark:border-gray-800">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">GCS Cost Mix</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {gcpCostMix.map((item) => (
                <div key={item.category} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{item.label}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {addressable > 0 ? `${Math.round((item.total / addressable) * 100)}%` : '0%'}
                    </p>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(item.total)}</p>
                  <p className="mt-0.5 text-xs leading-4 text-gray-500 dark:text-gray-400">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {CATEGORY_ORDER.map((cat) => {
            const data = categorySums.get(cat);
            if (!data) return null;
            return (
              <div key={cat} className="flex items-center justify-between gap-2 p-3 rounded-lg bg-gray-50">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${CATEGORY_COLORS[cat]}`}>
                    {categoryLabels[cat]}
                  </span>
                  <span className="text-sm text-gray-500 shrink-0">{data.count} Items</span>
                </div>
                <span className="text-sm font-semibold text-gray-900 shrink-0">{formatCurrency(data.total)}</span>
              </div>
            );
          })}
        </div>

        {parsed.discounts && parsed.discounts.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Named Discounts</h4>
            {parsed.discounts.map((d, i) => (
              <div key={i} className="flex justify-between text-sm py-1">
                <span className="text-gray-600">{d.name}</span>
                <span className="text-green-700 font-medium">-{formatCurrency(d.amountUsd)}</span>
              </div>
            ))}
          </div>
        )}

        {parsed.accounts && parsed.accounts.length > 0 && !parsed.accountServiceBreakdowns && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Linked Accounts ({parsed.accounts.length})
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {parsed.accounts.slice(0, 10).map((acct) => (
                <div key={acct.accountId} className="flex justify-between py-1">
                  <span className="text-gray-600 truncate mr-2">{acct.accountName}</span>
                  <span className="text-gray-900 font-medium shrink-0">{formatCurrency(acct.amountUsd)}</span>
                </div>
              ))}
              {parsed.accounts.length > 10 && (
                <p className="text-xs text-gray-400 col-span-2">
                  +{parsed.accounts.length - 10} More Accounts
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadinessCheckRow({
  label,
  value,
  detail,
  tone,
  action,
  actionLabel,
  actionChecked = false,
  onActionChange,
}: {
  label: string;
  value: string;
  detail: string;
  tone: ReadinessCheckTone;
  action?: 'confirm-discount';
  actionLabel?: string;
  actionChecked?: boolean;
  onActionChange?: (checked: boolean) => void;
}) {
  const style = CHECK_STYLES[tone];
  const actionBoxClass = tone === 'good'
    ? 'border-green-200 bg-green-50 text-green-900 dark:border-green-400/30 dark:bg-green-950/30 dark:text-green-200'
    : tone === 'missing'
    ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-200'
    : 'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-400/30 dark:bg-yellow-950/30 dark:text-yellow-200';

  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</p>
      </div>
      <div>
        <p className={`text-sm font-semibold ${style.value}`}>{value}</p>
        <p className="mt-0.5 text-xs leading-5 text-gray-600 dark:text-gray-400">{detail}</p>
        {action === 'confirm-discount' && onActionChange && (
          <label className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${actionBoxClass}`}>
            <input
              type="checkbox"
              checked={actionChecked}
              onChange={(event) => onActionChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 text-bb-red accent-bb-red rounded"
            />
            <span>{actionLabel}</span>
          </label>
        )}
      </div>
    </div>
  );
}

function ReadinessList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  const visibleItems = items.length > 0 ? items : [empty];

  return (
    <div className="rounded-md bg-white/70 p-3 ring-1 ring-black/5 dark:bg-[#11141a] dark:ring-white/10">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {visibleItems.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2 text-xs leading-5 text-gray-600 dark:text-gray-300">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400 dark:bg-gray-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
