#!/usr/bin/env npx tsx
/**
 * Refreshes list pricing for all supported cloud providers from their public APIs.
 *
 * Usage:
 *   npx tsx scripts/refresh-pricing.ts          # refresh all providers
 *   npx tsx scripts/refresh-pricing.ts aws      # refresh AWS only
 *   npx tsx scripts/refresh-pricing.ts gcp      # refresh GCP only
 *   npx tsx scripts/refresh-pricing.ts azure    # refresh Azure only
 *   npx tsx scripts/refresh-pricing.ts r2       # refresh R2 only
 *
 * Data sources:
 *   AWS:   pricing.us-east-1.amazonaws.com (Bulk Pricing API, no auth)
 *   Azure: prices.azure.com/api/retail/prices (Retail Prices API, no auth)
 *   GCP:   cloudbilling.googleapis.com/v1 (Cloud Billing Catalog API, requires API key)
 *   R2:    no stable public pricing API configured; verify manually
 *   B2:    no stable public pricing API configured; verify manually
 */

import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const PRICING_DIR = join(__dirname, '..', 'src', 'lib', 'pricing');
const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

async function fetchAzureItems<T>(url: string): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const page = await fetchJson(nextUrl) as {
      Items?: T[];
      NextPageLink?: string;
    };
    items.push(...(page.Items || []));
    nextUrl = page.NextPageLink;
  }

  return items;
}

function usdFromGcpUnitPrice(unitPrice: { units?: string | number; nanos?: number } | undefined): number {
  if (!unitPrice) return 0;
  return Number(unitPrice.units || 0) + (unitPrice.nanos || 0) / 1e9;
}

function buildUrl(base: string, params: Record<string, string>): string {
  const urlParams = new URLSearchParams(params);
  return `${base}?${urlParams.toString()}`;
}

