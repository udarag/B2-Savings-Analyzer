import type { ModelConfig, Provider, TierInventoryRow } from '@/types/analysis';
import { TIER_SELECTION_VERSION } from '@/types/analysis';

const HOT_STORAGE_CLASSES = new Set([
  'Standard',
  'S3 (Summary)',
  'Intelligent-Tiering-FA',
  'Hot-LRS',
  'Hot-ZRS',
  'Hot-GRS',
  'Hot-RA-GRS',
]);

export function makeTierInventoryId(
  provider: Provider,
  storageClass: string,
  region: string,
): string {
  return `${provider}|${storageClass}|${region}`;
}

export function isHotStorageTier(storageClass: string): boolean {
  return HOT_STORAGE_CLASSES.has(storageClass) || storageClass.startsWith('Hot-');
}

export function getDefaultTierMigration(
  storageClass: string,
  effectivePerTb: number,
  b2PricePerTb: number,
): boolean {
  return isHotStorageTier(storageClass) && effectivePerTb > b2PricePerTb;
}

export function applyTierSelectionConfig(
  tiers: TierInventoryRow[],
  modelConfig: ModelConfig | null | undefined,
): TierInventoryRow[] {
  if (!modelConfig) return tiers;

  const toggles = modelConfig.tierToggles || {};
  const isCurrentSelectionModel = (modelConfig.tierSelectionVersion || 1) >= TIER_SELECTION_VERSION;

  return tiers.map((tier) => {
    const savedToggle = toggles[tier.id];

    if (isCurrentSelectionModel && typeof savedToggle === 'boolean') {
      return { ...tier, migrateToB2: savedToggle };
    }

    if (!isCurrentSelectionModel && typeof savedToggle === 'boolean' && isHotStorageTier(tier.storageClass)) {
      return { ...tier, migrateToB2: savedToggle };
    }

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
