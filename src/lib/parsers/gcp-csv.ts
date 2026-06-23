import Papa from 'papaparse';
import { v4 as uuid } from 'uuid';
import type { ParsedLineItem, Category } from '@/types/analysis';
import type { ParseResult } from './types';
import { parseFormattedNumber, normalizeUnit } from './normalize';
import { GCP_LOCATION_TYPES } from '../categories/types';

interface GcpCsvRow {
  'Service description': string;
  'Service ID': string;
  'SKU description': string;
  'SKU ID': string;
  'Usage amount': string;
  'Usage unit': string;
  'Cost ($)': string;
  'Savings programs ($)': string;
  'Other savings ($)': string;
  'Unrounded subtotal ($)': string;
  'Subtotal ($)': string;
}

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
  const parsed = Papa.parse<GcpCsvRow>(content, {
    header: true,
    skipEmptyLines: true,
  });

  const lineItems: ParsedLineItem[] = [];
  let grandTotal = 0;
  let totalSavingsPrograms = 0;
  const warnings: string[] = [];
  const commercialSignals: string[] = [];

  for (const row of parsed.data) {
    // Skip subtotal/filtered total rows
    if (!row['SKU description'] && !row['Service description']) continue;
    if (row['Unrounded subtotal ($)'] === 'Subtotal' || row['Unrounded subtotal ($)'] === 'Filtered total') continue;
    if (!row['SKU description']) continue;

    const costUsd = parseFormattedNumber(row['Subtotal ($)'] || row['Cost ($)'] || '0');
    const usageAmount = parseFormattedNumber(row['Usage amount'] || '0');
    const usageUnit = row['Usage unit'] || '';
    const savingsProgram = parseFormattedNumber(row['Savings programs ($)'] || '0');

    const { unit: normalizedUnit, multiplier } = normalizeUnit(usageUnit);
    const normalizedUsage = usageAmount * multiplier;

    const { category, subcategory, storageClass } = classifySku(row['SKU description']);
    const region = extractRegion(row['SKU description']);

    lineItems.push({
      id: uuid(),
      provider: 'gcp',
      service: row['Service description'] || 'Cloud Storage',
      region,
      sku: row['SKU ID'] || '',
      description: row['SKU description'],
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

  if (totalSavingsPrograms === 0 && lineItems.length > 0) {
    commercialSignals.push('All Savings programs values are $0 — customer appears to be paying list price.');
  }

  // Validate total
  const lastRows = parsed.data.filter(
    (r) => r['Unrounded subtotal ($)'] === 'Filtered total' || r['Unrounded subtotal ($)'] === 'Subtotal'
  );
  if (lastRows.length > 0) {
    const reportedTotal = parseFormattedNumber(lastRows[0]['Subtotal ($)'] || '0');
    const diff = Math.abs(grandTotal - reportedTotal);
    if (diff > reportedTotal * 0.02) {
      warnings.push(
        `Parsed total ($${grandTotal.toFixed(2)}) differs from reported total ($${reportedTotal.toFixed(2)}) by more than 2%.`
      );
    }
  }

  return {
    provider: 'gcp',
    billType: 'sku-export',
    detectionSignals: [],
    parsedBill: {
      lineItems,
      grandTotal: Math.round(grandTotal * 100) / 100,
      parseConfidence: warnings.length === 0 ? 0.95 : 0.8,
      warnings,
      commercialSignals: commercialSignals.length > 0 ? commercialSignals : undefined,
    },
  };
}
