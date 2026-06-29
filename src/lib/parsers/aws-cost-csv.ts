import { v4 as uuid } from 'uuid';
import Papa from 'papaparse';
import type { ParsedLineItem, Category } from '@/types/analysis';
import type { ParseResult } from './types';
import { AWS_REGION_CODES, AWS_SKU_STORAGE_CLASS } from '../categories/types';
import { getListRate } from '../pricing/lookup';
import { parseLocaleNumber } from './normalize';
import { transformHeader, resolveColumn } from './csv-utils';
import { classifyS3Suffix } from './aws-s3-classify';
import {
  computeParseConfidence,
  classifyParseOutcome,
  sumAddressableCost,
  unsupportedLayoutWarning,
  NO_STORAGE_SCOPE_WARNING,
} from './confidence';

export function classifySku(sku: string): {
  category: Category;
  subcategory?: string;
  storageClass?: string;
} {
  const suffix = sku.replace(/^[A-Z]{2,4}\d?-/, '');

  if (suffix in AWS_SKU_STORAGE_CLASS) {
    return { category: 'storage', storageClass: AWS_SKU_STORAGE_CLASS[suffix] };
  }

  if (suffix.startsWith('TimedStorage')) {
    return { category: 'storage' };
  }

  if (suffix === 'DataTransfer-Out-Bytes') {
    return { category: 'egress', subcategory: 'Internet Egress' };
  }

  if (suffix === 'CloudFront-Out-Bytes') {
    return { category: 'storage-adjacent', subcategory: 'CloudFront Transfer' };
  }

  if (suffix === 'DataTransfer-In-Bytes') {
    return { category: 'out-of-scope', subcategory: 'Data Transfer In' };
  }

  if (suffix.match(/[A-Z]{2,4}\d?-AWS-Out-Bytes$/)) {
    return { category: 'egress', subcategory: 'Inter-region Transfer' };
  }

  if (suffix.match(/[A-Z]{2,4}\d?-AWS-In-Bytes$/)) {
    return { category: 'out-of-scope', subcategory: 'Inter-region In' };
  }

  if (suffix.match(/S3RTC-Out-Bytes$/)) {
    return { category: 'egress', subcategory: 'S3 Replication' };
  }

  const shared = classifyS3Suffix(suffix);
  if (shared) return shared;

  if (suffix.startsWith('Requests-Tier4')) {
    return { category: 'operations', subcategory: 'Lifecycle Transitions' };
  }

  if (suffix.includes('EarlyDelete')) {
    const storageClass = suffix.includes('ZIA') ? 'One Zone-IA' :
      suffix.includes('SIA') ? 'Standard-IA' :
        suffix.includes('GDA') ? 'Glacier Deep Archive' :
          suffix.includes('GIR') ? 'Glacier Instant Retrieval' : undefined;
    return { category: 'retrieval', subcategory: 'Early Deletion', storageClass };
  }

  if (suffix.includes('Restore') || suffix.includes('Transition')) {
    return { category: 'operations', subcategory: 'Lifecycle/Copy' };
  }

  if (suffix.startsWith('Requests-')) {
    return { category: 'operations', subcategory: 'Other Requests' };
  }

  if (suffix.startsWith('Monitoring-Automation')) {
    return { category: 'operations', subcategory: 'Monitoring/Analytics' };
  }

  if (suffix.startsWith('Inventory-')) {
    return { category: 'operations', subcategory: 'S3 Inventory' };
  }

  if (suffix.startsWith('TagStorage-')) {
    return { category: 'operations', subcategory: 'Tag Storage' };
  }

  if (suffix.startsWith('Metadata-')) {
    return { category: 'operations', subcategory: 'Metadata' };
  }

  if (suffix.includes('Bucket-Hrs-FreeTier')) {
    return { category: 'out-of-scope', subcategory: 'Free Tier' };
  }

  return { category: 'operations', subcategory: 'Other S3' };
}

export function estimateGbFromCost(costUsd: number, storageClass: string, region: string): number | undefined {
  const rate = getListRate('aws', storageClass, region);
  if (!rate || rate <= 0) return undefined;
  return costUsd / rate;
}

export function extractRegion(sku: string): string {
  const match = sku.match(/^([A-Z]{2,4}\d?)-/);
  if (!match) {
    if (sku.startsWith('Global-') || sku.startsWith('DataTransfer-')) return 'global';
    return 'unknown';
  }
  const code = match[1];
  if (code === 'EU') return AWS_REGION_CODES['EUW1'] || 'eu-west-1';
  return AWS_REGION_CODES[code] || code.toLowerCase();
}

// Trailing currency/unit marker on a cost column header, e.g. "($)", " ($)", "(USD)", "(€)".
const CURRENCY_SUFFIX = /\s*\((?:\$|usd|eur|gbp|€|£)?\)\s*$/i;

