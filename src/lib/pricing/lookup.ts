// Published list-rate lookups against the bundled per-provider pricing JSON. All storage rates
// returned here are $/GB-month on the app's decimal-GB basis (the pricing JSONs already normalize
// GCP's native GiB-month rates), so callers can compare effective rates without a unit conversion.
import awsPricing from './aws.json';
import gcpPricing from './gcp.json';
import azurePricing from './azure.json';
import r2Pricing from './r2.json';

// Map coarse/aggregate region labels onto a concrete priced region. Bills frequently report
// "All Regions" or a bare "US" for S3 lines that lack a real region; without a fallback those
// would miss the pricing table entirely. us-east-1 is the conventional US baseline.
const AWS_REGION_ALIASES: Record<string, string> = {
  'All Regions': 'us-east-1',
  'GLOBAL': 'us-east-1',
  'EU': 'eu-west-1',
  'US': 'us-east-1',
};

// Normalize the many storage-class labels bills use into the canonical keys in aws.json.
// Summary invoices have no per-class breakdown, so "S3 (Summary)" is priced as Standard; the
// legacy "Glacier" name maps to its current "Flexible Retrieval" equivalent.
const AWS_CLASS_MAP: Record<string, string> = {
  'Standard': 'Standard',
  'S3 (Summary)': 'Standard',
  'Standard-IA': 'Standard-IA',
  'One Zone-IA': 'One Zone-IA',
  'Glacier Instant Retrieval': 'Glacier Instant Retrieval',
  'Glacier Flexible Retrieval': 'Glacier Flexible Retrieval',
  'Glacier Deep Archive': 'Glacier Deep Archive',
  'Glacier': 'Glacier Flexible Retrieval',
  'Intelligent-Tiering (Frequent)': 'Intelligent-Tiering-FA',
  'Intelligent-Tiering (Infrequent)': 'Intelligent-Tiering-IA',
  'Intelligent-Tiering (Archive Instant)': 'Intelligent-Tiering-AIA',
  'Intelligent-Tiering (Archive)': 'Intelligent-Tiering-AA',
  'Intelligent-Tiering (Deep Archive)': 'Intelligent-Tiering-DAA',
  'Intelligent-Tiering-AA': 'Intelligent-Tiering-AA',
  'Intelligent-Tiering-DAA': 'Intelligent-Tiering-DAA',
};

const GCP_CLASS_MAP: Record<string, string> = {
  'Standard': 'Standard',
  'Nearline': 'Nearline',
  'Coldline': 'Coldline',
  'Archive': 'Archive',
};

const AZURE_CLASS_MAP: Record<string, string> = {
  'Hot (LRS)': 'Hot-LRS',
  'Hot (ZRS)': 'Hot-ZRS',
  'Hot (GRS)': 'Hot-GRS',
  'Hot (RA-GRS)': 'Hot-RA-GRS',
  'Cool (LRS)': 'Cool-LRS',
  'Cool (ZRS)': 'Cool-ZRS',
  'Cool (GRS)': 'Cool-GRS',
  'Cool (RA-GRS)': 'Cool-RA-GRS',
  'Cold (LRS)': 'Cold-LRS',
  'Cold (ZRS)': 'Cold-ZRS',
  'Cold (GRS)': 'Cold-GRS',
  'Cold (RA-GRS)': 'Cold-RA-GRS',
  'Archive (LRS)': 'Archive-LRS',
  'Archive (GRS)': 'Archive-GRS',
  'Archive (RA-GRS)': 'Archive-RA-GRS',
};

// A volume-pricing band: rate (perGb) applies up to maxGb/maxTb of cumulative volume. The cap is
// expressed in whichever unit the JSON uses; a null/absent cap marks the open-ended top band.
type PricingTier = {
  maxGb?: number | null;
  maxTb?: number | null;
  perGb: number;
};

// First-tier (lowest-volume) list rate. A bare number means flat, non-tiered pricing.
function firstTierRate(tierData: unknown): number | null {
  if (typeof tierData === 'number') return tierData;
  if (Array.isArray(tierData) && tierData.length > 0) {
    return (tierData[0] as { perGb: number }).perGb;
  }
  return null;
}

// Upper volume bound of a tier in GB. maxTb caps are converted at 1024 (binary TB) to match the
// pricing JSON's convention; a missing cap is the unbounded top tier.
function tierCapGb(tier: PricingTier): number {
  if ('maxGb' in tier) return tier.maxGb ?? Infinity;
  if ('maxTb' in tier) return tier.maxTb !== null && tier.maxTb !== undefined ? tier.maxTb * 1024 : Infinity;
  return Infinity;
}

