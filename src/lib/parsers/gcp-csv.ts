import Papa from 'papaparse';
import { v4 as uuid } from 'uuid';
import type { ParsedLineItem, Category } from '@/types/analysis';
import type { ParseResult } from './types';
import { parseLocaleNumber, normalizeUnit } from './normalize';
import { transformHeader, resolveColumn } from './csv-utils';
import { GCP_LOCATION_TYPES } from '../categories/types';
import {
  computeParseConfidence,
  classifyParseOutcome,
  sumAddressableCost,
  unsupportedLayoutWarning,
  NO_STORAGE_SCOPE_WARNING,
} from './confidence';

function classifySku(skuDesc: string): {
  category: Category;
  subcategory?: string;
  storageClass?: string;
} {
  const lower = skuDesc.toLowerCase();
  const coldStorageClass = getColdStorageClass(lower);

  // Storage
  if (lower.includes('storage') && !lower.includes('transfer') && !lower.includes('operation')) {
    let storageClass = 'Standard';
    if (lower.includes('archive')) storageClass = 'Archive';
    else if (lower.includes('coldline')) storageClass = 'Coldline';
    else if (lower.includes('nearline')) storageClass = 'Nearline';
    return { category: 'storage', storageClass };
  }

  // Operations
  if (lower.includes('class a operation')) {
    let storageClass = 'Standard';
    if (lower.includes('archive')) storageClass = 'Archive';
    else if (lower.includes('coldline')) storageClass = 'Coldline';
    else if (lower.includes('nearline')) storageClass = 'Nearline';
    return { category: 'operations', subcategory: 'Class A', storageClass };
  }
  if (lower.includes('class b operation')) {
    let storageClass = 'Standard';
    if (lower.includes('archive')) storageClass = 'Archive';
    else if (lower.includes('coldline')) storageClass = 'Coldline';
    else if (lower.includes('nearline')) storageClass = 'Nearline';
    return { category: 'operations', subcategory: 'Class B', storageClass };
  }

  // Retrieval
  if (lower.includes('early delete') || lower.includes('early deletion') || lower.includes('minimum storage duration')) {
    return { category: 'retrieval', subcategory: 'Early Deletion', storageClass: coldStorageClass };
  }

  if (lower.includes('data retrieval') || lower.includes('retrieval')) {
    return { category: 'retrieval', storageClass: coldStorageClass };
  }

  // Egress - internet downloads
  if (lower.includes('download')) {
    let subcategory = 'Internet Egress';
    if (lower.includes('apac')) subcategory = 'Internet Egress (APAC)';
    else if (lower.includes('china')) subcategory = 'Internet Egress (China)';
    else if (lower.includes('australia')) subcategory = 'Internet Egress (Australia)';
    else subcategory = 'Internet Egress (Worldwide)';
    return { category: 'egress', subcategory };
  }

  // Egress - replication
  if (lower.includes('replication')) {
    return { category: 'egress', subcategory: 'Multi-region Replication' };
  }

  // Egress - inter-region
  if (lower.includes('inter region') || lower.includes('inter-region')) {
    return { category: 'egress', subcategory: 'Inter-region Transfer' };
  }

  // Egress - multi-region within
  if (lower.includes('multi-region within') || lower.includes('multi region within')) {
    return { category: 'egress', subcategory: 'Multi-region Transfer' };
  }

  // Network transfer - other
  if (lower.includes('network') || lower.includes('transfer') || lower.includes('peered') || lower.includes('interconnect')) {
    return { category: 'egress', subcategory: 'Other Network Transfer' };
  }

  return { category: 'out-of-scope' };
}

function getColdStorageClass(lowerSkuDesc: string): string | undefined {
  if (lowerSkuDesc.includes('archive')) return 'Archive';
  if (lowerSkuDesc.includes('coldline')) return 'Coldline';
  if (lowerSkuDesc.includes('nearline')) return 'Nearline';
  return undefined;
}

function extractRegion(skuDesc: string): string {
  for (const [locationKey] of Object.entries(GCP_LOCATION_TYPES)) {
    if (skuDesc.includes(locationKey)) return locationKey;
  }

  // Try to extract from the pattern like "Regional Standard" or "Multi-Region Standard"
  if (skuDesc.toLowerCase().includes('multi-region') || skuDesc.toLowerCase().includes('multi region')) {
    return 'US Multi-region';
  }
  if (skuDesc.toLowerCase().includes('regional')) {
    return 'US Regional';
  }

  return 'Unknown';
}