export function parseAwsCostCsv(text: string): ParseResult {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader });
  const rows = parsed.data as Record<string, string>[];

  if (rows.length === 0) {
    throw new Error('CSV has no data rows');
  }

  const headers = parsed.meta.fields || [];
  // Resolve the row-label and total columns up front, tolerating header variants.
  const usageTypeCol = resolveColumn(headers, ['Usage type', 'UsageType']);
  const totalCol = resolveColumn(headers, [
    'Total costs($)', 'Total costs ($)', 'Total cost($)', 'Total cost ($)', 'Total costs', 'Total cost',
  ]);
  // SKU columns = every currency-suffixed cost column except the resolved usage/total columns.
  const skuColumns = headers.filter(
    (h) => CURRENCY_SUFFIX.test(h) && h !== usageTypeCol && h !== totalCol,
  );

  const usageLabel = (r: Record<string, string>): string => (usageTypeCol ? r[usageTypeCol] : undefined) ?? '';
  const totalsRow = rows.find((r) => usageLabel(r) === 'Usage type total');
  if (!totalsRow) {
    throw new Error('Could not find "Usage type total" row in CSV');
  }

  const grandTotal = parseLocaleNumber((totalCol ? totalsRow[totalCol] : undefined) || '0');

  // Sort by the ISO date label (lexical == chronological) so "latest" is the most recent month
  // regardless of row order — some exports list newest-first.
  const monthRows = rows
    .filter((r) => usageLabel(r) && usageLabel(r) !== 'Usage type total' && /^\d{4}-\d{2}-\d{2}$/.test(usageLabel(r)))
    .sort((a, b) => usageLabel(a).localeCompare(usageLabel(b)));

  const latestMonth = monthRows.length > 0 ? monthRows[monthRows.length - 1] : totalsRow;

  let billingPeriod = '';
  if (monthRows.length > 0) {
    const first = usageLabel(monthRows[0]);
    const last = usageLabel(monthRows[monthRows.length - 1]);
    billingPeriod = `${first} to ${last}`;
  }

  const lineItems: ParsedLineItem[] = [];
  const warnings: string[] = [];

  for (const col of skuColumns) {
    const skuName = col.replace(CURRENCY_SUFFIX, '');
    const totalCost = parseLocaleNumber(totalsRow[col] || '0');
    if (totalCost === 0) continue;

    const monthlyCost = monthRows.length > 0
      ? parseLocaleNumber(latestMonth[col] || '0')
      : totalCost;

    if (monthlyCost === 0 && totalCost < 0.01) continue;

    const { category, subcategory, storageClass } = classifySku(skuName);
    const region = extractRegion(skuName);

    let usageQuantity: number | undefined;
    if (category === 'storage' && storageClass) {
      usageQuantity = estimateGbFromCost(monthlyCost, storageClass, region);
      if (usageQuantity !== undefined) {
        usageQuantity = Math.round(usageQuantity * 100) / 100;
      }
    }

    lineItems.push({
      id: uuid(),
      provider: 'aws',
      service: 'Amazon Simple Storage Service',
      region,
      sku: skuName,
      description: skuName,
      category,
      subcategory,
      storageClass,
      usageQuantity,
      usageUnit: usageQuantity !== undefined ? 'GB-Mo' : undefined,
      costUsd: Math.round(monthlyCost * 100) / 100,
      isEstimate: usageQuantity !== undefined,
      isEdited: false,
    });
  }

  const parsedMonthlyTotal = lineItems.reduce((s, i) => s + i.costUsd, 0);
  let hasBlockingWarning = false;

  // Advisory only — selecting the latest month is expected behavior, not a parse problem.
  if (monthRows.length > 1) {
    warnings.push(
      `CSV contains ${monthRows.length} months of data ($${grandTotal.toFixed(2)} total). ` +
      `Using latest month for analysis ($${parsedMonthlyTotal.toFixed(2)}).`,
    );
  }

  // Reconcile the summed SKU columns against the selected period's own "Total costs" cell — this
  // is the backstop that catches a column-detection miss or a number-parse error (e.g. an
  // unhandled value format) that would otherwise report full confidence with a silently wrong total.
  const reportedSelectedTotal = monthRows.length > 0
    ? parseLocaleNumber((totalCol ? latestMonth[totalCol] : undefined) || '0')
    : grandTotal;
  if (reportedSelectedTotal > 0 && Math.abs(parsedMonthlyTotal - reportedSelectedTotal) > reportedSelectedTotal * 0.02) {
    warnings.push(
      `Parsed SKU total ($${parsedMonthlyTotal.toFixed(2)}) differs from the reported period total ` +
      `($${reportedSelectedTotal.toFixed(2)}) by more than 2%; some columns may not have parsed.`,
    );
    hasBlockingWarning = true;
  }

  // Recognized structure = at least one SKU cost column. Columns present but all zero (or all
  // non-storage) is a parsed-but-non-storage bill, not an extraction failure.
  const addressableTotal = sumAddressableCost(lineItems);
  const outcome = classifyParseOutcome(skuColumns.length > 0, addressableTotal);
  if (outcome === 'empty') {
    warnings.push(unsupportedLayoutWarning('AWS cost export'));
  } else if (outcome === 'no-addressable') {
    warnings.push(NO_STORAGE_SCOPE_WARNING);
  }

  return {
    provider: 'aws',
    billType: 'sku-export',
    billingPeriod,
    accountId: undefined,
    detectionSignals: [],
    parsedBill: {
      lineItems,
      grandTotal: Math.round(parsedMonthlyTotal * 100) / 100,
      parseConfidence: computeParseConfidence({ baseline: 0.85, outcome, hasBlockingWarning }),
      warnings,
    },
  };
}
