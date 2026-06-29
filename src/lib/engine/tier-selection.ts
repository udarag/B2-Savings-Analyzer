import type { ModelConfig, Provider, TierInventoryRow } from '@/types/analysis';
import { TIER_SELECTION_VERSION } from '@/types/analysis';

// Which tiers default to "migrate", and how saved AE selections are reconciled with a freshly
// parsed bill across model-config versions.

// Hot (instant-access, no retrieval fee) classes across AWS/Azure/GCP. Only these default to
// migrate: B2 standard is an always-hot tier, so cold/archive classes (Glacier, Archive, ...)
// aren't an apples-to-apples swap and are left off by default for the AE to opt in deliberately.
const HOT_STORAGE_CLASSES = new Set([
  'Standard',
  'S3 (Summary)',
  'Intelligent-Tiering-FA',
  'Hot-LRS',
  'Hot-ZRS',
  'Hot-GRS',
  'Hot-RA-GRS',
]);

/** Stable per-tier key (provider|class|region) used to match saved toggles to inventory rows. */
export function makeTierInventoryId(
  provider: Provider,
  storageClass: string,
  region: string,
): string {
  return `${provider}|${storageClass}|${region}`;
}

/** Whether a storage class is an instant-access (hot) tier comparable to B2 standard. */
export function isHotStorageTier(storageClass: string): boolean {
  // The Hot- prefix check also catches Azure redundancy SKU variants beyond the explicit set.
  return HOT_STORAGE_CLASSES.has(storageClass) || storageClass.startsWith('Hot-');
}

/** Default migrate-on only for hot tiers that actually cost more than B2 — no false savings claim. */
export function getDefaultTierMigration(
  storageClass: string,
  effectivePerTb: number,
  b2PricePerTb: number,
): boolean {
  return isHotStorageTier(storageClass) && effectivePerTb > b2PricePerTb;
}

/**
 * Re-apply a saved model config's per-tier migrate toggles onto freshly built inventory rows.
 * Honors saved choices only when the config version is current; otherwise falls back to defaults
 * so stale selections from an older selection model don't silently distort the comparison.
 */
export function applyTierSelectionConfig(
  tiers: TierInventoryRow[],
  modelConfig: ModelConfig | null | undefined,
): TierInventoryRow[] {
  if (!modelConfig) return tiers;

  const toggles = modelConfig.tierToggles || {};
  // Configs saved before TIER_SELECTION_VERSION (legacy, untagged) default to v1. Below this gate
  // we don't fully trust their toggles because the default-selection rules have since changed.
  const isCurrentSelectionModel = (modelConfig.tierSelectionVersion || 1) >= TIER_SELECTION_VERSION;

  return tiers.map((tier) => {
    const savedToggle = toggles[tier.id];

    // Current-version config: trust the AE's saved choice for every tier verbatim.
    if (isCurrentSelectionModel && typeof savedToggle === 'boolean') {
      return { ...tier, migrateToB2: savedToggle };
    }

    // Legacy config: only honor saved toggles on hot tiers — those were the only ones the old UI
    // exposed. Cold tiers fall through to current defaults rather than inheriting a stale value.
    if (!isCurrentSelectionModel && typeof savedToggle === 'boolean' && isHotStorageTier(tier.storageClass)) {
      return { ...tier, migrateToB2: savedToggle };
    }

    // No saved toggle (or not trusted): recompute the default from current pricing/rules.
    return {
      ...tier,
      migrateToB2: getDefaultTierMigration(
        tier.storageClass,
        tier.effectivePerTb,
        modelConfig.b2PricePerTb,
      ),
    };
  });
}