function writePricingFile(filename: string, data: unknown) {
  const path = join(PRICING_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ✓ Wrote ${path}`);
}

function readPricingFile(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(PRICING_DIR, filename), 'utf-8'));
}

function refreshSuccess(provider: string, message: string) {
  return {
    provider,
    status: 'success',
    lastAttempt: today,
    lastSuccess: today,
    message,
  };
}

function refreshWarning(
  provider: string,
  status: 'skipped' | 'error',
  message: string,
  credentialEnvVar?: string,
) {
  return {
    provider,
    status,
    lastAttempt: today,
    credentialEnvVar,
    message,
  };
}

// ---------------------------------------------------------------------------
// AWS
// ---------------------------------------------------------------------------

const AWS_S3_REGION_INDEX_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/region_index.json';
const AWS_GDA_REGION_INDEX_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3GlacierDeepArchive/current/region_index.json';

const AWS_STORAGE_CLASS_MAP: Record<string, string> = {
  'Standard': 'Standard',
  'Standard - Infrequent Access': 'Standard-IA',
  'One Zone - Infrequent Access': 'One Zone-IA',
  'Intelligent-Tiering Frequent Access': 'Intelligent-Tiering-FA',
  'Intelligent-Tiering Infrequent Access': 'Intelligent-Tiering-IA',
  'Intelligent-Tiering Archive Instant Access': 'Intelligent-Tiering-AIA',
  'IntelligentTieringArchiveAccess': 'Intelligent-Tiering-AA',
  'IntelligentTieringDeepArchiveAccess': 'Intelligent-Tiering-DAA',
  'Glacier Instant Retrieval': 'Glacier Instant Retrieval',
  'Amazon Glacier': 'Glacier Flexible Retrieval',
  'Express One Zone': 'Express One Zone',
  'Reduced Redundancy': 'Reduced Redundancy',
};

const AWS_CLASS_ORDER = [
  'Standard', 'Standard-IA', 'One Zone-IA',
  'Intelligent-Tiering-FA', 'Intelligent-Tiering-IA', 'Intelligent-Tiering-AIA',
  'Intelligent-Tiering-AA', 'Intelligent-Tiering-DAA',
  'Glacier Instant Retrieval', 'Glacier Flexible Retrieval', 'Glacier Deep Archive',
  'Express One Zone', 'Reduced Redundancy',
];

// Skip local zones, GovCloud, and aws-other
const AWS_SKIP_REGIONS = new Set(['aws-other']);
function isAwsStandardRegion(code: string): boolean {
  if (AWS_SKIP_REGIONS.has(code)) return false;
  if (code.includes('-han-') || code.includes('-ist-')) return false; // local zones
  if (code.startsWith('us-gov')) return false;
  return true;
}

async function refreshAws() {
  console.log('AWS: Fetching region index...');
  const index = await fetchJson(AWS_S3_REGION_INDEX_URL) as {
    publicationDate: string;
    regions: Record<string, { regionCode: string; currentVersionUrl: string }>;
  };
  const gdaIndex = await fetchJson(AWS_GDA_REGION_INDEX_URL) as {
    publicationDate: string;
    regions: Record<string, { regionCode: string; currentVersionUrl: string }>;
  };

  const version = [index.publicationDate, gdaIndex.publicationDate]
    .map(d => d.slice(0, 10))
    .sort()
    .at(0);
  const regions = Object.keys(index.regions).filter(isAwsStandardRegion).sort();
  console.log(`AWS: Found ${regions.length} regions (published ${version})`);

  const storage: Record<string, Record<string, unknown>> = {};

  for (const regionCode of regions) {
    const url = `https://pricing.us-east-1.amazonaws.com${index.regions[regionCode].currentVersionUrl}`;
    process.stdout.write(`  ${regionCode}...`);

    const data = await fetchJson(url) as {
      products: Record<string, { attributes: Record<string, string> }>;
      terms: { OnDemand: Record<string, Record<string, { priceDimensions: Record<string, { pricePerUnit: { USD: string }; beginRange: string; endRange: string }> }>> };
    };

    const skus: Record<string, string> = {};
    for (const [sku, prod] of Object.entries(data.products)) {
      const usage = prod.attributes.usagetype || '';
      if (!usage.includes('TimedStorage') || !usage.includes('ByteHrs')) continue;
      if (['Tables-', 'Files-', 'Vectors-', 'Annotation-'].some(x => usage.includes(x))) continue;
      const vol = prod.attributes.volumeType || '';
      const mapped = AWS_STORAGE_CLASS_MAP[vol];
      if (mapped) skus[sku] = mapped;
    }

    const prices: Record<string, Array<{ begin: number; end: number | null; price: number }>> = {};
    for (const [sku, className] of Object.entries(skus)) {
      const offers = data.terms.OnDemand[sku];
      if (!offers) continue;
      for (const offer of Object.values(offers)) {
        for (const dim of Object.values(offer.priceDimensions)) {
          const price = parseFloat(dim.pricePerUnit.USD);
          if (price === 0) continue;
          const begin = parseInt(dim.beginRange) || 0;
          const end = dim.endRange === 'Inf' ? null : parseInt(dim.endRange);
          if (!prices[className]) prices[className] = [];
          prices[className].push({ begin, end, price });
        }
      }
    }

    const regionData: Record<string, unknown> = {};
    for (const cls of AWS_CLASS_ORDER) {
      const tiers = prices[cls];
      if (!tiers) continue;
      tiers.sort((a, b) => a.begin - b.begin);
      if (tiers.length === 1) {
        regionData[cls] = tiers[0].price;
      } else {
        regionData[cls] = tiers.map(t => ({
          maxGb: t.end,
          perGb: t.price,
        }));
      }
    }

    const gdaRegion = gdaIndex.regions[regionCode];
    if (gdaRegion) {
      const gdaUrl = `https://pricing.us-east-1.amazonaws.com${gdaRegion.currentVersionUrl}`;
      const gdaData = await fetchJson(gdaUrl) as {
        products: Record<string, { attributes: Record<string, string> }>;
        terms: { OnDemand: Record<string, Record<string, { priceDimensions: Record<string, { pricePerUnit: { USD: string } }> }>> };
      };

      for (const [sku, prod] of Object.entries(gdaData.products)) {
        if (!prod.attributes.usagetype?.endsWith('-TimedStorage-GDA-ByteHrs')) {
          continue;
        }
        const offers = gdaData.terms.OnDemand[sku];
        if (!offers) continue;
        const prices = Object.values(offers)
          .flatMap(offer => Object.values(offer.priceDimensions))
          .map(dim => parseFloat(dim.pricePerUnit.USD))
          .filter(price => price > 0);
        if (prices.length > 0) {
          regionData['Glacier Deep Archive'] = prices[0];
          break;
        }
      }
    }

    storage[regionCode] = regionData;
    console.log(` ${Object.keys(regionData).length} classes`);
  }

  const existing = readPricingFile('aws.json');
  const doc = {
    lastVerified: today,
    source: 'AWS Pricing API (pricing.us-east-1.amazonaws.com)',
    provider: 'aws',
    refresh: refreshSuccess('aws', 'Storage pricing refreshed from AWS Bulk Pricing APIs.'),
    storage,
    requests: existing.requests,
    retrieval: existing.retrieval,
    dataTransferOut: existing.dataTransferOut,
    interRegion: existing.interRegion,
    monitoringFee: existing.monitoringFee,
    minStorageDays: existing.minStorageDays,
  };

  writePricingFile('aws.json', doc);
  console.log(`AWS: Done — ${Object.keys(storage).length} regions\n`);
}

