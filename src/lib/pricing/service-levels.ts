// Single source of truth for B2 service-tier specs (throughput/RPS ceilings, egress/fee treatment).
// Both the cost model (which needs to know whether egress is unlimited) and the report/dashboard
// (which need to display the spec) read through this file so the two can't drift apart.
import b2Pricing from './b2.json';
import type { B2ServiceTier } from '@/types/analysis';

export interface ServiceTierSpec {
  tier: B2ServiceTier;
  label: string;
  customerLabel: string;
  throughputGbitPut: number;
  throughputGbitGet: number;
  throughputGbitMax?: number;
  /** null means RPS scales with throughput rather than a fixed ceiling (Overdrive). */
  rpsPut: number | null;
  rpsGet: number | null;
  unlimitedEgress: boolean;
  zeroTransactionFees: boolean;
  /** Overdrive only: a suggested starting rate, not a canonical/fixed price — pricing is usually custom-negotiated. */
  startingPerTbMonth?: number;
  minimumCommitmentNote?: string;
  note: string;
}

// The raw JSON shape per tier (everything but `tier` itself, which isn't stored — it's the key).
// Cast through `unknown` because each tier's literal JSON shape has different optional fields
// (only Overdrive has startingPerTbMonth/minimumCommitmentNote), so TS can't infer a single
// homogeneous Record type directly.
const SERVICE_LEVELS = b2Pricing.serviceLevels as unknown as Record<B2ServiceTier, Omit<ServiceTierSpec, 'tier'>>;

export function getServiceTierSpec(tier: B2ServiceTier): ServiceTierSpec {
  return { tier, ...SERVICE_LEVELS[tier] };
}

/** True when the tier has unlimited free egress (Overdrive) — the one flag the cost model and the
 *  report both need, so it's kept here rather than re-derived independently in either place. */
export function hasUnlimitedEgress(tier: B2ServiceTier): boolean {
  return SERVICE_LEVELS[tier].unlimitedEgress;
}

/**
 * Human-readable throughput label for a Gbit/s figure. Rolls over to Tbps at/above 1000 Gbit/s so
 * Overdrive's ceiling reads "1 Tbps" instead of "1000 Gbit/s". Kept next to the specs so every
 * surface (deal builder, customer report) formats throughput the same way.
 */
export function formatThroughput(gbitPerSec: number): string {
  return gbitPerSec >= 1000
    ? `${(gbitPerSec / 1000).toLocaleString()} Tbps`
    : `${gbitPerSec.toLocaleString()} Gbit/s`;
}
