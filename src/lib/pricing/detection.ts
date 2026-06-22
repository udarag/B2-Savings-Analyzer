import type { ParsedLineItem, NamedDiscount } from '@/types/analysis';
import type { PricingDetectionResult } from '@/types/model';
import { getListRate } from './lookup';

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
    // Skip negligible tiers — effective rate is meaningless below 1 GB
    if (totalGb < 1) continue;

    const [storageClass, region] = key.split('|');
    const effectiveRate = totalCost / totalGb;

    let listRate: number | null = null;
    const provider = storageItems.find(
      (i) => i.storageClass === storageClass && i.region === region,
    )?.provider;

    if (provider) {
      listRate = getListRate(provider, storageClass, region);
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
    // Compute overall effective and list rates from the tier analysis above
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
      const lr = provider ? getListRate(provider, storageClass, region) : null;
      if (lr) weightedListCost += lr * totalGb;
    }

    const overallEffective = totalStorageGb > 0 ? totalStorageCost / totalStorageGb : 0;
    const overallList = totalStorageGb > 0 ? weightedListCost / totalStorageGb : 0;
    const overallDiscountPct = overallList > 0 ? ((overallList - overallEffective) / overallList) * 100 : 0;
    const totalDiscountAmount = discounts.reduce((s, d) => s + d.amountUsd, 0);

    for (const d of discounts) {
      // Approximate each program's share of the overall storage discount proportionally
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
