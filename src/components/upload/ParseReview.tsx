'use client';

import { useState } from 'react';
import type { ParsedBill, Category, BillType, Provider } from '@/types/analysis';
import type { ReadinessCheckTone, ReadinessStatus } from '@/lib/analysis/readiness';
import { assessReadiness } from '@/lib/analysis/readiness';
import { formatCurrency } from '../shared/FormatCurrency';
import { Collapse } from '../shared/Collapse';

// Persists the AE's open/closed preference for this card across sessions.
const EXPANDED_STORAGE_KEY = 'b2-savings-parse-review-expanded';

interface ParseReviewProps {
  parsed: ParsedBill;
  billType?: BillType;
  provider?: Provider;
  /** Whether the AE has confirmed the bill already reflects negotiated (not list) pricing; feeds the readiness assessment. */
  pricingDiscountConfirmed?: boolean;
  onPricingDiscountConfirmedChange?: (confirmed: boolean) => void;
}

// Display order for the category summary: addressable storage-scope categories
// first, then storage-adjacent and out-of-scope (which don't drive savings).
const CATEGORY_ORDER: Category[] = ['storage', 'egress', 'operations', 'retrieval', 'storage-adjacent', 'out-of-scope'];
const CATEGORY_LABELS: Record<Category, string> = {
  'storage': 'Storage',
  'egress': 'Egress / Data Transfer',
  'operations': 'API Operations',
  'retrieval': 'Retrieval / Early Deletion',
  'storage-adjacent': 'Storage-adjacent (EBS, EFS, ECR, CloudFront)',
  'out-of-scope': 'Out of Scope',
};
// Category pill colors, mapped onto the design-system soft tokens. Storage is the
// addressable hero bucket (red); the others use the supporting accent tokens.
const CATEGORY_COLORS: Record<Category, string> = {
  'storage': 'bg-c-red-soft text-c-red',
  'egress': 'bg-c-purple-soft text-c-purple',
  'operations': 'bg-c-green-soft text-c-green',
  'retrieval': 'bg-c-amber-soft text-c-amber',
  'storage-adjacent': 'bg-c-surface2 text-c-muted',
  'out-of-scope': 'bg-c-surface2 text-c-subtle',
};

// Readiness status colors, mapped onto the design-system soft/accent tokens so
// they auto-switch with light/dark. The status meaning stays intact: green =
// ready, amber = directional/needs-detail, red = not-useful.
const READINESS_STYLES: Record<ReadinessStatus, {
  dot: string;
  badge: string;
  panel: string;
  text: string;
}> = {
  ready: {
    dot: 'bg-c-green',
    badge: 'bg-c-green-soft text-c-green ring-c-border',
    panel: 'bg-c-green-soft border-c-border',
    text: 'text-c-green',
  },
  directional: {
    dot: 'bg-c-amber',
    badge: 'bg-c-amber-soft text-c-amber ring-c-border',
    panel: 'bg-c-amber-soft border-c-border',
    text: 'text-c-amber',
  },
  'needs-detail': {
    dot: 'bg-c-amber',
    badge: 'bg-c-amber-soft text-c-amber ring-c-border',
    panel: 'bg-c-amber-soft border-c-border',
    text: 'text-c-amber',
  },
  'not-useful': {
    dot: 'bg-c-red',
    badge: 'bg-c-red-soft text-c-red ring-c-border',
    panel: 'bg-c-red-soft border-c-border',
    text: 'text-c-red',
  },
};

// Per-check tone colors for the readiness checklist rows, mapped onto the
// design-system accent tokens (good = green, warning = amber, missing = red).
const CHECK_STYLES: Record<ReadinessCheckTone, {
  dot: string;
  value: string;
}> = {
  good: {
    dot: 'bg-c-green',
    value: 'text-c-green',
  },
  warning: {
    dot: 'bg-c-amber',
    value: 'text-c-amber',
  },
  missing: {
    dot: 'bg-c-red',
    value: 'text-c-red',
  },
  neutral: {
    dot: 'bg-c-border2',
    value: 'text-c-text',
  },
};

// GCS-specific relabeling of the addressable categories for the "GCS Cost Mix"
// panel, with plain-language detail on what each bucket covers for GCP bills.
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

// A GCP parser warning that's really a commercial observation (the export shows
// list price / savings-program detail) rather than a parse defect. We reclassify
// these out of the "warnings" bucket so they read as pricing context, not errors.
function isGcpListPriceSignal(message: string): boolean {
  return /savings programs|list price/i.test(message);
}

/**
 * Collapsible internal QA card shown after a bill is parsed: per-category spend
 * breakdown, addressable storage-scope total, parser warnings, and a readiness
 * assessment that scores whether the bill has enough commercial detail to sell
 * B2 against. Internal-only — these warnings never appear on the customer report.
 */
