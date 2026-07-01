import type { B2ServiceTier } from '@/types/analysis';
import { getServiceTierSpec, hasUnlimitedEgress, type ServiceTierSpec } from '@/lib/pricing/service-levels';

export type { ServiceTierSpec };
export { getServiceTierSpec, hasUnlimitedEgress };

const TIER_ORDER: readonly B2ServiceTier[] = ['uncommitted', 'committed', 'overdrive'];

/**
 * Which tier(s) to show in the report's service-level comparison, for the given analysis's
 * selected tier. Default framing: compare the selected tier against the one tier up (Uncommitted
 * -> Committed, Committed -> Overdrive); Overdrive has no tier above it, so it renders alone.
 *
 * Deliberately simple and swappable: a future "customer status" concept (existing uncommitted
 * customer being pitched to commit, vs. a new prospect) may change which two tiers are compared
 * and how the narrative frames it — that should replace this function's body without touching any
 * rendering in the report.
 */
export function getServiceTierComparison(selectedTier: B2ServiceTier): ServiceTierSpec[] {
  const selectedIndex = TIER_ORDER.indexOf(selectedTier);
  const nextTier = TIER_ORDER[selectedIndex + 1];
  return nextTier
    ? [getServiceTierSpec(selectedTier), getServiceTierSpec(nextTier)]
    : [getServiceTierSpec(selectedTier)];
}