// ---------------------------------------------------------------------------
// Azure
// ---------------------------------------------------------------------------

const AZURE_API = 'https://prices.azure.com/api/retail/prices';

const AZURE_SKU_MAP: Record<string, string> = {
  'Hot LRS': 'Hot-LRS', 'Hot ZRS': 'Hot-ZRS', 'Hot GRS': 'Hot-GRS', 'Hot RA-GRS': 'Hot-RA-GRS',
  'Cool LRS': 'Cool-LRS', 'Cool ZRS': 'Cool-ZRS', 'Cool GRS': 'Cool-GRS', 'Cool RA-GRS': 'Cool-RA-GRS',
  'Cold LRS': 'Cold-LRS', 'Cold ZRS': 'Cold-ZRS', 'Cold GRS': 'Cold-GRS', 'Cold RA-GRS': 'Cold-RA-GRS',
  'Archive LRS': 'Archive-LRS', 'Archive GRS': 'Archive-GRS', 'Archive RA-GRS': 'Archive-RA-GRS',
};

const AZURE_CLASS_ORDER = [
  'Hot-LRS', 'Hot-ZRS', 'Hot-GRS', 'Hot-RA-GRS',
  'Cool-LRS', 'Cool-ZRS', 'Cool-GRS', 'Cool-RA-GRS',
  'Cold-LRS', 'Cold-ZRS', 'Cold-GRS', 'Cold-RA-GRS',
  'Archive-LRS', 'Archive-GRS', 'Archive-RA-GRS',
];

// Skip edge, jio, delos, gov regions
function isAzureStandardRegion(code: string): boolean {
  if (code.startsWith('att')) return false;
  if (code.startsWith('jio')) return false;
  if (code.startsWith('delos')) return false;
  if (code.startsWith('usgov')) return false;
  if (code.startsWith('usdod')) return false;
  return true;
}

async function refreshAzure() {
  console.log('Azure: Discovering regions...');

  // Get all regions that have Blob Storage
  const filter = "serviceFamily eq 'Storage' and serviceName eq 'Storage' and priceType eq 'Consumption' " +
    "and contains(productName, 'Blob Storage') and unitOfMeasure eq '1 GB/Month' " +
    "and meterName eq 'Hot LRS Data Stored' and tierMinimumUnits eq 0";
  const discoveryUrl = buildUrl(AZURE_API, { '$filter': filter, '$top': '200' });
  const discoveryItems = await fetchAzureItems<{ armRegionName: string }>(discoveryUrl);

  const regions = [...new Set(discoveryItems.map(i => i.armRegionName).filter(Boolean))]
    .filter(isAzureStandardRegion)
    .sort();
  console.log(`Azure: Found ${regions.length} regions`);

  const storage: Record<string, Record<string, unknown>> = {};

  for (const region of regions) {
    const regionFilter = `serviceFamily eq 'Storage' and serviceName eq 'Storage' and priceType eq 'Consumption' ` +
      `and armRegionName eq '${region}' and contains(productName, 'Blob Storage') and unitOfMeasure eq '1 GB/Month'`;
    const url = buildUrl(AZURE_API, { '$filter': regionFilter, '$top': '100' });

    process.stdout.write(`  ${region}...`);
    const items = await fetchAzureItems<{
      skuName: string;
      meterName: string;
      retailPrice: number;
      tierMinimumUnits: number;
    }>(url);

    const regionData: Record<string, unknown> = {};
    const byClass: Record<string, Array<{ tierMin: number; price: number }>> = {};

    for (const item of items) {
      const mapped = AZURE_SKU_MAP[item.skuName];
      if (!mapped || item.retailPrice <= 0) continue;
      if (item.meterName !== `${item.skuName} Data Stored`) continue;
      if (!byClass[mapped]) byClass[mapped] = [];
      byClass[mapped].push({ tierMin: item.tierMinimumUnits, price: item.retailPrice });
    }

    for (const [cls, tiers] of Object.entries(byClass)) {
      tiers.sort((a, b) => a.tierMin - b.tierMin);
      if (tiers.length === 1) {
        regionData[cls] = tiers[0].price;
      } else {
        regionData[cls] = tiers.map((t, i) => ({
          maxGb: i < tiers.length - 1 ? tiers[i + 1].tierMin : null,
          perGb: t.price,
        }));
      }
    }

    // Reorder
    const ordered: Record<string, unknown> = {};
    for (const cls of AZURE_CLASS_ORDER) {
      if (cls in regionData) ordered[cls] = regionData[cls];
    }

    storage[region] = ordered;
    console.log(` ${Object.keys(ordered).length} classes`);
  }

  const existing = readPricingFile('azure.json');
  const doc = {
    lastVerified: today,
    source: 'Azure Retail Prices API (prices.azure.com)',
    provider: 'azure',
    refresh: refreshSuccess('azure', 'Storage pricing refreshed from Azure Retail Prices API.'),
    storage,
    operations: existing.operations,
    retrieval: existing.retrieval,
    dataTransferOut: existing.dataTransferOut,
    minStorageDays: existing.minStorageDays,
    redundancyTypes: existing.redundancyTypes,
    accessTiers: existing.accessTiers,
    earlyDeletionCharge: existing.earlyDeletionCharge,
  };

  writePricingFile('azure.json', doc);
  console.log(`Azure: Done — ${Object.keys(storage).length} regions\n`);
}