export function ParseReview({
  parsed,
  billType,
  provider,
  pricingDiscountConfirmed = false,
  onPricingDiscountConfirmedChange,
}: ParseReviewProps) {
  // Restore the saved open/closed preference (collapsed by default). This card
  // renders only client-side, after the dashboard fetch resolves, so reading
  // localStorage during init is safe and avoids a hydration mismatch.
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleExpanded = () => {
    setExpanded((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(EXPANDED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore blocked storage; the toggle still works for this session.
      }
      return next;
    });
  };

  const categorySums = new Map<Category, { count: number; total: number }>();

  for (const item of parsed.lineItems) {
    const existing = categorySums.get(item.category) || { count: 0, total: 0 };
    existing.count++;
    existing.total += item.costUsd;
    categorySums.set(item.category, existing);
  }

  // Addressable storage-scope spend = the four categories migration can affect.
  // Deliberately excludes storage-adjacent (EBS/EFS/ECR/CloudFront) and
  // out-of-scope lines, which B2 doesn't replace.
  const addressable = (categorySums.get('storage')?.total || 0) +
    (categorySums.get('egress')?.total || 0) +
    (categorySums.get('operations')?.total || 0) +
    (categorySums.get('retrieval')?.total || 0);
  const readiness = assessReadiness(parsed, billType, provider, { pricingDiscountConfirmed });
  const readinessStyle = READINESS_STYLES[readiness.status];
  const isGcp = provider === 'gcp';
  // For GCP, peel list-price/savings-program warnings out of the warning list and
  // surface them as commercial signals instead (deduped); other providers keep
  // their warnings as-is.
  const parserWarnings = isGcp
    ? parsed.warnings.filter((warning) => !isGcpListPriceSignal(warning))
    : parsed.warnings;
  const commercialSignals = [
    ...(parsed.commercialSignals || []),
    ...(isGcp ? parsed.warnings.filter(isGcpListPriceSignal) : []),
  ].filter((signal, index, signals) => signals.indexOf(signal) === index);
  const addressableLabel = isGcp ? 'Addressable Cloud Storage spend' : 'Addressable storage spend';
  // Use GCP/GCS-native terminology for GCP bills so the breakdown matches what
  // the AE sees in the customer's own console.
  const categoryLabels = isGcp
    ? {
      ...CATEGORY_LABELS,
      storage: 'Storage Capacity',
      egress: 'Transfer / Egress',
      operations: 'Operations',
      retrieval: 'Retrieval',
    }
    : CATEGORY_LABELS;
  // Drop categories with no parsed activity so the cost-mix panel only shows
  // buckets actually present in this bill.
  const gcpCostMix = GCP_COST_MIX
    .map((item) => ({
      ...item,
      count: categorySums.get(item.category)?.count || 0,
      total: categorySums.get(item.category)?.total || 0,
    }))
    .filter((item) => item.count > 0 || item.total > 0);

  const noteCount = parserWarnings.length + commercialSignals.length;

  return (
    <div className="rounded-2xl border border-c-border bg-c-surface shadow-sm">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-4 px-6 py-4 text-left"
      >
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-c-text">Parse Review</h3>
          <p className="text-sm text-c-muted mt-1">
            {parsed.lineItems.length} line items parsed. Grand total: {formatCurrency(parsed.grandTotal)}.{' '}
            {addressableLabel}: {formatCurrency(addressable)}.
          </p>
          {!expanded && noteCount > 0 && (
            <p className="mt-1 text-xs font-medium text-c-amber">
              {noteCount} {noteCount === 1 ? 'note' : 'notes'} to review — expand for details
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex flex-col items-end gap-1">
            {/* Readiness pill mirrors the design's green confidence toggle: soft accent
                fill keyed to the readiness status, with a status dot. */}
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${readinessStyle.badge}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${readinessStyle.dot}`} />
              {readiness.label}
            </span>
            <span className="text-xs text-c-muted">{readiness.score}/100 readiness</span>
          </div>
          <svg
            className={`h-5 w-5 shrink-0 text-c-subtle transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      <Collapse open={expanded}>
        <div className="border-t border-c-border">
          {(parserWarnings.length > 0 || commercialSignals.length > 0) && (
            <div className="px-6 pt-4">
              {/* Parser warnings get the design's amber warning band. */}
              {parserWarnings.length > 0 && (
                <div className="p-3 bg-c-amber-soft rounded-lg">
                  {parserWarnings.map((w, i) => (
                    <p key={i} className="text-sm text-c-amber">{w}</p>
                  ))}
                </div>
              )}
              {/* Commercial signals (e.g. GCP list-price detail) read as context, not
                  errors, so they use the calmer purple-soft accent band. */}
              {commercialSignals.length > 0 && (
                <div className="mt-3 p-3 bg-c-purple-soft rounded-lg">
                  {commercialSignals.map((signal, i) => (
                    <p key={i} className="text-sm text-c-purple">{signal}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="p-6">
            {/* Readiness panel: the design's "How we scored this bill" confidence
                breakdown, recolored to the soft accent band keyed to status. */}
            <div className={`mb-5 rounded-lg border p-4 ${readinessStyle.panel}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${readinessStyle.text}`}>Bill Savings Report Readiness</p>
                  <p className="mt-1 max-w-4xl text-sm leading-6 text-c-muted">{readiness.summary}</p>
                </div>
                {/* Score chip sits on the elevated surface so it reads against the soft band. */}
                <div className="rounded-md bg-c-surface px-3 py-2 ring-1 ring-c-border">
                  <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-c-subtle">Readiness Score</p>
                  <p className="mt-0.5 text-lg font-display font-semibold text-c-text">{readiness.score}/100</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-c-text">Readiness Checks</p>
                <div className="mt-2 overflow-hidden rounded-md bg-c-surface ring-1 ring-c-border divide-y divide-c-border">
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

              <div className="mt-3 border-t border-c-border pt-3 text-xs text-c-subtle">
                Parser confidence: {Math.round(parsed.parseConfidence * 100)}%. Readiness scores whether the bill has enough commercial detail to sell B2 against it.
              </div>
            </div>

            {isGcp && gcpCostMix.length > 0 && (
              <div className="mb-4 border-y border-c-border py-3">
                <p className="text-sm font-semibold text-c-text">GCS Cost Mix</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {gcpCostMix.map((item) => (
                    <div key={item.category} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-semibold text-c-text">{item.label}</p>
                        <p className="text-[11px] text-c-subtle">
                          {addressable > 0 ? `${Math.round((item.total / addressable) * 100)}%` : '0%'}
                        </p>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-c-text">{formatCurrency(item.total)}</p>
                      <p className="mt-0.5 text-xs leading-4 text-c-muted">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Categorized spend: each category is a striped panel (bg-c-surface2)
                with its soft-token pill, item count, and total. */}
            <div className="space-y-3">
              {CATEGORY_ORDER.map((cat) => {
                const data = categorySums.get(cat);
                if (!data) return null;
                return (
                  <div key={cat} className="flex items-center justify-between gap-2 p-3 rounded-lg bg-c-surface2">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${CATEGORY_COLORS[cat]}`}>
                        {categoryLabels[cat]}
                      </span>
                      <span className="text-sm text-c-muted shrink-0">{data.count} Items</span>
                    </div>
                    <span className="text-sm font-semibold text-c-text shrink-0">{formatCurrency(data.total)}</span>
                  </div>
                );
              })}
            </div>

            {parsed.discounts && parsed.discounts.length > 0 && (
              <div className="mt-4 pt-4 border-t border-c-border">
                <h4 className="text-sm font-medium text-c-text mb-2">Named Discounts</h4>
                {parsed.discounts.map((d, i) => (
                  <div key={i} className="flex justify-between text-sm py-1">
                    <span className="text-c-muted">{d.name}</span>
                    <span className="text-c-green font-medium">-{formatCurrency(d.amountUsd)}</span>
                  </div>
                ))}
              </div>
            )}

            {parsed.accounts && parsed.accounts.length > 0 && !parsed.accountServiceBreakdowns && (
              <div className="mt-4 pt-4 border-t border-c-border">
                <h4 className="text-sm font-medium text-c-text mb-2">
                  Linked Accounts ({parsed.accounts.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {parsed.accounts.slice(0, 10).map((acct) => (
                    <div key={acct.accountId} className="flex justify-between py-1">
                      <span className="text-c-muted truncate mr-2">{acct.accountName}</span>
                      <span className="text-c-text font-medium shrink-0">{formatCurrency(acct.amountUsd)}</span>
                    </div>
                  ))}
                  {parsed.accounts.length > 10 && (
                    <p className="text-xs text-c-subtle col-span-2">
                      +{parsed.accounts.length - 10} More Accounts
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Collapse>
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
  // The inline action box inherits the row's tone via the soft accent tokens.
  const actionBoxClass = tone === 'good'
    ? 'border-c-border bg-c-green-soft text-c-green'
    : tone === 'missing'
    ? 'border-c-border bg-c-red-soft text-c-red'
    : 'border-c-border bg-c-amber-soft text-c-amber';

  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
        <p className="text-sm font-semibold text-c-text">{label}</p>
      </div>
      <div>
        <p className={`text-sm font-semibold ${style.value}`}>{value}</p>
        <p className="mt-0.5 text-xs leading-5 text-c-muted">{detail}</p>
        {/* Only the discount-confirmation check renders an inline action, and only when the parent wired up a handler. */}
        {action === 'confirm-discount' && onActionChange && (
          <label className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${actionBoxClass}`}>
            <input
              type="checkbox"
              checked={actionChecked}
              onChange={(event) => onActionChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-c-brand rounded"
            />
            <span>{actionLabel}</span>
          </label>
        )}
      </div>
    </div>
  );
}

function ReadinessList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  // Show the empty-state line as a normal bullet when there are no items, so the
  // three columns stay visually balanced.
  const visibleItems = items.length > 0 ? items : [empty];

  return (
    <div className="rounded-md bg-c-surface p-3 ring-1 ring-c-border">
      <p className="text-xs font-semibold text-c-text">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {visibleItems.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2 text-xs leading-5 text-c-muted">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-c-border2" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