export function parseGcpCsv(content: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader,
  });
  const fields = parsed.meta.fields ?? [];

  // Resolve the columns we read once, tolerating renamed/re-cased/whitespaced/BOM'd headers.
  const cols = {
    serviceDesc: resolveColumn(fields, ['Service description', 'Service']),
    skuDesc: resolveColumn(fields, ['SKU description', 'SKU desc']),
    skuId: resolveColumn(fields, ['SKU ID']),
    usageAmount: resolveColumn(fields, ['Usage amount', 'Usage']),
    usageUnit: resolveColumn(fields, ['Usage unit', 'Unit']),
    cost: resolveColumn(fields, ['Cost ($)', 'Cost']),
    subtotal: resolveColumn(fields, ['Subtotal ($)', 'Subtotal']),
    savings: resolveColumn(fields, ['Savings programs ($)', 'Savings programs']),
    unrounded: resolveColumn(fields, ['Unrounded subtotal ($)', 'Unrounded subtotal']),
  };
  const cell = (row: Record<string, string>, col: string | undefined): string =>
    (col ? row[col] : undefined) ?? '';

  const lineItems: ParsedLineItem[] = [];
  let grandTotal = 0;
  let totalSavingsPrograms = 0;
  const warnings: string[] = [];
  const commercialSignals: string[] = [];
  let hasBlockingWarning = false;

  for (const row of parsed.data) {
    const skuDesc = cell(row, cols.skuDesc);
    const unrounded = cell(row, cols.unrounded);
    // Skip subtotal/filtered total rows
    if (!skuDesc && !cell(row, cols.serviceDesc)) continue;
    if (unrounded === 'Subtotal' || unrounded === 'Filtered total') continue;
    if (!skuDesc) continue;

    const costUsd = parseLocaleNumber(cell(row, cols.subtotal) || cell(row, cols.cost) || '0');
    const usageAmount = parseLocaleNumber(cell(row, cols.usageAmount) || '0');
    const usageUnit = cell(row, cols.usageUnit);
    const savingsProgram = parseLocaleNumber(cell(row, cols.savings) || '0');

    const { unit: normalizedUnit, multiplier } = normalizeUnit(usageUnit);
    const normalizedUsage = usageAmount * multiplier;

    const { category, subcategory, storageClass } = classifySku(skuDesc);
    const region = extractRegion(skuDesc);

    lineItems.push({
      id: uuid(),
      provider: 'gcp',
      service: cell(row, cols.serviceDesc) || 'Cloud Storage',
      region,
      sku: cell(row, cols.skuId),
      description: skuDesc,
      category,
      subcategory,
      storageClass,
      unitRate: normalizedUsage > 0 ? costUsd / normalizedUsage : undefined,
      usageQuantity: normalizedUsage || undefined,
      usageUnit: normalizedUnit,
      costUsd,
      isEstimate: false,
      isEdited: false,
    });

    grandTotal += costUsd;
    totalSavingsPrograms += savingsProgram;
  }

  // Only assert "paying list price" when the savings column actually exists. A human-trimmed
  // export that omits the column reads as all-zeros and would otherwise produce a false claim.
  if (cols.savings && totalSavingsPrograms === 0 && lineItems.length > 0) {
    commercialSignals.push('All Savings programs values are $0 — customer appears to be paying list price.');
  }

  // Validate total
  const lastRows = parsed.data.filter(
    (r) => cell(r, cols.unrounded) === 'Filtered total' || cell(r, cols.unrounded) === 'Subtotal'
  );
  if (lastRows.length > 0) {
    const reportedTotal = parseLocaleNumber(cell(lastRows[0], cols.subtotal) || '0');
    const diff = Math.abs(grandTotal - reportedTotal);
    if (diff > reportedTotal * 0.02) {
      warnings.push(
        `Parsed total ($${grandTotal.toFixed(2)}) differs from reported total ($${reportedTotal.toFixed(2)}) by more than 2%.`
      );
      hasBlockingWarning = true;
    }
  }

  // Distinguish a genuinely unreadable export (no rows) from a correctly parsed bill that
  // simply has no storage-scope spend; only the former is an extraction failure.
  const addressableTotal = sumAddressableCost(lineItems);
  const outcome = classifyParseOutcome(lineItems.length > 0, addressableTotal);
  if (outcome === 'empty') {
    warnings.push(unsupportedLayoutWarning('GCP billing export'));
  } else if (outcome === 'no-addressable') {
    warnings.push(NO_STORAGE_SCOPE_WARNING);
  }

  return {
    provider: 'gcp',
    billType: 'sku-export',
    detectionSignals: [],
    parsedBill: {
      lineItems,
      grandTotal: Math.round(grandTotal * 100) / 100,
      parseConfidence: computeParseConfidence({ baseline: 0.95, outcome, hasBlockingWarning }),
      warnings,
      commercialSignals: commercialSignals.length > 0 ? commercialSignals : undefined,
    },
  };
}