// ---------------------------------------------------------------------------
// GCP
// ---------------------------------------------------------------------------

const GCP_CATALOG_API = 'https://cloudbilling.googleapis.com/v1';
const GCP_STORAGE_CLASSES = ['Standard', 'Nearline', 'Coldline', 'Archive'] as const;
const GCP_LOCATION_KEYS = ['regional', 'multi-region', 'asia-multi-region', 'dual-region', 'asia-dual-region'] as const;

interface GcpSku {
  description?: string;
  category?: { resourceFamily?: string; resourceGroup?: string; usageType?: string };
  serviceRegions?: string[];
  pricingInfo?: Array<{
    pricingExpression?: {
      usageUnit?: string;
      baseUnit?: string;
      tieredRates?: Array<{
        startUsageAmount?: number;
        unitPrice?: { units?: string | number; nanos?: number };
      }>;
    };
  }>;
}

function classifyGcpStorageClass(description: string): typeof GCP_STORAGE_CLASSES[number] | null {
  const lower = description.toLowerCase();
  if (!lower.includes('storage')) return null;
  if (lower.includes('archive')) return 'Archive';
  if (lower.includes('coldline')) return 'Coldline';
  if (lower.includes('nearline')) return 'Nearline';
  if (lower.includes('standard')) return 'Standard';
  return null;
}

function classifyGcpLocationKey(description: string): typeof GCP_LOCATION_KEYS[number] | null {
  const lower = description.toLowerCase();
  if (lower.includes('dual') && lower.includes('asia')) return 'asia-dual-region';
  if (lower.includes('dual')) return 'dual-region';
  if (lower.includes('multi') && lower.includes('asia')) return 'asia-multi-region';
  if (lower.includes('multi')) return 'multi-region';
  if (lower.includes('regional') || lower.includes('region')) return 'regional';
  return null;
}

async function fetchGcpCatalogPath(path: string, apiKey: string): Promise<unknown> {
  const separator = path.includes('?') ? '&' : '?';
  return fetchJson(`${GCP_CATALOG_API}${path}${separator}key=${encodeURIComponent(apiKey)}`);
}

