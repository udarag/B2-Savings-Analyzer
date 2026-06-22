import type { ParsedBill, BillType, Provider } from '@/types/analysis';
import { detectCustomPricing } from '@/lib/pricing/detection';

export type ReadinessStatus = 'ready' | 'directional' | 'needs-detail' | 'not-useful';
export type ReadinessCheckTone = 'good' | 'warning' | 'missing' | 'neutral';
export type ReadinessCheckId =
  | 'opportunity-size'
  | 'storage-detail'
  | 'egress-detail'
  | 'pricing-terms'
  | 'workload-targeting';

export interface ReadinessCheck {
  id: ReadinessCheckId;
  label: string;
  value: string;
  detail: string;
  tone: ReadinessCheckTone;
  action?: 'confirm-discount';
  actionLabel?: string;
}

export interface ReadinessAssessment {
  status: ReadinessStatus;
  label: string;
  score: number;
  summary: string;
  trustedSignals: string[];
  attentionItems: string[];
  nextSteps: string[];
  checks: ReadinessCheck[];
}

interface ReadinessOptions {
  pricingDiscountConfirmed?: boolean;
}

function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(1, part / whole));
}

function wholePercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDiscountSource(storageClass?: string, region?: string): string {
  if (storageClass && region) return `${storageClass} in ${region}`;
  return storageClass || region || 'A storage tier';
}

function sumCost(items: ParsedBill['lineItems']): number {
  return items.reduce((sum, item) => sum + item.costUsd, 0);
}

function hasKnownRegion(region: string): boolean {
  const normalized = region.toLowerCase();
  return Boolean(region) &&
    normalized !== 'unknown' &&
    normalized !== 'global' &&
    normalized !== 'all regions';
}

function providerDetailRequest(provider?: Provider): string {
  switch (provider) {
    case 'aws':
      return 'Ask for an AWS Cost & Usage Report or Cost Explorer export with UsageType, UsageQuantity, cost, ProductCode, region, and linked account fields.';
    case 'gcp':
      return 'Ask for a GCP Billing export with service, SKU, usage amount, usage unit, subtotal, credits, project, and location fields.';
    case 'azure':
      return 'Ask for an Azure cost export with meter, quantity, unit price, cost, resource group, subscription, region, and reservation/discount fields.';
    case 'r2':
      return 'Ask for an R2 usage export with storage GB, operation counts, request classes, and any committed-use pricing.';
    default:
      return 'Ask for a detailed billing export with SKU, usage quantity, unit, cost, region, account/project, and discount fields.';
  }
}

function classifyReadiness(score: number, hasAddressableSpend: boolean): Pick<ReadinessAssessment, 'status' | 'label' | 'summary'> {
  if (!hasAddressableSpend || score < 40) {
    return {
      status: 'not-useful',
      label: 'Not Useful Yet',
      summary: 'The bill does not expose enough B2-addressable storage detail to support a credible savings case.',
    };
  }

  if (score >= 82) {
    return {
      status: 'ready',
      label: 'Ready to Sell',
      summary: 'The bill has enough storage, pricing, and usage detail for a defensible B2 savings conversation.',
    };
  }

  if (score >= 65) {
    return {
      status: 'directional',
      label: 'Good Directional Estimate',
      summary: 'The bill can size the opportunity, but the AE should confirm the open assumptions before sharing numbers externally.',
    };
  }

  return {
    status: 'needs-detail',
    label: 'Needs More Detail',
    summary: 'The bill points to a possible B2 opportunity, but key commercial inputs are missing or estimated.',
  };
}

