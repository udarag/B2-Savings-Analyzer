import type { Provider } from '@/types/analysis';
import awsPricing from './aws.json';
import gcpPricing from './gcp.json';
import azurePricing from './azure.json';
import r2Pricing from './r2.json';

type RefreshMetadata = {
  status?: 'success' | 'skipped' | 'error';
  lastAttempt?: string;
  lastSuccess?: string;
  credentialEnvVar?: string;
  message?: string;
};

type PricingMetadata = {
  lastVerified?: string;
  source?: string;
  refresh?: RefreshMetadata;
};

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

export function getPricingFreshnessWarning(provider: Provider): PricingFreshnessWarning | null {
  const pricing = PROVIDER_PRICING[provider];
  const refresh = pricing.refresh;

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