async function findGcpCloudStorageService(apiKey: string): Promise<string> {
  let pageToken = '';

  do {
    const params = new URLSearchParams({ pageSize: '5000' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await fetchGcpCatalogPath(`/services?${params.toString()}`, apiKey) as {
      services?: Array<{ serviceId: string; displayName: string }>;
      nextPageToken?: string;
    };
    const service = data.services?.find(s => s.displayName === 'Cloud Storage');
    if (service) return service.serviceId;
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  throw new Error('Could not find GCP Cloud Storage service in Cloud Billing Catalog API');
}

async function fetchGcpStorageSkus(apiKey: string, serviceId: string): Promise<GcpSku[]> {
  const skus: GcpSku[] = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({ currencyCode: 'USD', pageSize: '5000' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await fetchGcpCatalogPath(`/services/${serviceId}/skus?${params.toString()}`, apiKey) as {
      skus?: GcpSku[];
      nextPageToken?: string;
    };
    skus.push(...(data.skus || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return skus;
}

async function refreshGcp() {
  const existing = readPricingFile('gcp.json');
  const apiKey = process.env.GCP_CLOUD_BILLING_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;

  if (!apiKey) {
    console.log('GCP: Skipped API refresh — set GCP_CLOUD_BILLING_API_KEY to use the Cloud Billing Catalog API.');
    console.log('  Existing prices left unchanged. Manual references:');
    console.log('  https://cloud.google.com/storage/pricing');
    console.log('  https://cloud.google.com/storage/pricing-announce\n');
    writePricingFile('gcp.json', {
      ...existing,
      refresh: refreshWarning(
        'gcp',
        'skipped',
        'GCP pricing was not refreshed because no Cloud Billing Catalog API key is configured. Pricing may be stale or inaccurate.',
        'GCP_CLOUD_BILLING_API_KEY',
      ),
    });
    return;
  }

  try {
    console.log('GCP: Fetching Cloud Billing Catalog API...');
    const serviceId = process.env.GCP_CLOUD_STORAGE_SERVICE_ID || await findGcpCloudStorageService(apiKey);
    const skus = await fetchGcpStorageSkus(apiKey, serviceId);
    console.log(`GCP: Found ${skus.length} Cloud Storage SKUs`);

    const storage: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(existing.storage || {}));

    for (const sku of skus) {
      const description = sku.description || '';
      const storageClass = classifyGcpStorageClass(description);
      const locationKey = classifyGcpLocationKey(description);
      if (!storageClass || !locationKey) continue;
      if (sku.category?.resourceFamily !== 'Storage') continue;

      const expression = sku.pricingInfo?.[0]?.pricingExpression;
      const usageUnit = expression?.usageUnit || expression?.baseUnit || '';
      if (!/by|gib|gb/i.test(usageUnit)) continue;

      const firstRate = expression?.tieredRates?.find(r => (r.startUsageAmount || 0) === 0);
      const price = usdFromGcpUnitPrice(firstRate?.unitPrice);
      if (price <= 0) continue;

      storage[locationKey] = storage[locationKey] || {};
      storage[locationKey][storageClass] = price;
    }

    for (const locationKey of GCP_LOCATION_KEYS) {
      for (const storageClass of GCP_STORAGE_CLASSES) {
        if (typeof storage[locationKey]?.[storageClass] !== 'number') {
          throw new Error(`GCP API refresh did not produce ${locationKey} ${storageClass} pricing`);
        }
      }
    }

    writePricingFile('gcp.json', {
      ...existing,
      lastVerified: today,
      source: 'Google Cloud Billing Catalog API (cloudbilling.googleapis.com)',
      refresh: refreshSuccess('gcp', 'Storage pricing refreshed from Google Cloud Billing Catalog API.'),
      storage,
    });
    console.log('GCP: Done\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown GCP pricing refresh error';
    writePricingFile('gcp.json', {
      ...existing,
      refresh: refreshWarning(
        'gcp',
        'error',
        `GCP pricing refresh failed: ${message}. Pricing may be stale or inaccurate.`,
        'GCP_CLOUD_BILLING_API_KEY',
      ),
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

async function refreshR2() {
  console.log('R2: No stable public pricing API configured.');
  console.log('  Existing prices left unchanged. Verify manually at:');
  console.log('  https://developers.cloudflare.com/r2/pricing/');
  console.log('  R2 has a single global flat rate — no regions, no tiers.\n');
}

// ---------------------------------------------------------------------------
// B2 (our own pricing — verify at backblaze.com/cloud-storage/pricing)
// ---------------------------------------------------------------------------

async function refreshB2() {
  const existing = readPricingFile('b2.json');
  const current = {
    storage: (existing.storage as Record<string, number>).perTbMonth,
    egress: (existing.egress as Record<string, unknown>).overagePerGb,
    freeMultiplier: (existing.egress as Record<string, unknown>).freeMultiplier,
  };

  console.log(`  Current rates: $${current.storage}/TB storage, $${current.egress}/GB egress overage, ${current.freeMultiplier}× free egress`);
  console.log('B2: No stable public pricing API configured.');
  console.log('  Key pages to check:');
  console.log('    - https://www.backblaze.com/cloud-storage/pricing');
  console.log('    - https://www.backblaze.com/blog (for pricing announcements)');
  console.log('    - UDM rate, Reserve Capacity, and partner CDN list');
  console.log('  Existing prices left unchanged.\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const target = process.argv[2]?.toLowerCase();
  const validTargets = ['aws', 'gcp', 'azure', 'r2', 'b2'];

  if (target && !validTargets.includes(target)) {
    console.error(`Unknown provider: ${target}`);
    console.error(`Usage: npx tsx scripts/refresh-pricing.ts [${validTargets.join('|')}]`);
    process.exit(1);
  }

  console.log(`\n=== Pricing Refresh (${today}) ===\n`);

  if (!target || target === 'aws') await refreshAws();
  if (!target || target === 'azure') await refreshAzure();
  if (!target || target === 'gcp') await refreshGcp();
  if (!target || target === 'r2') await refreshR2();
  if (!target || target === 'b2') await refreshB2();

  console.log('Done. Review the diffs before committing.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