export function assessReadiness(
  parsed: ParsedBill,
  billType?: BillType,
  provider?: Provider,
  options: ReadinessOptions = {},
): ReadinessAssessment {
  const storageItems = parsed.lineItems.filter((item) => item.category === 'storage');
  const egressItems = parsed.lineItems.filter((item) => item.category === 'egress');
  const operationsItems = parsed.lineItems.filter((item) => item.category === 'operations');
  const retrievalItems = parsed.lineItems.filter((item) => item.category === 'retrieval');
  const addressableItems = parsed.lineItems.filter((item) =>
    item.category === 'storage' ||
    item.category === 'egress' ||
    item.category === 'operations' ||
    item.category === 'retrieval'
  );

  const storageSpend = sumCost(storageItems);
  const egressSpend = sumCost(egressItems);
  const operationsRetrievalSpend = sumCost(operationsItems) + sumCost(retrievalItems);
  const addressableSpend = sumCost(addressableItems);
  const hasAddressableSpend = addressableSpend > 0 && storageSpend > 0;

  const isSummaryBill = billType === 'summary-invoice' ||
    parsed.lineItems.some((item) => item.sku === 'SUMMARY') ||
    (storageItems.length > 0 && storageItems.every((item) => item.isEstimate));
  const hasReconciliationWarning = parsed.warnings.some((warning) =>
    /differs|captures|reported total|grand total/i.test(warning)
  );
  const hasDetailRequestWarning = parsed.warnings.some((warning) =>
    /summary invoice|per-SKU detail|detailed billing|Cost & Usage/i.test(warning)
  );
  const hasListPriceSignal = parsed.warnings.some((warning) => /list price/i.test(warning));
  const pricingResults = detectCustomPricing(parsed.lineItems, parsed.discounts);
  const tierPricingResults = pricingResults.filter((result) => result.category !== 'discount-program');
  const hasPublishedRateComparison = tierPricingResults.length > 0;
  const listPriceTierCount = tierPricingResults.filter((result) => result.assessment === 'list-price').length;
  const discountedTierCount = tierPricingResults.filter((result) => result.assessment === 'small-discount').length;
  const customPricingTierCount = tierPricingResults.filter((result) => result.assessment === 'custom-agreement').length;
  const matchesPublishedPricing = hasPublishedRateComparison && listPriceTierCount === tierPricingResults.length;
  const detectedDiscountTierCount = discountedTierCount + customPricingTierCount;
  const hasDetectedStorageDiscount = detectedDiscountTierCount > 0;
  const severeDiscountResult = tierPricingResults
    .filter((result) => result.discountPercent >= 50)
    .sort((a, b) => b.discountPercent - a.discountPercent)[0];
  const hasSevereUnconfirmedDiscount = Boolean(severeDiscountResult) && !options.pricingDiscountConfirmed;
  const pricingDiscountConfirmed = Boolean(options.pricingDiscountConfirmed);
  const hasClearPricingTerms = (parsed.discounts?.length || 0) > 0 ||
    matchesPublishedPricing ||
    (hasDetectedStorageDiscount && pricingDiscountConfirmed) ||
    hasListPriceSignal;

  const storageWithUsageSpend = sumCost(storageItems.filter((item) => (item.usageQuantity || 0) > 0));
  const actualStorageUsageSpend = sumCost(storageItems.filter((item) => (item.usageQuantity || 0) > 0 && !item.isEstimate));
  const storageClassifiedSpend = sumCost(storageItems.filter((item) => Boolean(item.storageClass)));
  const knownRegionSpend = sumCost(storageItems.filter((item) => hasKnownRegion(item.region)));
  const egressUsageSpend = sumCost(egressItems.filter((item) => (item.usageQuantity || 0) > 0));

  const storageUsageCoverage = percentOf(storageWithUsageSpend, storageSpend);
  const actualStorageUsageCoverage = percentOf(actualStorageUsageSpend, storageSpend);
  const storageClassCoverage = percentOf(storageClassifiedSpend, storageSpend);
  const knownRegionCoverage = percentOf(knownRegionSpend, storageSpend);
  const egressUsageCoverage = percentOf(egressUsageSpend, egressSpend);

  let granularityScore = parsed.lineItems.length === 0 ? 0 : Math.round(parsed.parseConfidence * 25);
  if (isSummaryBill) granularityScore = Math.min(granularityScore, 10);
  if (hasReconciliationWarning) granularityScore = Math.min(granularityScore, 17);

  const storageScore = storageSpend > 0
    ? Math.round(
      (12 * storageUsageCoverage) +
      (6 * actualStorageUsageCoverage) +
      (4 * storageClassCoverage) +
      (3 * knownRegionCoverage)
    )
    : 0;

  let pricingScore = 0;
  if (hasPublishedRateComparison) pricingScore += 11;
  else if (storageSpend > 0 && storageUsageCoverage > 0) pricingScore += isSummaryBill ? 4 : 8;
  if ((parsed.discounts?.length || 0) > 0 || matchesPublishedPricing || pricingDiscountConfirmed || hasListPriceSignal) pricingScore += 4;
  pricingScore = Math.min(15, pricingScore);

  let egressScore = 0;
  if (egressSpend > 0) {
    egressScore = 8 + Math.round(4 * egressUsageCoverage);
    if (new Set(egressItems.map((item) => item.subcategory || 'Other')).size > 1) {
      egressScore += 3;
    }
  } else {
    egressScore = isSummaryBill ? 2 : 5;
  }
  egressScore = Math.min(15, egressScore);

  let operationsScore = 0;
  if (isSummaryBill) operationsScore = 2;
  else if (operationsRetrievalSpend > 0) operationsScore = 10;
  else if (billType === 'sku-export' || billType === 'detailed-statement') operationsScore = 6;
  else operationsScore = 3;

  const accountScore = parsed.accountServiceBreakdowns?.length
    ? 10
    : parsed.accounts?.length
      ? 6
      : billType === 'sku-export'
        ? 4
        : 3;

  let score = granularityScore + storageScore + pricingScore + egressScore + operationsScore + accountScore;
  if (!hasAddressableSpend) score = Math.min(score, 30);
  score = Math.max(0, Math.min(100, score));

  const trustedSignals: string[] = [];
  const attentionItems: string[] = [];
  const nextSteps: string[] = [];

  if (storageSpend > 0) {
    if (actualStorageUsageCoverage >= 0.8) {
      trustedSignals.push(`${wholePercent(actualStorageUsageCoverage * 100)} of storage spend has actual usage quantities.`);
    } else if (storageUsageCoverage >= 0.8) {
      trustedSignals.push(`${wholePercent(storageUsageCoverage * 100)} of storage spend has usage quantities, but much of it is estimated.`);
    } else {
      attentionItems.push('Storage spend was found, but storage GB is missing or incomplete.');
    }

    if (storageClassCoverage >= 0.9) {
      trustedSignals.push('Storage spend is mapped to storage classes for B2 tier comparison.');
    } else {
      attentionItems.push('Some storage spend is not mapped to a clear storage class.');
    }

    if (knownRegionCoverage >= 0.8) {
      trustedSignals.push('Most storage spend has region detail for provider-rate comparison.');
    } else {
      attentionItems.push('Region detail is missing or broad for part of the storage spend.');
    }
  } else {
    attentionItems.push('No material object-storage spend was identified.');
  }

  if (egressSpend > 0) {
    if (egressUsageCoverage >= 0.8) {
      trustedSignals.push('Egress spend includes usage quantities for bandwidth modeling.');
    } else {
      attentionItems.push('Egress cost is visible, but bandwidth volume or destination needs confirmation.');
    }
  } else {
    attentionItems.push('No egress spend was detected; confirm whether the export excludes data transfer or the customer has low/no egress.');
  }

  if ((parsed.discounts?.length || 0) > 0) {
    trustedSignals.push('Named discounts were detected, so savings can be compared against discounted spend.');
  } else if (matchesPublishedPricing) {
    trustedSignals.push('Effective storage rates match published pricing, so no storage discount is indicated.');
  } else if (hasDetectedStorageDiscount && pricingDiscountConfirmed) {
    trustedSignals.push('AE confirmed the below-list storage rates reflect the customer’s discount.');
  } else if (hasSevereUnconfirmedDiscount && severeDiscountResult) {
    attentionItems.push(
      `${formatDiscountSource(severeDiscountResult.storageClass, severeDiscountResult.region)} is ${wholePercent(severeDiscountResult.discountPercent)} below published pricing; confirm before presenting savings.`
    );
  } else if (hasDetectedStorageDiscount) {
    attentionItems.push('Effective storage rates are below published pricing; confirm the customer has a discount or committed agreement.');
  } else if (hasPublishedRateComparison) {
    trustedSignals.push('Effective storage rates were compared against published pricing.');
  } else if (hasListPriceSignal) {
    trustedSignals.push('The bill shows no savings-program charges, which is a useful list-price signal.');
  } else {
    attentionItems.push('Discount or committed-spend terms are not clear from this bill.');
  }

  if (operationsRetrievalSpend > 0) {
    trustedSignals.push('Operations, retrieval, or early deletion fees are visible for true-cost comparison.');
  } else if (isSummaryBill) {
    attentionItems.push('Operations and retrieval fees are hidden in the summary invoice.');
  }

  if (parsed.accountServiceBreakdowns?.length) {
    trustedSignals.push('Account-level storage allocation is available for workload targeting.');
  } else if (parsed.accounts?.length) {
    attentionItems.push('Account totals are available, but service-level account allocation is limited.');
  } else {
    attentionItems.push('No account or project allocation is available for workload targeting.');
  }

  if (isSummaryBill || hasDetailRequestWarning || storageUsageCoverage < 0.8) {
    nextSteps.push(providerDetailRequest(provider));
  }
  if (egressSpend === 0 || egressUsageCoverage < 0.8) {
    nextSteps.push('Confirm monthly egress volume, destinations, and whether a B2 CDN or compute partner is planned.');
  }
  if (hasSevereUnconfirmedDiscount && severeDiscountResult && (parsed.discounts?.length || 0) === 0) {
    nextSteps.push(
      `Confirm with the customer that ${formatDiscountSource(severeDiscountResult.storageClass, severeDiscountResult.region)} is really discounted by about ${wholePercent(severeDiscountResult.discountPercent)}.`
    );
  } else if (hasDetectedStorageDiscount && !pricingDiscountConfirmed && (parsed.discounts?.length || 0) === 0) {
    nextSteps.push('Confirm with the customer that the below-list storage rates are from a real discount or committed agreement.');
  } else if (!hasClearPricingTerms) {
    nextSteps.push('Confirm whether the customer has EDP, private rate card, committed-use, or reseller discounts.');
  }
  if (!parsed.accountServiceBreakdowns?.length) {
    nextSteps.push('Ask which accounts, projects, buckets, or workloads are in scope for migration.');
  }
  if (nextSteps.length === 0) {
    nextSteps.push('Validate workload fit, migration timing, and customer-facing assumptions before presenting savings.');
  }

  const status = classifyReadiness(score, hasAddressableSpend);
  const storageCoverageLabel = storageSpend > 0
    ? actualStorageUsageCoverage >= 0.8
      ? actualStorageUsageCoverage >= 0.995
        ? 'All storage charges include GB usage'
        : `GB usage parsed for ${wholePercent(actualStorageUsageCoverage * 100)} of storage charges`
      : storageUsageCoverage > 0
        ? `GB usage estimated for ${wholePercent(storageUsageCoverage * 100)} of storage charges`
        : 'Storage GB missing'
    : 'No storage spend found';
  const egressLabel = egressSpend > 0
    ? egressUsageCoverage >= 0.8 ? 'Usage and cost parsed' : 'Cost found, volume needs confirmation'
    : 'No egress in bill';
  const discountLabel = (parsed.discounts?.length || 0) > 0
    ? `${parsed.discounts!.length} discount ${parsed.discounts!.length === 1 ? 'program' : 'programs'} detected`
    : severeDiscountResult
      ? pricingDiscountConfirmed
        ? 'Customer confirmed discounted pricing'
        : `${formatDiscountSource(severeDiscountResult.storageClass, severeDiscountResult.region)} is ${wholePercent(severeDiscountResult.discountPercent)} below list`
      : customPricingTierCount > 0
      ? pricingDiscountConfirmed
        ? 'Customer confirmed discounted pricing'
        : `Below published pricing on ${customPricingTierCount} ${customPricingTierCount === 1 ? 'tier' : 'tiers'}`
      : discountedTierCount > 0
        ? pricingDiscountConfirmed
          ? 'Customer confirmed discounted pricing'
          : `Below published pricing on ${discountedTierCount} ${discountedTierCount === 1 ? 'tier' : 'tiers'}`
        : matchesPublishedPricing
          ? 'Matches published list pricing'
          : hasListPriceSignal
            ? 'List-price signal found'
            : 'Discount terms not clear';
  const accountLabel = parsed.accountServiceBreakdowns?.length
    ? 'Service-level account allocation'
    : parsed.accounts?.length
      ? 'Account totals only'
      : 'No account or project detail';

  return {
    ...status,
    score,
    trustedSignals: trustedSignals.slice(0, 4),
    attentionItems: attentionItems.slice(0, 4),
    nextSteps: nextSteps.slice(0, 4),
    checks: [
      {
        id: 'opportunity-size',
        label: 'Opportunity size',
        value: `${formatUsd(addressableSpend)}/mo addressable`,
        detail: 'Storage, egress, operations, and retrieval spend that could change in a B2 model.',
        tone: addressableSpend > 0 ? 'good' : 'missing',
      },
      {
        id: 'storage-detail',
        label: 'Storage detail',
        value: storageCoverageLabel,
        detail: 'Used to size B2 storage cost, migration volume, and one-time transfer assumptions.',
        tone: storageSpend <= 0 || storageUsageCoverage === 0
          ? 'missing'
          : actualStorageUsageCoverage >= 0.8
            ? 'good'
            : 'warning',
      },
      {
        id: 'egress-detail',
        label: 'Egress detail',
        value: egressLabel,
        detail: 'Needed to model B2 free egress, CDN partner fit, and any remaining hyperscaler egress.',
        tone: egressSpend <= 0
          ? 'warning'
          : egressUsageCoverage >= 0.8
            ? 'good'
            : 'warning',
      },
      {
        id: 'pricing-terms',
        label: 'Pricing terms',
        value: discountLabel,
        detail: hasSevereUnconfirmedDiscount && severeDiscountResult && (parsed.discounts?.length || 0) === 0
          ? 'This rate is 50%+ below published pricing. Treat the savings case as high risk until the customer confirms their discount.'
          : hasDetectedStorageDiscount && !pricingDiscountConfirmed && (parsed.discounts?.length || 0) === 0
          ? 'Effective bill rates are lower than published rates. Confirm this is a real customer discount before presenting savings.'
          : pricingDiscountConfirmed
            ? 'AE confirmed the customer has discounted pricing, so savings are compared against their effective billed rates.'
            : matchesPublishedPricing
              ? 'The bill rates match published provider rates, so savings are being compared against apparent list pricing.'
              : 'Tells the AE whether savings are being compared against list price or negotiated pricing.',
        tone: hasSevereUnconfirmedDiscount && (parsed.discounts?.length || 0) === 0
          ? 'missing'
          : hasDetectedStorageDiscount && !pricingDiscountConfirmed && (parsed.discounts?.length || 0) === 0
          ? 'warning'
          : hasClearPricingTerms ? 'good' : 'warning',
        action: hasDetectedStorageDiscount && (parsed.discounts?.length || 0) === 0 ? 'confirm-discount' : undefined,
        actionLabel: 'Customer confirmed discounted pricing',
      },
      {
        id: 'workload-targeting',
        label: 'Workload targeting',
        value: accountLabel,
        detail: 'Helps identify which accounts, projects, buckets, or workloads are in scope for migration.',
        tone: parsed.accountServiceBreakdowns?.length
          ? 'good'
          : parsed.accounts?.length
            ? 'warning'
            : 'missing',
      },
    ],
  };
}