// Volume-weighted average $/GB-month across all tiers a given total volume spans. Cloud storage
// is priced marginally (each band billed at its own rate), so the blended rate of a large volume
// is lower than the first-tier rate — this is what lets us judge discounts fairly against tiering.
function blendedRate(tierData: unknown, totalGb: number): number | null {
  if (typeof tierData === 'number') return tierData;
  if (!Array.isArray(tierData) || tierData.length === 0) return null;

  const tiers = tierData as PricingTier[];
  let remaining = totalGb;
  let totalCost = 0;
  let previousCapGb = 0;

  for (const tier of tiers) {
    if (remaining <= 0) break;
    const currentCapGb = tierCapGb(tier);
    const tierSizeGb = currentCapGb - previousCapGb;
    const gbInTier = Math.min(remaining, tierSizeGb);
    totalCost += gbInTier * tier.perGb;
    remaining -= gbInTier;
    previousCapGb = currentCapGb;
  }

  return totalGb > 0 ? totalCost / totalGb : null;
}

function getAwsListRate(storageClass: string, region: string): number | null {
  const regionKey = AWS_REGION_ALIASES[region] || region;
  const storage = (awsPricing as Record<string, unknown>).storage as Record<string, Record<string, unknown>> | undefined;
  if (!storage) return null;

  // Fall back to us-east-1 for any region we don't price explicitly, so an unrecognized region
  // still yields a defensible rate rather than null (which would drop the line from analysis).
  const regionData = storage[regionKey] || storage['us-east-1'];
  if (!regionData) return null;

  const key = AWS_CLASS_MAP[storageClass];
  if (!key) return null;

  return firstTierRate(regionData[key]);
}

function getAwsBlendedRate(storageClass: string, region: string, totalGb: number): number | null {
  const regionKey = AWS_REGION_ALIASES[region] || region;
  const storage = (awsPricing as Record<string, unknown>).storage as Record<string, Record<string, unknown>> | undefined;
  if (!storage) return null;

  const regionData = storage[regionKey] || storage['us-east-1'];
  if (!regionData) return null;

  const key = AWS_CLASS_MAP[storageClass];
  if (!key) return null;

  return blendedRate(regionData[key], totalGb);
}

function getGcpListRate(storageClass: string, locationType: string): number | null {
  const storage = (gcpPricing as Record<string, unknown>).storage as Record<string, Record<string, unknown>> | undefined;
  if (!storage) return null;

  const key = GCP_CLASS_MAP[storageClass];
  if (!key) return null;

  const normalizedLocationType = locationType.toLowerCase();

  // Classify the raw location label into a priced bucket. Asia-specific multi/dual-region rates
  // differ from the global ones, so the Asia branches must be checked before the generic ones.
  // Multi/dual-region GCP storage is geo-redundant; the cost model accounts for matching that
  // durability on B2 with a second-region copy (~2x storage) elsewhere — not here.
  let locationKey = 'regional';
  if (normalizedLocationType.includes('asia') && normalizedLocationType.includes('multi')) {
    locationKey = 'asia-multi-region';
  } else if (normalizedLocationType.includes('multi')) {
    locationKey = 'multi-region';
  } else if (normalizedLocationType.includes('asia') && normalizedLocationType.includes('dual')) {
    locationKey = 'asia-dual-region';
  } else if (normalizedLocationType.includes('dual')) {
    locationKey = 'dual-region';
  }

  const locationData = storage[locationKey] || storage['regional'];
  if (!locationData) return null;

  const rate = locationData[key];
  return typeof rate === 'number' ? rate : null;
}

function getAzureListRate(storageClass: string, region: string): number | null {
  const regionKey = region || 'eastus';
  const regionPricing = (azurePricing as Record<string, unknown>).storage as Record<string, Record<string, unknown>> | undefined;
  if (!regionPricing) return null;

  const rp = regionPricing[regionKey] || regionPricing['eastus'];
  if (!rp) return null;

  const key = AZURE_CLASS_MAP[storageClass] || storageClass;
  return firstTierRate(rp[key]);
}

function getAzureBlendedRate(storageClass: string, region: string, totalGb: number): number | null {
  const regionKey = region || 'eastus';
  const regionPricing = (azurePricing as Record<string, unknown>).storage as Record<string, Record<string, unknown>> | undefined;
  if (!regionPricing) return null;

  const rp = regionPricing[regionKey] || regionPricing['eastus'];
  if (!rp) return null;

  const key = AZURE_CLASS_MAP[storageClass] || storageClass;
  return blendedRate(rp[key], totalGb);
}

