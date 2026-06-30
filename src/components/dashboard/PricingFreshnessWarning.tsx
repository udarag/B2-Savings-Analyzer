import type { PricingFreshnessWarning as PricingFreshnessWarningData } from '@/lib/pricing/freshness';

interface PricingFreshnessWarningProps {
  /** Null when the cached B2/provider pricing is current; renders nothing in that case. */
  warning: PricingFreshnessWarningData | null;
  className?: string;
}

/**
 * Internal banner shown when the pricing data backing the model may be stale. Surfaces the last
 * verified/refresh dates so an AE knows whether to trust the numbers; never shown to customers.
 */
export function PricingFreshnessWarning({ warning, className = '' }: PricingFreshnessWarningProps) {
  if (!warning) return null;

  return (
    <div className={`flex items-start gap-3 rounded-xl border border-c-amber/30 bg-c-amber-soft px-4 py-3 ${className}`}>
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-c-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008ZM10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
      </svg>
      <div>
        <p className="text-sm font-semibold text-c-amber">{warning.title}</p>
        <p className="mt-0.5 text-sm text-c-muted">{warning.message}</p>
        <p className="mt-1 text-xs text-c-subtle">
          Last verified: {warning.lastVerified || 'Unknown'}
          {warning.lastAttempt ? ` · Last refresh attempt: ${warning.lastAttempt}` : ''}
        </p>
      </div>
    </div>
  );
}
