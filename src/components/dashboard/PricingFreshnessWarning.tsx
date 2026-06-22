import type { PricingFreshnessWarning as PricingFreshnessWarningData } from '@/lib/pricing/freshness';

interface PricingFreshnessWarningProps {
  warning: PricingFreshnessWarningData | null;
  className?: string;
}

export function PricingFreshnessWarning({ warning, className = '' }: PricingFreshnessWarningProps) {
  if (!warning) return null;

  return (
    <div className={`flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ${className}`}>
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008ZM10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
      </svg>
      <div>
        <p className="text-sm font-semibold text-amber-900">{warning.title}</p>
        <p className="mt-0.5 text-sm text-amber-800">{warning.message}</p>
        <p className="mt-1 text-xs text-amber-700">
          Last Verified: {warning.lastVerified || 'Unknown'}
          {warning.lastAttempt ? ` · Last Refresh Attempt: ${warning.lastAttempt}` : ''}
        </p>
      </div>
    </div>
  );
}
