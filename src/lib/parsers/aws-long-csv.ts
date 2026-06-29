import Papa from 'papaparse';
import { v4 as uuid } from 'uuid';
import type { ParsedLineItem } from '@/types/analysis';
import type { ParseResult } from './types';
import { parseLocaleNumber } from './normalize';
import { transformHeader, resolveColumn } from './csv-utils';
import { classifySku, extractRegion, estimateGbFromCost } from './aws-cost-csv';
import {
  computeParseConfidence,
  classifyParseOutcome,
  sumAddressableCost,
  unsupportedLayoutWarning,
  NO_STORAGE_SCOPE_WARNING,
} from './confidence';

// Column aliases span the CUR's namespaced headers (lineItem/*, product/*) and the friendlier
// labels Cost Explorer exports use, so the same parser handles both shapes. Order is preference:
// for cost, unblended is tried before blended (unblended is what the customer actually pays).
const USAGE_TYPE_ALIASES = ['lineItem/UsageType', 'Usage type', 'UsageType', 'usageType'];
const COST_ALIASES = [
  'lineItem/UnblendedCost', 'lineItem/BlendedCost', 'lineItem/NetUnblendedCost',
  'UnblendedCost', 'BlendedCost', 'Cost($)', 'Cost ($)', 'Cost', 'Amount($)', 'Amount ($)', 'Amount',
];
const PRODUCT_ALIASES = ['lineItem/ProductCode', 'product/ProductName', 'ProductCode', 'Service', 'product/servicecode'];
const REGION_ALIASES = ['product/region', 'lineItem/AvailabilityZone', 'product/location', 'region', 'Region'];

const S3_PRODUCT = /s3|simple storage|glacier/i;
// AWS region id shape (e.g. "us-east-1") — used to trust a region column value over the SKU prefix.
const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d$/;

/**
 * Parse a row-per-line-item AWS export — a Cost & Usage Report (CUR) or a long-format Cost
 * Explorer export — by aggregating cost per UsageType. This is the detailed format AWS most
 * readily provides (and the one the app asks customers for), so a hard-fail here was a real gap.
 * Reuses the pivoted parser's SKU classification. Throws if the file is not actually long-format
 * (no resolvable usage-type/cost columns) so the caller can fall through to other strategies.
 */
export function parseAwsLongCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader,
  });
  const fields = parsed.meta.fields ?? [];

  const usageTypeCol = resolveColumn(fields, USAGE_TYPE_ALIASES);
  const costCol = resolveColumn(fields, COST_ALIASES);
  if (!usageTypeCol || !costCol) {
    throw new Error('Not an AWS long-format/CUR export (missing usage-type or cost column).');
  }
  const productCol = resolveColumn(fields, PRODUCT_ALIASES);
  const regionCol = resolveColumn(fields, REGION_ALIASES);

  // Aggregate cost by usage type across all line-item rows.
  const byUsageType = new Map<string, { cost: number; region: string }>();
  for (const row of parsed.data) {
    const usageType = (row[usageTypeCol] ?? '').trim();
    if (!usageType) continue;
    // Skip pivoted/aggregate artifacts so a pivoted file accidentally routed here yields nothing.
    if (usageType.toLowerCase() === 'usage type total' || /^\d{4}-\d{2}-\d{2}$/.test(usageType)) continue;
    // When a product column exists, keep only S3/Glacier storage rows (a full CUR has every service).
    if (productCol && !S3_PRODUCT.test(row[productCol] ?? '')) continue;

    const cost = parseLocaleNumber(row[costCol] ?? '0');
    const region = regionCol ? (row[regionCol] ?? '').trim() : '';
    const existing = byUsageType.get(usageType) || { cost: 0, region };
    existing.cost += cost;
    if (!existing.region && region) existing.region = region;
    byUsageType.set(usageType, existing);
  }

  const lineItems: ParsedLineItem[] = [];
  for (const [usageType, { cost, region: rowRegion }] of byUsageType) {
    if (cost === 0) continue;
    const { category, subcategory, storageClass } = classifySku(usageType);
    // Prefer an explicit, well-formed region column; otherwise fall back to the SKU's region prefix
    // (CUR rows for global usage types often carry a blank/AZ-only region).
    const region = AWS_REGION_PATTERN.test(rowRegion) ? rowRegion : extractRegion(usageType);

    let usageQuantity: number | undefined;
    if (category === 'storage' && storageClass) {
      const gb = estimateGbFromCost(cost, storageClass, region);
      if (gb !== undefined) usageQuantity = Math.round(gb * 100) / 100;
    }

    lineItems.push({
      id: uuid(),
      provider: 'aws',
      service: 'Amazon Simple Storage Service',
      region,
      sku: usageType,
      description: usageType,
      category,
      subcategory,
      storageClass,
      usageQuantity,
      usageUnit: usageQuantity !== undefined ? 'GB-Mo' : undefined,
      costUsd: Math.round(cost * 100) / 100,
      isEstimate: usageQuantity !== undefined,
      isEdited: false,
    });
  }

  const grandTotal = lineItems.reduce((s, i) => s + i.costUsd, 0);
  const warnings: string[] = [];
  const addressableTotal = sumAddressableCost(lineItems);
  const outcome = classifyParseOutcome(byUsageType.size > 0, addressableTotal);
  if (outcome === 'empty') warnings.push(unsupportedLayoutWarning('AWS CUR / Cost Explorer export'));
  else if (outcome === 'no-addressable') warnings.push(NO_STORAGE_SCOPE_WARNING);

  return {
    provider: 'aws',
    billType: 'sku-export',
    detectionSignals: [],
    parsedBill: {
      lineItems,
      grandTotal: Math.round(grandTotal * 100) / 100,
      parseConfidence: computeParseConfidence({ baseline: 0.85, outcome, hasBlockingWarning: false }),
      warnings,
    },
  };
}
