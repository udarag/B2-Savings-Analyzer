import type { ParsedLineItem, NamedDiscount } from '@/types/analysis';
import type { PricingDetectionResult } from '@/types/model';
import { getListRate, getBlendedListRate } from './lookup';

// Region sentinels the parsers use when a line item's region could not be resolved. The
// pricing lookup aliases these to us-east-1, so comparing a real effective rate against that
// baseline manufactures phantom discounts. Per-tier verdicts skip these groups entirely.
const FALLBACK_REGIONS = new Set(['global', 'all regions', 'unknown']);

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
    if (totalGb < 1) continue;
    // Skip tiers where cost is too small for reliable rate calculation (rounding noise)
    if (totalCost < 0.50) continue;

    const [storageClass, region] = key.split('|');
    // Skip groups whose region is a fallback sentinel: the list-rate baseline would be the
    // wrong region, so stay silent rather than assert an unverifiable per-tier discount.
    if (FALLBACK_REGIONS.has(region.toLowerCase())) continue;
    const effectiveRate = totalCost / totalGb;

    const provider = storageItems.find(
      (i) => i.storageClass === storageClass && i.region === region,
    )?.provider;
    if (!provider) continue;

    const listRate = getListRate(provider, storageClass, region);
    if (listRate === null || listRate === 0) continue;

    // Compare against the expected blended rate for this volume (accounts for volume tiering)
    const expectedBlendedRate = getBlendedListRate(provider, storageClass, region, totalGb) ?? listRate;
    const discountPercent = ((expectedBlendedRate - effectiveRate) / expectedBlendedRate) * 100;

    let assessment: PricingDetectionResult['assessment'];
    let details: string;

    if (discountPercent <= 3) {
      assessment = 'list-price';
      details = 'Paying at or near list price';
    } else if (discountPercent <= 15) {
      assessment = 'small-discount';
      details = `~${Math.round(discountPercent)}% below list — likely a small negotiated discount`;
    } else {
      assessment = 'custom-agreement';
      details = `~${Math.round(discountPercent)}% below list — likely a custom pricing agreement (EDP, PRC, or committed spend)`;
    }

    results.push({
      category: 'storage',
      storageClass,
      region,
      effectiveRate: Math.round(effectiveRate * 1e6) / 1e6,
      listRate: expectedBlendedRate,
      discountPercent: Math.round(discountPercent * 10) / 10,
      assessment,
      details,
    });
  }

  if (discounts && discounts.length > 0) {
    let totalStorageGb = 0;
    let totalStorageCost = 0;
    let weightedListCost = 0;
    for (const [key, { totalCost, totalGb }] of grouped) {
      const [storageClass, region] = key.split('|');
      totalStorageCost += totalCost;
      totalStorageGb += totalGb;
      const provider = storageItems.find(
        (i) => i.storageClass === storageClass && i.region === region,
      )?.provider;
      const lr = provider ? getBlendedListRate(provider, storageClass, region, totalGb) : null;
      if (lr) weightedListCost += lr * totalGb;
    }

    const overallEffective = totalStorageGb > 0 ? totalStorageCost / totalStorageGb : 0;
    const overallList = totalStorageGb > 0 ? weightedListCost / totalStorageGb : 0;
    const overallDiscountPct = overallList > 0 ? ((overallList - overallEffective) / overallList) * 100 : 0;
    const totalDiscountAmount = discounts.reduce((s, d) => s + d.amountUsd, 0);

    for (const d of discounts) {
      const programShare = totalDiscountAmount > 0 ? d.amountUsd / totalDiscountAmount : 0;
      const programStoragePctOff = overallDiscountPct * programShare;

      results.push({
        category: 'discount-program',
        effectiveRate: overallEffective,
        listRate: overallList,
        discountPercent: Math.round(programStoragePctOff * 10) / 10,
        assessment: 'custom-agreement',
        details: `${d.name}: $${d.amountUsd.toLocaleString()} discount applied across all services`,
        programName: d.name,
        totalAmountUsd: d.amountUsd,
        storageAmountUsd: d.storageAmountUsd,
        storagePercentOff: d.estimatedPercent || (programStoragePctOff > 0 ? Math.round(programStoragePctOff * 10) / 10 : undefined),
      });
    }
  }

  return results;
}
