import type { ParsedLineItem, NamedDiscount } from '@/types/analysis';
import type { PricingDetectionResult } from '@/types/model';
import { getListRate, getBlendedListRate } from './lookup';

// Region sentinels the parsers use when a line item's region could not be resolved. The
// pricing lookup aliases these to us-east-1, so comparing a real effective rate against that
// baseline manufactures phantom discounts. Per-tier verdicts skip these groups entirely.
const FALLBACK_REGIONS = new Set(['global', 'all regions', 'unknown']);

/**
 * Infer whether a customer is paying list price, a small negotiated discount, or a custom
 * agreement (EDP/PRC/committed spend) by comparing each storage tier's effective $/GB-month
 * against published list rates. Optionally attributes named discount programs to storage spend.
 * Returns one verdict per (storage class, region) group plus one per discount program.
 */
export function detectCustomPricing(
  lineItems: ParsedLineItem[],
  discounts?: NamedDiscount[],
): PricingDetectionResult[] {
  const results: PricingDetectionResult[] = [];

  const storageItems = lineItems.filter(
    (i) => i.category === 'storage' && i.storageClass && i.usageQuantity && i.usageQuantity > 0,
  );

  // Aggregate to one effective rate per (storage class, region): summing cost and GB across a
  // tier's line items yields a volume-weighted blended rate, which is what we compare to list.
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
    // Skip sub-$0.50 tiers: dividing tiny cost by tiny volume amplifies rounding into a bogus
    // effective rate, which would misclassify the discount.
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

    // Compare against the blended rate at THIS volume, not the first-tier rate: AWS Standard
    // tiers cheaper as volume grows, so a flat list comparison would read normal tiering as a
    // negotiated discount. Falls back to the flat rate when no tier schedule exists.
    const expectedBlendedRate = getBlendedListRate(provider, storageClass, region, totalGb) ?? listRate;
    const discountPercent = ((expectedBlendedRate - effectiveRate) / expectedBlendedRate) * 100;

    let assessment: PricingDetectionResult['assessment'];
    let details: string;

    // Thresholds (%): <=3 is within list-price noise; <=15 reads as a routine negotiated
    // discount; beyond that implies a custom contract (EDP, PRC, committed spend).
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

  // Named discount programs (e.g. an EDP credit) apply across the whole bill, not per tier.
  // Estimate how much of each program's effect lands on storage by computing one overall
  // storage discount and apportioning it to programs by their share of total discount dollars.
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
      // Attribute the overall storage discount to this program by its dollar share of all
      // discounts — a rough split, since the bill doesn't break programs down by service.
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
