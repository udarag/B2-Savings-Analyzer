import awsPricing from './aws.json';
import gcpPricing from './gcp.json';
import azurePricing from './azure.json';
import r2Pricing from './r2.json';

const AWS_REGION_ALIASES: Record<string, string> = {
  'All Regions': 'us-east-1',
  'GLOBAL': 'us-east-1',
  'EU': 'eu-west-1',
  'US': 'us-east-1',
};

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

type PricingTier = {
  maxGb?: number | null;
  maxTb?: number | null;
  perGb: number;
};

function firstTierRate(tierData: unknown): number | null {
  if (typeof tierData === 'number') return tierData;
  if (Array.isArray(tierData) && tierData.length > 0) {
    return (tierData[0] as { perGb: number }).perGb;
  }
  return null;
}

function tierCapGb(tier: PricingTier): number {
  if ('maxGb' in tier) return tier.maxGb ?? Infinity;
  if ('maxTb' in tier) return tier.maxTb !== null && tier.maxTb !== undefined ? tier.maxTb * 1024 : Infinity;
  return Infinity;
}

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

  let locationKey = 'regional';
  if (locationType.includes('asia') && locationType.includes('multi')) {
    locationKey = 'asia-multi-region';
  } else if (locationType.includes('multi')) {
    locationKey = 'multi-region';
  } else if (locationType.includes('dual')) {
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

export function getListRate(
  provider: string,
  storageClass: string,
  region: string,
): number | null {
  switch (provider) {
    case 'aws':
      return getAwsListRate(storageClass, region);
    case 'gcp': {
      let locationType = 'regional';
      if (region.includes('asia') && region.includes('multi')) locationType = 'asia-multi-region';
      else if (region.includes('multi')) locationType = 'multi-region';
      else if (region.includes('dual')) locationType = 'dual-region';
      return getGcpListRate(storageClass, locationType);
    }
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

export function getRetrievalRate(provider: string, storageClass: string): number {
  if (provider === 'aws') {
    const retrieval = (awsPricing as Record<string, unknown>).retrieval as Record<string, unknown> | undefined;
    if (!retrieval) return 0;
    const rate = retrieval[storageClass];
    if (typeof rate === 'number') return rate;
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
    const base = storageClass.replace(/ \(.*\)$/, '');
    return retrieval[base] ?? 0;
  }
  return 0;
}

export function getDefaultEgressRate(provider: string): number {
  if (provider === 'aws') {
    const dto = (awsPricing as Record<string, unknown>).dataTransferOut as Record<string, Array<{ perGb: number }>> | undefined;
    if (!dto) return 0;
    const usEast = dto['us-east-1'];
    if (usEast && usEast.length >= 2) return usEast[1].perGb;
    return 0;
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
