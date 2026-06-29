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

/**
 * Classify a GCP Cloud Storage SKU from its free-text description (GCP exports have no structured
 * usage-type code like AWS). Order matters: storage is matched before operations/retrieval, and
 * "worldwide" egress is checked before regional substrings to avoid mislabeling (see below).
 */
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

  // Egress - internet downloads. Check "worldwide" first: GCP's "Download Worldwide Destinations
  // (excluding Asia & Australia)" SKU otherwise matches the bare "australia"/"asia" substring and
  // gets mislabeled as a regional download.
  if (lower.includes('download')) {
    let subcategory: string;
    if (lower.includes('worldwide')) subcategory = 'Internet Egress (Worldwide)';
    else if (lower.includes('apac')) subcategory = 'Internet Egress (APAC)';
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

// Infer the cold storage class for retrieval/early-delete SKUs, which name the class they apply to.
// Left undefined for Standard, which has no retrieval/early-delete charges.
function getColdStorageClass(lowerSkuDesc: string): string | undefined {
  if (lowerSkuDesc.includes('archive')) return 'Archive';
  if (lowerSkuDesc.includes('coldline')) return 'Coldline';
  if (lowerSkuDesc.includes('nearline')) return 'Nearline';
  return undefined;
}

// Derive the storage location from the SKU description. A multi/dual-region result matters
// downstream: matching that durability on B2 needs a second-region copy (~2x storage), so the cost
// model must not treat it as a single-region migration.
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

/**
 * Parse a GCP billing/cost-table CSV (one row per SKU). Prefers the per-row "Subtotal" over "Cost"
 * as the charged amount, reconciles against the export's own trailer total, and flags list-price
 * spend when a present Savings-programs column is all zeros. Usage is normalized to the app's
 * GB-month basis (GCP storage rates are quoted per GiB-month) via normalizeUnit.
 */
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
  // The trailing "Subtotal"/"Filtered total" label can land in different columns depending on how
  // many optional columns the export includes, so detect it by value in ANY cell rather than by a
  // fixed column — otherwise the reconciliation below silently never runs.
  const isTrailerRow = (row: Record<string, string>): boolean =>
    Object.values(row).some((v) => v === 'Subtotal' || v === 'Filtered total' || v === 'Total');

  const lineItems: ParsedLineItem[] = [];
  let grandTotal = 0;
  let totalSavingsPrograms = 0;
  const warnings: string[] = [];
  const commercialSignals: string[] = [];
  let hasBlockingWarning = false;

  for (const row of parsed.data) {
    const skuDesc = cell(row, cols.skuDesc);
    // Skip subtotal/filtered total rows
    if (!skuDesc && !cell(row, cols.serviceDesc)) continue;
    if (isTrailerRow(row)) continue;
    if (!skuDesc) continue;

    // Subtotal is the post-rounding charged amount and the figure the trailer total sums to; fall
    // back to the raw "Cost" column only when the export omits Subtotal.
    const costUsd = parseLocaleNumber(cell(row, cols.subtotal) || cell(row, cols.cost) || '0');
    const usageAmount = parseLocaleNumber(cell(row, cols.usageAmount) || '0');
    const usageUnit = cell(row, cols.usageUnit);
    const savingsProgram = parseLocaleNumber(cell(row, cols.savings) || '0');

    // Convert GCP's reported unit (e.g. gibibyte-month) to the app's GB-month basis; multiplier
    // carries the GiB→GB factor so unitRate below comes out as $/GB-month, comparable to B2.
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

  // Validate parsed total against the export's own reported subtotal/filtered-total trailer.
  const lastRows = parsed.data.filter(isTrailerRow);
  if (lastRows.length > 0) {
    const reportedTotal = parseLocaleNumber(
      cell(lastRows[0], cols.subtotal) || cell(lastRows[0], cols.unrounded) || '0',
    );
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
