import { execSync } from 'child_process';
import { v4 as uuid } from 'uuid';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ParsedLineItem, AccountBreakdown, Category, NamedDiscount } from '@/types/analysis';
import type { ParseResult } from './types';
import { parseFormattedNumber, parseUsdAmount } from './normalize';
import {
  computeParseConfidence,
  classifyParseOutcome,
  sumAddressableCost,
  unsupportedLayoutWarning,
  NO_STORAGE_SCOPE_WARNING,
} from './confidence';
import { AWS_REGION_CODES, AWS_SKU_STORAGE_CLASS } from '../categories/types';
import { buildAwsComputeSignals, getAwsComputeSignalService, type AwsComputeSignalInput } from './aws-compute-signals';
import { classifyS3Suffix } from './aws-s3-classify';
import { buildEgressProfileSuggestion } from '@/lib/analysis/egress-profile-suggestion';

function extractText(pdfBuffer: Buffer): string {
  const tmpPath = join(tmpdir(), `bill-${Date.now()}.pdf`);
  try {
    writeFileSync(tmpPath, pdfBuffer);
    return execSync(`pdftotext -layout "${tmpPath}" -`, {
      maxBuffer: 50 * 1024 * 1024,
    }).toString('utf-8');
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

function resolveRegionCode(code: string): string {
  return AWS_REGION_CODES[code] || code;
}

function extractRegionCode(sku: string): string | null {
  const match = sku.match(/^([A-Z]{2,4}\d?)-/);
  return match ? match[1] : null;
}

const REGION_NAME_TO_CODE: Record<string, string> = {
  'N. Virginia': 'us-east-1',
  'Ohio': 'us-east-2',
  'N. California': 'us-west-1',
  'Oregon': 'us-west-2',
  'Singapore': 'ap-southeast-1',
  'Sydney': 'ap-southeast-2',
  'Mumbai': 'ap-south-1',
  'Tokyo': 'ap-northeast-1',
  'Seoul': 'ap-northeast-2',
  'Osaka': 'ap-northeast-3',
  'Ireland': 'eu-west-1',
  'London': 'eu-west-2',
  'Paris': 'eu-west-3',
  'Frankfurt': 'eu-central-1',
  'Stockholm': 'eu-north-1',
  'Sao Paulo': 'sa-east-1',
  'São Paulo': 'sa-east-1',
  'Canada': 'ca-central-1',
  'Bahrain': 'me-south-1',
  'Cape Town': 'af-south-1',
  'Hong Kong': 'ap-east-1',
  'Jakarta': 'ap-southeast-3',
  'Hyderabad': 'ap-south-2',
  'Milan': 'eu-south-1',
  'Auckland': 'ap-southeast-5',
  'Melbourne': 'ap-southeast-4',
};

function regionCodeFromName(regionName: string): string | null {
  for (const [name, code] of Object.entries(REGION_NAME_TO_CODE)) {
    if (regionName.includes(name)) return code;
  }
  return null;
}

export function classifyAwsLine(
  service: string,
  skuCode: string,
  rateDescription: string
): { category: Category; subcategory?: string; storageClass?: string } {
  const lower = rateDescription.toLowerCase();

  // S3 Storage
  if (service.includes('Simple Storage Service') || service.includes('S3 Glacier')) {
    const skuSuffix = skuCode.replace(/^[A-Z]{2,4}\d?-/, '');

    // Storage classes
    if (skuSuffix in AWS_SKU_STORAGE_CLASS) {
      return { category: 'storage', storageClass: AWS_SKU_STORAGE_CLASS[skuSuffix] };
    }

    // Shared request + per-class retrieval classification (see aws-s3-classify.ts)
    const shared = classifyS3Suffix(skuSuffix);
    if (shared) return shared;

    // Glacier Instant Retrieval identified only by the rate description
    if (lower.includes('glacier instant')) {
      return { category: 'retrieval', storageClass: 'Glacier Instant Retrieval' };
    }

    // Early delete
    if (skuSuffix.includes('EarlyDelete')) {
      const cls = skuSuffix.includes('ZIA') ? 'One Zone-IA' :
                  skuSuffix.includes('SIA') ? 'Standard-IA' :
                  skuSuffix.includes('GDA') ? 'Glacier Deep Archive' :
                  skuSuffix.includes('GIR') ? 'Glacier Instant Retrieval' : undefined;
      return { category: 'retrieval', subcategory: 'Early Deletion', storageClass: cls };
    }

    // Monitoring
    if (skuSuffix.includes('Monitoring') || skuSuffix.includes('Inventory') ||
        skuSuffix.includes('StorageAnalytics') || skuSuffix.includes('StorageLens')) {
      return { category: 'operations', subcategory: 'Monitoring/Analytics' };
    }

    // Tags
    if (skuSuffix.includes('TagStorage')) {
      return { category: 'operations', subcategory: 'Tag Storage' };
    }

    // S3 Tables / Vectors
    if (skuSuffix.includes('Tables-') || skuSuffix.includes('Vectors-')) {
      return { category: 'storage', subcategory: 'S3 Tables/Vectors' };
    }

    // Select
    if (skuSuffix.includes('Select-')) {
      return { category: 'operations', subcategory: 'S3 Select' };
    }

    // CopyObject and other misc Glacier operations
    if (skuSuffix === 'CopyObject' || skuSuffix.includes('Restore') || skuSuffix.includes('Transition')) {
      return { category: 'operations', subcategory: 'Lifecycle/Copy' };
    }

    // Only classify as storage if it has a recognized TimedStorage pattern
    if (skuSuffix.startsWith('TimedStorage')) {
      return { category: 'storage' };
    }

    // Default unrecognized S3 SKUs to operations, not storage
    return { category: 'operations', subcategory: 'Other S3' };
  }

  // Data Transfer
  if (service.includes('Data Transfer')) {
    if (lower.includes('regional data transfer') || lower.includes('between ec2 az')) {
      return { category: 'out-of-scope', subcategory: 'Intra-region Transfer' };
    }
    if (lower.includes('data transfer out') && lower.includes('free tier')) {
      return { category: 'egress', subcategory: 'Internet Egress' };
    }
    if (lower.includes('data transfer out') && !lower.includes('cloudfront')) {
      return { category: 'egress', subcategory: 'Internet Egress' };
    }
    if (lower.includes('cloudfront')) {
      return { category: 'storage-adjacent', subcategory: 'CloudFront Transfer' };
    }
    if (skuCode.match(/[A-Z]{3,4}\d?-[A-Z]{3,4}\d?-AWS-In-Bytes/)) {
      return { category: 'out-of-scope', subcategory: 'Data Transfer In' };
    }
    if (skuCode.match(/[A-Z]{3,4}\d?-[A-Z]{3,4}\d?-AWS-(Out|In)-Bytes/)) {
      return { category: 'egress', subcategory: 'Inter-region Transfer' };
    }
    if (lower.includes('data transfer in') || lower.includes('transfer - in')) {
      return { category: 'out-of-scope', subcategory: 'Data Transfer In' };
    }
    if (lower.includes('natgateway') || lower.includes('nat gateway')) {
      return { category: 'out-of-scope', subcategory: 'NAT Gateway' };
    }

    return { category: 'egress', subcategory: 'Other Transfer' };
  }

  // EBS, EFS, ECR — storage-adjacent
  if (service.includes('Elastic Block') || service.includes('EBS') ||
      service.includes('Elastic File') || service.includes('EFS') ||
      service.includes('Container Registry') || service.includes('ECR')) {
    return { category: 'storage-adjacent', subcategory: 'Block/File Storage' };
  }

  // CloudFront
  if (service.includes('CloudFront')) {
    return { category: 'storage-adjacent', subcategory: 'CloudFront' };
  }

  // Analytics scans are useful storage-path evidence even though they are not object-storage costs.
  if (service.includes('Athena')) {
    return { category: 'storage-adjacent', subcategory: 'Analytics Scan' };
  }

  // AWS Transfer Family
  if (service.includes('Transfer Family')) {
    return { category: 'storage-adjacent', subcategory: 'Transfer Family' };
  }

  return { category: 'out-of-scope' };
}

const COMPUTE_SIGNAL_REGION_PATTERN = /^\s*(US (?:East|West)|Asia Pacific|EU|South America|Canada|Middle East|Africa)\s+\(([^)]+)\)\s+(?:USD\s+)?[\d,.]+/;
const COMPUTE_SIGNAL_GLOBAL_REGION_PATTERN = /^\s*Global\s+(?:USD\s+)?[\d,.]+/;
const COMPUTE_SIGNAL_TOTAL_PATTERN = /^\s{0,4}(.+?)\s+USD\s+([\d,.]+)\s*$/;
const CHARGES_BY_SERVICE_PATTERN = /Charges by service/;
const CHARGES_BY_SERVICE_END_PATTERN = /Charges by account|Invoices|Tax Invoices|Taxes by service/;

function extractComputeSignalInputs(text: string): AwsComputeSignalInput[] {
  const lines = text.split('\n');
  const inputs: AwsComputeSignalInput[] = [];

  let inChargesByService = false;
  let currentRegion = '';
  let activeInput: AwsComputeSignalInput | null = null;

  for (const line of lines) {
    if (CHARGES_BY_SERVICE_PATTERN.test(line)) {
      inChargesByService = true;
      activeInput = null;
      continue;
    }

    if (!inChargesByService) continue;

    if (CHARGES_BY_SERVICE_END_PATTERN.test(line)) {
      break;
    }

    const regionMatch = line.match(COMPUTE_SIGNAL_REGION_PATTERN);
    if (regionMatch) {
      currentRegion = `${regionMatch[1]} (${regionMatch[2]})`;
      if (activeInput) {
        activeInput.regions = addUnique(activeInput.regions || [], currentRegion);
      }
      continue;
    }

    if (COMPUTE_SIGNAL_GLOBAL_REGION_PATTERN.test(line)) {
      currentRegion = 'Global';
      if (activeInput) {
        activeInput.regions = addUnique(activeInput.regions || [], currentRegion);
      }
      continue;
    }

    const totalMatch = line.match(COMPUTE_SIGNAL_TOTAL_PATTERN);
    if (!totalMatch) continue;

    const name = totalMatch[1].trim();
    if (name.includes(':')) continue;

    const signalService = getAwsComputeSignalService(name);
    if (!signalService) continue;

    const input: AwsComputeSignalInput = {
      name,
      amountUsd: parseUsdAmount(totalMatch[2]),
      regions: currentRegion ? [currentRegion] : undefined,
      evidence: [`${name}: $${totalMatch[2]}`],
    };
    inputs.push(input);
    activeInput = input;
  }

  return inputs;
}

function addUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function formatUsdAmount(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Reconcile parsed storage-scope spend against the bill's grand total.
 *
 * Under-capture (addressable < 95% of grand total) is the *expected* outcome for any
 * compute-heavy AWS bill — non-storage spend is intentionally out-of-scope — so it is a
 * neutral commercial signal, never a warning that docks parse confidence. Over-capture
 * (addressable > 105% of grand total) is anomalous (a likely double-count or mis-parse) and is
 * a genuine, blocking reconciliation warning. Pure and exported for direct unit testing.
 */
export function classifyGrandTotalReconciliation(
  addressableTotal: number,
  grandTotal: number,
): { commercialSignal?: string; warning?: string } {
  if (grandTotal <= 0) return {};

  if (addressableTotal > grandTotal * 1.05) {
    return {
      warning:
        `Parsed storage-scope total ($${formatUsdAmount(addressableTotal)}) exceeds the bill grand total ` +
        `($${formatUsdAmount(grandTotal)}); some line items may be double-counted.`,
    };
  }

  if (addressableTotal < grandTotal * 0.95) {
    const pct = (addressableTotal / grandTotal) * 100;
    return {
      commercialSignal:
        `Parsed storage scope is ${pct.toFixed(1)}% of the bill grand total ($${formatUsdAmount(grandTotal)}); ` +
        `the remainder is non-storage spend categorized as out-of-scope.`,
    };
  }

  return {};
}

export function parseAwsDetailPdf(pdfBuffer: Buffer): ParseResult {
  const text = extractText(pdfBuffer);
  const lines = text.split('\n');

  const lineItems: ParsedLineItem[] = [];
  const accounts: AccountBreakdown[] = [];
  const discounts: NamedDiscount[] = [];
  const computeSignals = buildAwsComputeSignals(extractComputeSignalInputs(text));
  const warnings: string[] = [];
  const commercialSignals: string[] = [];

  let currentService = '';
  let currentRegionName = '';
  let currentSkuCode = '';
  let currentSkuService = '';
  let billingPeriod = '';
  let accountId = '';
  let inAccountsSection = false;
  let grandTotal = 0;

  // Extract billing period
  const periodMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s*-\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,?\s+\d{4}/i);
  if (periodMatch) billingPeriod = periodMatch[0];

  // Extract account ID (payer account)
  const acctMatch = text.match(/Account\s*ID[\s\n]+(\d{12})/);
  if (acctMatch) accountId = acctMatch[1];
  // Fallback: look for payerAccountId reference
  if (!accountId) {
    const payerMatch = text.match(/Payable by Account ID:\s*\{?(\d{12})/);
    if (payerMatch) accountId = payerMatch[1];
  }

  // Extract grand total
  const totalMatch = text.match(/Grand\s+total:\s*USD\s+([\d,.]+)/i);
  if (totalMatch) grandTotal = parseFormattedNumber(totalMatch[1]);

  // Detect named discounts
  const edpPattern = /Enterprise\s+Discount\s+Program.*?USD\s+([\d,.]+)/gi;
  const prcPattern = /Private\s+Rate\s+Card.*?USD\s+([\d,.]+)/gi;
  let discountMatch;
  while ((discountMatch = edpPattern.exec(text)) !== null) {
    discounts.push({
      name: 'Enterprise Discount Program',
      amountUsd: parseFormattedNumber(discountMatch[1]),
    });
  }
  while ((discountMatch = prcPattern.exec(text)) !== null) {
    discounts.push({
      name: 'Private Rate Card',
      amountUsd: parseFormattedNumber(discountMatch[1]),
    });
  }

  // SKU line pattern: service name + SKU code + optional USD amount
  // Matches both hyphenated SKUs (APS1-TimedStorage-ByteHrs) and single-word SKUs (CopyObject)
  const skuLinePattern = /^\s*(Amazon Simple Storage Service|AWS Data Transfer|Amazon S3 Glacier[^U]*?|Amazon Elastic[^U]*?|Amazon EC2 Container Registry[^U]*?|Amazon CloudFront[^U]*?|Amazon Athena|AWS Transfer Family[^U]*?)\s+([\w][\w-]*(?:-[\w-]+)?)(?:\s+(?:USD\s+)?([\d,.]+))?\s*$/;

  // Rate line pattern: $rate per description ... quantity unit ... USD cost
  const rateLinePattern = /^\s+\$?([\d.]+)\s+per\s+(.*?)\s{2,}([\d,.]+)\s+([\w-]+)\s+USD\s+([\d,.]+)/;
  const rateLine2Pattern = /^\s+USD\s*(\d+\.?\d*)\s+per\s+GB\s+(.*?)\s{2,}([\d,.]+)\s+([\w-]+)\s+USD\s+([\d,.]+)/;
  const zeroRatePattern = /^\s+USD0\.0+\s+per\s+GB\s+(.*?)\s{2,}([\d,.]+)\s+([\w-]+)\s+USD\s+([\d,.]+)/;

  // Region header pattern
  const regionPattern = /^(US (?:East|West)|Asia Pacific|EU|South America|Canada|Middle East|Africa)\s+\(([^)]+)\)\s+(?:USD\s+)?([\d,.]+)/;
  const globalRegionPattern = /^Global\s+(?:USD\s+)?([\d,.]+)/;

  // Service section markers — broad set to detect when we leave a relevant section
  const serviceSectionPattern = /^\s{0,4}(Simple Storage Service|S3 Glacier Deep Archive|Data Transfer|Elastic Compute Cloud|Elastic Block Store|Elastic File System|CloudFront|ElastiCache|Relational Database|DynamoDB|Redshift|Lambda|CloudWatch|Security Hub|Glue|Athena|EMR|SQS|SNS|Config|WAF|Guard|Shield|Key Management|Secrets Manager|CodeBuild|CodePipeline|Step Functions|Managed Streaming|Kinesis|Backup|Organizations|Systems Manager|Directory Service|Inspector|Macie|Certificate|Route 53|API Gateway|Virtual Private Cloud|Elastic Load Balancing|QuickSight|Elastic Container|Cost Explorer|CloudTrail|Simple Email|Simple Notification|Simple Queue|SimpleDB|Bedrock|SageMaker|OpenSearch|Elasticsearch|Comprehend|Textract|Rekognition)\b/;
  const relevantServices = new Set(['Simple Storage Service', 'S3 Glacier Deep Archive', 'Data Transfer', 'Elastic Block Store', 'Elastic File System', 'CloudFront', 'Elastic Compute Cloud', 'Athena']);
  let inRelevantService = false;

  // Entity boundary pattern — clears all parsing state on new billing entity
  const entityBoundaryPattern = /^Amazon Web Services\b/;

  // Accounts section
  const accountsHeaderPattern = /Charges by account\s+\((\d+)\)/;
  const accountLinePattern = /^\s*(\d{12})\s+(.+?)\s+USD\s+([\d,.]+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect accounts section
    if (accountsHeaderPattern.test(line)) {
      inAccountsSection = true;
      continue;
    }

    if (inAccountsSection) {
      const acctLine = line.match(accountLinePattern);
      if (acctLine) {
        accounts.push({
          accountId: acctLine[1],
          accountName: acctLine[2].trim(),
          amountUsd: parseFormattedNumber(acctLine[3]),
        });
      } else if (line.trim() && !line.includes('Account ID') && !line.includes('Account Name') && !line.includes('Amount in USD') && accounts.length > 0) {
        inAccountsSection = false;
      }
      continue;
    }

    // Detect entity boundary (e.g. "Amazon Web Services EMEA SARL")
    if (entityBoundaryPattern.test(line)) {
      currentSkuCode = '';
      currentSkuService = '';
      currentService = '';
      inRelevantService = false;
    }

    // Detect service section — always reset SKU state to prevent cross-service contamination
    const svcMatch = line.match(serviceSectionPattern);
    if (svcMatch) {
      currentService = svcMatch[1];
      inRelevantService = relevantServices.has(currentService);
      currentSkuCode = '';
      currentSkuService = '';
    }

    // Detect region header
    const regMatch = line.match(regionPattern);
    if (regMatch) {
      currentRegionName = `${regMatch[1]} (${regMatch[2]})`;
    } else if (globalRegionPattern.test(line)) {
      currentRegionName = 'Global';
    }

    // Detect SKU line
    const skuMatch = line.match(skuLinePattern);
    if (skuMatch) {
      currentSkuService = skuMatch[1].trim();
      currentSkuCode = skuMatch[2];
      continue;
    }

    // Parse rate lines (detail under a SKU)
    let rateMatch = line.match(rateLinePattern) || line.match(rateLine2Pattern);
    if (!rateMatch) {
      const zeroMatch = line.match(zeroRatePattern);
      if (zeroMatch) {
        rateMatch = ['', '0', zeroMatch[1], zeroMatch[2], zeroMatch[3], zeroMatch[4]];
      }
    }

    if (rateMatch && currentSkuCode && (inRelevantService || currentSkuService.includes('S3 Glacier'))) {
      const unitRate = parseFloat(rateMatch[1]);
      const rateDescription = rateMatch[2].trim();
      const usageQty = parseFormattedNumber(rateMatch[3]);
      const usageUnit = rateMatch[4];
      const costUsd = parseUsdAmount(rateMatch[5]);

      const regionCode = extractRegionCode(currentSkuCode);
      const region = regionCode
        ? resolveRegionCode(regionCode)
        : (regionCodeFromName(currentRegionName) ?? 'GLOBAL');

      const { category, subcategory, storageClass } = classifyAwsLine(
        currentSkuService,
        currentSkuCode,
        rateDescription
      );

      lineItems.push({
        id: uuid(),
        provider: 'aws',
        service: currentSkuService,
        region,
        sku: currentSkuCode,
        description: rateDescription,
        category,
        subcategory,
        storageClass,
        unitRate: unitRate || undefined,
        usageQuantity: usageQty || undefined,
        usageUnit: usageUnit || undefined,
        costUsd,
        isEstimate: false,
        isEdited: false,
      });
    }
  }

  // Reconcile against the grand total using storage-scope (addressable) spend only — the
  // intended-out-of-scope remainder must not read as a parse error. The grand-total fallback
  // still uses the full parsed sum so a totalless bill reports a representative total.
  const parsedTotal = lineItems.reduce((sum, item) => sum + item.costUsd, 0);
  const addressableTotal = sumAddressableCost(lineItems);
  const egressProfileSuggestion = buildEgressProfileSuggestion(lineItems, computeSignals);

  let hasBlockingWarning = false;
  const reconciliation = classifyGrandTotalReconciliation(addressableTotal, grandTotal);
  if (reconciliation.commercialSignal) commercialSignals.push(reconciliation.commercialSignal);
  if (reconciliation.warning) {
    warnings.push(reconciliation.warning);
    hasBlockingWarning = true;
  }

  const outcome = classifyParseOutcome(lineItems.length > 0, addressableTotal);
  if (outcome === 'empty') {
    warnings.push(unsupportedLayoutWarning('AWS detailed billing statement'));
  } else if (outcome === 'no-addressable') {
    warnings.push(NO_STORAGE_SCOPE_WARNING);
  }

  return {
    provider: 'aws',
    billType: 'detailed-statement',
    billingPeriod,
    accountId,
    detectionSignals: [],
    parsedBill: {
      lineItems,
      accounts: accounts.length > 0 ? accounts : undefined,
      computeSignals: computeSignals.length > 0 ? computeSignals : undefined,
      egressProfileSuggestion,
      grandTotal: grandTotal || Math.round(parsedTotal * 100) / 100,
      parseConfidence: computeParseConfidence({ baseline: 0.85, outcome, hasBlockingWarning }),
      warnings,
      commercialSignals: commercialSignals.length > 0 ? commercialSignals : undefined,
      discounts: discounts.length > 0 ? discounts : undefined,
    },
  };
}
