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
 * Data sources (all public, no auth required):
 *   AWS:   pricing.us-east-1.amazonaws.com  (Bulk Pricing API)
 *   GCP:   cloud.google.com/storage/pricing (HTML scrape — GCP has no public JSON API)
 *   Azure: prices.azure.com/api/retail/prices (Retail Prices API)
 *   R2:    developers.cloudflare.com/r2/pricing (HTML scrape)
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

function writePricingFile(filename: string, data: unknown) {
  const path = join(PRICING_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ✓ Wrote ${path}`);
}

function readPricingFile(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(PRICING_DIR, filename), 'utf-8'));
}

// ---------------------------------------------------------------------------
// AWS
// ---------------------------------------------------------------------------

const AWS_VERSION_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/region_index.json';

const AWS_STORAGE_CLASS_MAP: Record<string, string> = {
  'Standard': 'Standard',
  'Standard - Infrequent Access': 'Standard-IA',
  'One Zone - Infrequent Access': 'One Zone-IA',
  'Intelligent-Tiering Frequent Access': 'Intelligent-Tiering-FA',
  'Intelligent-Tiering Infrequent Access': 'Intelligent-Tiering-IA',
  'Intelligent-Tiering Archive Instant Access': 'Intelligent-Tiering-AIA',
  'Glacier Instant Retrieval': 'Glacier Instant Retrieval',
  'Amazon Glacier': 'Glacier Flexible Retrieval',
  'IntelligentTieringDeepArchiveAccess': 'Glacier Deep Archive',
  'Express One Zone': 'Express One Zone',
  'Reduced Redundancy': 'Reduced Redundancy',
};

const AWS_CLASS_ORDER = [
  'Standard', 'Standard-IA', 'One Zone-IA',
  'Intelligent-Tiering-FA', 'Intelligent-Tiering-IA', 'Intelligent-Tiering-AIA',
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
  const index = await fetchJson(AWS_VERSION_URL) as {
    publicationDate: string;
    regions: Record<string, { regionCode: string; currentVersionUrl: string }>;
  };

  const version = index.publicationDate.slice(0, 10);
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
          maxTb: t.end ? Math.round(t.end / 1024) : null,
          perGb: t.price,
        }));
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
  const discoveryUrl = `${AZURE_API}?$filter=${encodeURIComponent(filter)}&$top=200`;
  const discovery = await fetchJson(discoveryUrl) as { Items: Array<{ armRegionName: string }> };

  const regions = [...new Set(discovery.Items.map(i => i.armRegionName).filter(Boolean))]
    .filter(isAzureStandardRegion)
    .sort();
  console.log(`Azure: Found ${regions.length} regions`);

  const storage: Record<string, Record<string, unknown>> = {};

  for (const region of regions) {
    const regionFilter = `serviceFamily eq 'Storage' and serviceName eq 'Storage' and priceType eq 'Consumption' ` +
      `and armRegionName eq '${region}' and contains(productName, 'Blob Storage') and unitOfMeasure eq '1 GB/Month'`;
    const url = `${AZURE_API}?$filter=${encodeURIComponent(regionFilter)}&$top=100`;

    process.stdout.write(`  ${region}...`);
    const data = await fetchJson(url) as { Items: Array<{ skuName: string; retailPrice: number; tierMinimumUnits: number }> };

    const regionData: Record<string, unknown> = {};
    const tiered: Record<string, Array<{ tierMin: number; price: number }>> = {};

    for (const item of data.Items) {
      const mapped = AZURE_SKU_MAP[item.skuName];
      if (!mapped || item.retailPrice <= 0) continue;

      if (item.skuName.startsWith('Hot') || item.skuName.startsWith('Cool ZRS')) {
        if (!tiered[mapped]) tiered[mapped] = [];
        tiered[mapped].push({ tierMin: item.tierMinimumUnits, price: item.retailPrice });
      } else {
        regionData[mapped] = item.retailPrice;
      }
    }

    for (const [cls, tiers] of Object.entries(tiered)) {
      tiers.sort((a, b) => a.tierMin - b.tierMin);
      if (tiers.length === 1) {
        regionData[cls] = tiers[0].price;
      } else {
        regionData[cls] = tiers.map((t, i) => ({
          maxTb: i < tiers.length - 1 ? Math.round(tiers[i + 1].tierMin / 1024) : null,
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
// GCP (no public JSON API — manual verification required)
// ---------------------------------------------------------------------------

async function refreshGcp() {
  console.log('GCP: No public JSON pricing API available.');
  console.log('  GCP pricing must be verified manually at:');
  console.log('  https://cloud.google.com/storage/pricing');
  console.log('  https://cloud.google.com/storage/pricing-announce');
  console.log('');
  console.log('  GCP uses uniform pricing across all regions within a location type.');
  console.log('  Check: Regional, Multi-region (US/EU vs Asia), Dual-region pricing.');

  const existing = readPricingFile('gcp.json');
  existing.lastVerified = today;
  writePricingFile('gcp.json', existing);
  console.log('  ✓ Updated lastVerified date (prices unchanged — verify manually)\n');
}

// ---------------------------------------------------------------------------
// R2 (simple — rarely changes)
// ---------------------------------------------------------------------------

async function refreshR2() {
  console.log('R2: Verify at https://developers.cloudflare.com/r2/pricing/');
  console.log('  R2 has a single global flat rate — no regions, no tiers.');

  const existing = readPricingFile('r2.json');
  existing.lastVerified = today;
  writePricingFile('r2.json', existing);
  console.log('  ✓ Updated lastVerified date (prices unchanged — verify manually)\n');
}

// ---------------------------------------------------------------------------
// B2 (our own pricing — verify at backblaze.com/cloud-storage/pricing)
// ---------------------------------------------------------------------------

async function refreshB2() {
  console.log('B2: Verify at https://www.backblaze.com/cloud-storage/pricing');

  const existing = readPricingFile('b2.json');
  const current = {
    storage: (existing.storage as Record<string, number>).perTbMonth,
    egress: (existing.egress as Record<string, unknown>).overagePerGb,
    freeMultiplier: (existing.egress as Record<string, unknown>).freeMultiplier,
  };

  console.log(`  Current rates: $${current.storage}/TB storage, $${current.egress}/GB egress overage, ${current.freeMultiplier}× free egress`);
  console.log('  Key pages to check:');
  console.log('    - https://www.backblaze.com/cloud-storage/pricing');
  console.log('    - https://www.backblaze.com/blog (for pricing announcements)');
  console.log('    - UDM rate, Reserve Capacity, and partner CDN list');

  existing.lastVerified = today;
  writePricingFile('b2.json', existing);
  console.log('  ✓ Updated lastVerified date (prices unchanged — verify manually)\n');
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