/**
 * Volume-weighted list rate ($/GB-month) for the given storage at totalGb of volume. Only AWS and
 * Azure publish tiered storage pricing; GCP and R2 are flat, so they defer to the single list rate.
 * Returns null when the provider/class/region can't be priced.
 */
export function getBlendedListRate(
  provider: string,
  storageClass: string,
  region: string,
  totalGb: number,
): number | null {
  if (provider === 'aws') return getAwsBlendedRate(storageClass, region, totalGb);
  if (provider === 'azure') return getAzureBlendedRate(storageClass, region, totalGb);
  return getListRate(provider, storageClass, region);
}

/**
 * First-tier published list rate ($/GB-month) for the given provider/class/region, or null if it
 * can't be resolved. For tiered providers this is the entry (lowest-volume) rate; use
 * getBlendedListRate when you need the effective rate at a specific volume.
 */
export function getListRate(
  provider: string,
  storageClass: string,
  region: string,
): number | null {
  switch (provider) {
    case 'aws':
      return getAwsListRate(storageClass, region);
    case 'gcp':
      // getGcpListRate lowercases and classifies the location label itself, so pass
      // the raw region through. Re-deriving it here was case-sensitive and silently
      // collapsed 'US Multi-region'/'US Dual-region' to the cheaper regional rate.
      return getGcpListRate(storageClass, region);
    case 'azure':
      return getAzureListRate(storageClass, region);
    case 'r2': {
      const r2Storage = (r2Pricing as Record<string, unknown>).storage as Record<string, number>;
      return r2Storage?.['Standard'] ?? null;
    }
    default:
      return null;
  }
}

/**
 * Per-GB data-retrieval rate for a storage class, or 0 when the class is free to retrieve (e.g.
 * AWS Standard) or unknown. Archive tiers can have multiple retrieval speeds; we use the standard
 * speed. This is distinct from egress — it's the charge to pull cold data back to a hot tier.
 */
export function getRetrievalRate(provider: string, storageClass: string): number {
  if (provider === 'aws') {
    const retrieval = (awsPricing as Record<string, unknown>).retrieval as Record<string, unknown> | undefined;
    if (!retrieval) return 0;
    const rate = retrieval[storageClass];
    if (typeof rate === 'number') return rate;
    // Glacier classes expose a per-speed object; default to the standard retrieval speed.
    if (typeof rate === 'object' && rate !== null) return (rate as Record<string, number>).standard ?? 0;
    return 0;
  }
  if (provider === 'gcp') {
    const retrieval = (gcpPricing as Record<string, unknown>).retrieval as Record<string, number> | undefined;
    if (!retrieval) return 0;
    return retrieval[storageClass] ?? 0;
  }
  if (provider === 'azure') {
    const retrieval = (azurePricing as Record<string, unknown>).retrieval as Record<string, number> | undefined;
    if (!retrieval) return 0;
    // Azure retrieval is priced by tier regardless of redundancy, so strip the trailing
    // redundancy suffix (e.g. "Cool (LRS)" -> "Cool") before looking it up.
    const base = storageClass.replace(/ \(.*\)$/, '');
    return retrieval[base] ?? 0;
  }
  return 0;
}

/**
 * Default per-GB egress (data-transfer-out) rate for a provider, used when a bill gives no
 * observed egress rate. Returns the first PAID tier — providers bundle a free monthly allowance as
 * tier 0, which isn't representative. R2 is 0 by design (no egress fees), the core B2/R2 pitch.
 */
export function getDefaultEgressRate(provider: string, region?: string): number {
  if (provider === 'aws') {
    const dto = (awsPricing as Record<string, unknown>).dataTransferOut as Record<string, Array<{ perGb: number }>> | undefined;
    if (!dto) return 0;
    const regionKey = region ? (AWS_REGION_ALIASES[region] || region) : 'us-east-1';
    const tiers = dto[regionKey] || dto['us-east-1'];
    // Use the first paid tier rather than a hardcoded index; tier 0 is the free allowance.
    return tiers?.find((t) => t.perGb > 0)?.perGb ?? 0;
  }
  if (provider === 'gcp') {
    const dto = (gcpPricing as Record<string, unknown>).dataTransferOut as Array<{ perGb: number }> | undefined;
    return dto?.[0]?.perGb ?? 0;
  }
  if (provider === 'azure') {
    const dto = (azurePricing as Record<string, unknown>).dataTransferOut as Array<{ perGb: number }> | undefined;
    if (!dto) return 0;
    const paid = dto.find(t => t.perGb > 0);
    return paid?.perGb ?? 0;
  }
  if (provider === 'r2') return 0;
  return 0;
}
