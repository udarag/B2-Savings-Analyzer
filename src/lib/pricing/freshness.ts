// Surfaces an INTERNAL-ONLY warning when a provider's pricing JSON was last refreshed by a
// failed or skipped run, so the dashboard can flag that quoted savings may rest on stale rates.
// The credentialEnvVar/lastAttempt fields here name internals and must stay off customer reports.
import type { Provider } from '@/types/analysis';
import awsPricing from './aws.json';
import gcpPricing from './gcp.json';
import azurePricing from './azure.json';
import r2Pricing from './r2.json';

// Outcome of the most recent pricing-refresh job, embedded in each provider's pricing JSON.
type RefreshMetadata = {
  status?: 'success' | 'skipped' | 'error';
  lastAttempt?: string;
  lastSuccess?: string;
  // Env var holding the refresh credential — named so an operator can fix a failed run.
  credentialEnvVar?: string;
  message?: string;
};

type PricingMetadata = {
  lastVerified?: string;
  source?: string;
  refresh?: RefreshMetadata;
};

/** Internal warning shown when a provider's pricing data may be stale. Not for customer output. */
export type PricingFreshnessWarning = {
  provider: Provider;
  title: string;
  message: string;
  lastVerified?: string;
  lastAttempt?: string;
  credentialEnvVar?: string;
};

const PROVIDER_PRICING: Record<Provider, PricingMetadata> = {
  aws: awsPricing as PricingMetadata,
  gcp: gcpPricing as PricingMetadata,
  azure: azurePricing as PricingMetadata,
  r2: r2Pricing as PricingMetadata,
};

const PROVIDER_LABELS: Record<Provider, string> = {
  aws: 'AWS',
  gcp: 'GCP',
  azure: 'Azure',
  r2: 'Cloudflare R2',
};

/**
 * Returns an internal staleness warning for a provider, or null when its pricing is fresh.
 * Null also when there's no refresh metadata at all (treated as fine — nothing to warn about).
 */
export function getPricingFreshnessWarning(provider: Provider): PricingFreshnessWarning | null {
  const pricing = PROVIDER_PRICING[provider];
  const refresh = pricing.refresh;

  // No metadata or a clean success means nothing to flag; only 'skipped'/'error' warrant a warning.
  if (!refresh || refresh.status === 'success') return null;

  const providerLabel = PROVIDER_LABELS[provider];
  const credentialCopy = refresh.credentialEnvVar
    ? ` Check ${refresh.credentialEnvVar} before rerunning the pricing refresh.`
    : '';

  return {
    provider,
    title: `${providerLabel} Pricing Refresh Did Not Complete`,
    message: `${refresh.message || `${providerLabel} pricing may be stale or inaccurate.`}${credentialCopy}`,
    lastVerified: pricing.lastVerified,
    lastAttempt: refresh.lastAttempt,
    credentialEnvVar: refresh.credentialEnvVar,
  };
}
