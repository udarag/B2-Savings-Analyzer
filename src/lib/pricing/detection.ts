import type { ParsedLineItem, NamedDiscount } from '@/types/analysis';
import type { PricingDetectionResult, DealSizing } from '@/types/model';
import awsPricing from './aws.json';
import gcpPricing from './gcp.json';
import azurePricing from './azure.json';
import r2Pricing from './r2.json';

function getAwsListRate(storageClass: string, region: string): number | null {
  const regionKey = region === 'us-east-1' || region === 'us-west-2' ? 'us-east-1' : region;
  const regionPricing = (awsPricing as Record<string, unknown>).regions as Record<string, unknown> | undefined;
  if (!regionPricing) return null;

  const rp = regionPricing[regionKey] as Record<string, unknown> | undefined;
  if (!rp) return null;

  const storageTiers = rp['storage'] as Record<string, unknown> | undefined;
  if (!storageTiers) return null;

  const classMap: Record<string, string> = {
    'Standard': 'standard',
    'Standard-IA': 'standardIa',
    'One Zone-IA': 'oneZoneIa',
    'Glacier Instant Retrieval': 'glacierInstantRetrieval',
    'Glacier Flexible Retrieval': 'glacierFlexible',
    'Glacier Deep Archive': 'glacierDeepArchive',
    'Intelligent-Tiering (Frequent)': 'intelligentTieringFa',
    'Intelligent-Tiering (Infrequent)': 'intelligentTieringIa',
  };

  const key = classMap[storageClass];
  if (!key) return null;

  const tierData = storageTiers[key];
  if (typeof tierData === 'number') return tierData;
  if (tierData && typeof tierData === 'object' && 'first50Tb' in tierData) {
    return (tierData as { first50Tb: number }).first50Tb;
  }

  return null;
}

function getGcpListRate(storageClass: string, locationType: string): number | null {
  const gcpRegions = (gcpPricing as Record<string, unknown>).regions as Record<string, unknown> | undefined;
  if (!gcpRegions) return null;

  const classMap: Record<string, string> = {
    'Standard': 'standard',
    'Nearline': 'nearline',
    'Coldline': 'coldline',
    'Archive': 'archive',
  };

  const key = classMap[storageClass];
  if (!key) return null;

  const regionType = locationType === 'multi-region' ? 'multi-region' : 'regional';
  const rp = gcpRegions[regionType] as Record<string, unknown> | undefined;
  if (!rp) return null;

  const storageTiers = rp['storage'] as Record<string, unknown> | undefined;
  if (!storageTiers) return null;

  const rate = storageTiers[key];
  return typeof rate === 'number' ? rate : null;
}

function getAzureListRate(storageClass: string, region: string): number | null {
  const regionKey = region || 'eastus';
  const regionPricing = (azurePricing as Record<string, unknown>).storage as Record<string, Record<string, unknown>> | undefined;
  if (!regionPricing) return null;

  const rp = regionPricing[regionKey] || regionPricing['eastus'];
  if (!rp) return null;

  const classMap: Record<string, string> = {
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

  const key = classMap[storageClass] || storageClass;
  const tierData = rp[key];
  if (typeof tierData === 'number') return tierData;
  if (Array.isArray(tierData) && tierData.length > 0) {
    return (tierData[0] as { perGb: number }).perGb;
  }

  return null;
}

export function detectCustomPricing(
  lineItems: ParsedLineItem[],
  discounts?: NamedDiscount[],
): PricingDetectionResult[] {
  const results: PricingDetectionResult[] = [];

  const storageItems = lineItems.filter(
    (i) => i.category === 'storage' && i.storageClass && i.usageQuantity && i.usageQuantity > 0,
  );

  const grouped = new Map<string, { totalCost: number; totalGb: number }>();
  for (const item of storageItems) {
    const key = `${item.storageClass}|${item.region}`;
    const existing = grouped.get(key) || { totalCost: 0, totalGb: 0 };
    existing.totalCost += item.costUsd;
    existing.totalGb += item.usageQuantity!;
    grouped.set(key, existing);
  }

  for (const [key, { totalCost, totalGb }] of grouped) {
    const [storageClass, region] = key.split('|');
    const effectiveRate = totalCost / totalGb;

    let listRate: number | null = null;
    const provider = storageItems.find(
      (i) => i.storageClass === storageClass && i.region === region,
    )?.provider;

    if (provider === 'aws') {
      listRate = getAwsListRate(storageClass, region);
    } else if (provider === 'gcp') {
      const locationType = region.includes('multi') ? 'multi-region' : 'regional';
      listRate = getGcpListRate(storageClass, locationType);
    } else if (provider === 'azure') {
      listRate = getAzureListRate(storageClass, region);
    } else if (provider === 'r2') {
      listRate = (r2Pricing.storage as { perGbMonth: number }).perGbMonth;
    }

    if (listRate === null || listRate === 0) continue;

    const discountPercent = ((listRate - effectiveRate) / listRate) * 100;
    let assessment: PricingDetectionResult['assessment'];
    let details: string;

    if (discountPercent <= 3) {
      assessment = 'list-price';
      details = 'Paying at or near list price';
    } else if (discountPercent <= 15) {
      assessment = 'small-discount';
      details = `~${Math.round(discountPercent)}% below list — likely volume tiering or small negotiated discount`;
    } else {
      assessment = 'custom-agreement';
      details = `~${Math.round(discountPercent)}% below list — likely a custom pricing agreement (EDP, PRC, or committed spend)`;
    }

    results.push({
      category: 'storage',
      storageClass,
      region,
      effectiveRate: Math.round(effectiveRate * 1e6) / 1e6,
      listRate,
      discountPercent: Math.round(discountPercent * 10) / 10,
      assessment,
      details,
    });
  }

  if (discounts && discounts.length > 0) {
    for (const d of discounts) {
      results.push({
        category: 'discount-program',
        effectiveRate: 0,
        listRate: 0,
        discountPercent: d.estimatedPercent || 0,
        assessment: 'custom-agreement',
        details: `${d.name}: $${d.amountUsd.toLocaleString()} discount applied`,
      });
    }
  }

  return results;
}

export function computeDealSizing(
  b2MonthlyCost: number,
  termMonths: number,
): DealSizing {
  return {
    monthlyB2Revenue: Math.round(b2MonthlyCost * 100) / 100,
    annualB2Revenue: Math.round(b2MonthlyCost * 12 * 100) / 100,
    termContractValue: Math.round(b2MonthlyCost * termMonths * 100) / 100,
    termMonths,
  };
}
