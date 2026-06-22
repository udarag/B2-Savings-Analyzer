import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import type { ParsedLineItem, AccountBreakdown, AccountServiceBreakdown, Category, NamedDiscount } from '@/types/analysis';
import type { ParseResult } from './types';
import { parseFormattedNumber } from './normalize';
import { getListRate } from '@/lib/pricing/lookup';

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

interface ServiceEntry {
  name: string;
  netTotal: number;
  charges: number;
  discounts: { name: string; amount: number }[];
}

function classifyService(name: string): { category: Category; subcategory?: string; storageClass?: string } {
  const lower = name.toLowerCase();

  if (lower.includes('simple storage service') || lower === 'amazon s3') {
    return { category: 'storage', storageClass: 'S3 (Summary)' };
  }
  if (lower.includes('s3 glacier deep archive')) {
    return { category: 'storage', storageClass: 'Glacier Deep Archive' };
  }
  if (lower.includes('s3 glacier flexible')) {
    return { category: 'storage', storageClass: 'Glacier Flexible Retrieval' };
  }
  if (lower.includes('s3 glacier') || lower.includes('glacier')) {
    return { category: 'storage', storageClass: 'Glacier' };
  }
  if (lower.includes('data transfer')) {
    return { category: 'egress', subcategory: 'Data Transfer (Summary)' };
  }
  if (lower.includes('cloudfront')) {
    return { category: 'storage-adjacent', subcategory: 'CloudFront' };
  }
  if (lower.includes('container registry') || /\becr\b/.test(lower)) {
    return { category: 'storage-adjacent', subcategory: 'ECR' };
  }
  if (lower.includes('transfer family')) {
    return { category: 'storage-adjacent', subcategory: 'Transfer Family' };
  }
  if (lower.includes('backup')) {
    return { category: 'storage-adjacent', subcategory: 'AWS Backup' };
  }
  if (lower.includes('elastic file system') || lower.includes('elastic block store')) {
    return { category: 'storage-adjacent', subcategory: 'Block/File Storage' };
  }

  return { category: 'out-of-scope' };
}

function estimateStorageGb(costUsd: number, storageClass: string | undefined): number | undefined {
  if (!costUsd || costUsd <= 0 || !storageClass) return undefined;

  const rate = getListRate('aws', storageClass, 'us-east-1');
  if (!rate) return undefined;

  return Math.round(costUsd / rate);
}

function parseServiceEntries(text: string): ServiceEntry[] {
  const lines = text.split('\n');
  const entries: ServiceEntry[] = [];

  // Match service line: indented service name followed by dollar amount
  // e.g. "    Amazon Simple Storage Service                 $116,349.79"
  const serviceLinePattern = /^\s{2,8}(\S.+?)\s{2,}\$?([\d,.]+)\s*$/;
  const chargesPattern = /^\s+Charges\s+\$?([\d,.]+)/;
  const discountPattern = /^\s+Discount\s+\(([^)]+)\)\s+\(\$?([\d,.]+)\)/;
  const savingsPlanPattern = /^\s+Savings Plan\s+\([^)]+\)\s+\(\$?([\d,.]+)\)/;

  // Known sub-item labels to skip (not service names)
  const subItemLabels = new Set([
    'charges', 'discount', 'savings plan', 'vat', 'gst', 'ct',
    'estimated us sales tax', 'credits', 'tax',
  ]);

  let currentEntry: ServiceEntry | null = null;
  let inConsolidatedBill = false;
  let inLinkedAccountSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('Detail for Consolidated Bill')) {
      inConsolidatedBill = true;
      continue;
    }

    // Stop at linked account sections — we only want the consolidated view
    if (line.includes('LINKED ACCOUNT ALLOCATION') || line.includes('Activity By Account')) {
      inLinkedAccountSection = true;
      break;
    }

    if (!inConsolidatedBill) continue;

    // Check sub-item patterns BEFORE the service line pattern,
    // since "Charges $144,208.65" also matches the service line shape.
    if (currentEntry) {
      const chargesMatch = line.match(chargesPattern);
      if (chargesMatch) {
        currentEntry.charges = parseFormattedNumber(chargesMatch[1]);
        continue;
      }

      const discountMatch = line.match(discountPattern);
      if (discountMatch) {
        currentEntry.discounts.push({
          name: discountMatch[1],
          amount: parseFormattedNumber(discountMatch[2]),
        });
        continue;
      }

      const spMatch = line.match(savingsPlanPattern);
      if (spMatch) {
        currentEntry.discounts.push({
          name: 'Savings Plans',
          amount: parseFormattedNumber(spMatch[1]),
        });
        continue;
      }
    }

    // Try to match a service line
    const svcMatch = line.match(serviceLinePattern);
    if (svcMatch) {
      const name = svcMatch[1].trim();
      const amount = parseFormattedNumber(svcMatch[2]);

      // Skip sub-item labels that might match the pattern
      const lowerName = name.toLowerCase();
      if (subItemLabels.has(lowerName) || lowerName.startsWith('discount') ||
          lowerName.startsWith('savings plan') || lowerName.startsWith('vat') ||
          lowerName.startsWith('gst') || lowerName.startsWith('estimated') ||
          lowerName.startsWith('credits') || lowerName === 'ct' ||
          lowerName === 'tax') {
        continue;
      }

      // Save previous entry
      if (currentEntry) {
        entries.push(currentEntry);
      }

      currentEntry = {
        name,
        netTotal: amount,
        charges: 0,
        discounts: [],
      };
      continue;
    }

  }

  // Don't forget the last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

function parseLinkedAccounts(text: string): AccountBreakdown[] {
  const accounts: AccountBreakdown[] = [];
  const lines = text.split('\n');

  // Look for account entries in the "Activity By Account" section
  // Pattern: "account-name (123456789012)                 $amount"
  const accountPattern = /^\s{2,8}(\S.+?)\s+\((\d{12})\)\s+\$?([\d,.]+)/;

  let inAccountSection = false;

  for (const line of lines) {
    if (line.includes('Activity By Account')) {
      inAccountSection = true;
      continue;
    }
    if (inAccountSection && (line.includes('Summary for Linked Account') || line.includes('Detail for Linked Account'))) {
      break;
    }

    if (!inAccountSection) continue;

    const match = line.match(accountPattern);
    if (match) {
      accounts.push({
        accountId: match[2],
        accountName: match[1].trim(),
        amountUsd: parseFormattedNumber(match[3]),
      });
    }
  }

  return accounts;
}

function serviceNameToKey(serviceName: string): string | null {
  const lower = serviceName.toLowerCase();
  if (lower.includes('simple storage service') || lower === 'amazon s3') return 'S3 (Summary)';
  if (lower.includes('s3 glacier deep archive')) return 'Glacier Deep Archive';
  if (lower.includes('s3 glacier flexible')) return 'Glacier Flexible Retrieval';
  if (lower.includes('s3 glacier') || lower.includes('glacier')) return 'Glacier';
  if (lower.includes('data transfer')) return 'Data Transfer';
  if (lower.includes('cloudfront')) return 'CloudFront';
  return null;
}

function parseAccountServiceBreakdowns(text: string, accounts: AccountBreakdown[]): AccountServiceBreakdown[] {
  const breakdowns: AccountServiceBreakdown[] = [];
  const lines = text.split('\n');

  const accountLookup = new Map(accounts.map(a => [a.accountId, a.accountName]));

  const summaryHeaderPattern = /Summary for Linked Account/;
  const accountHeaderPattern = /^\s{2,8}(\S.+?)\s+\((\d{12})\)\s+\$?([\d,.]+)/;
  const serviceLinePattern = /^\s{2,8}(\S.+?)\s{2,}\$?([\d,.]+)\s*$/;
  const detailHeaderPattern = /Detail for Linked Account/;

  const subItemLabels = new Set([
    'charges', 'discount', 'savings plan', 'vat', 'gst', 'ct',
    'estimated us sales tax', 'credits', 'tax',
  ]);

  let currentAccountId = '';
  let currentAccountName = '';
  let inDetailSection = false;
  let inSummarySection = false;

  for (const line of lines) {
    if (summaryHeaderPattern.test(line)) {
      inSummarySection = true;
      inDetailSection = false;
      continue;
    }

    if (inSummarySection) {
      const acctMatch = line.match(accountHeaderPattern);
      if (acctMatch) {
        currentAccountName = acctMatch[1].trim();
        currentAccountId = acctMatch[2];
        if (!accountLookup.has(currentAccountId)) {
          accountLookup.set(currentAccountId, currentAccountName);
        }
      }
    }

    if (detailHeaderPattern.test(line)) {
      inDetailSection = true;
      inSummarySection = false;
      continue;
    }

    if (!inDetailSection || !currentAccountId) continue;

    // End of detail section markers
    if (summaryHeaderPattern.test(line) || line.includes('Account') && line.includes('total allocated')) {
      inDetailSection = false;
      continue;
    }

    const svcMatch = line.match(serviceLinePattern);
    if (svcMatch) {
      const name = svcMatch[1].trim();
      const amount = parseFormattedNumber(svcMatch[2]);
      const lowerName = name.toLowerCase();

      if (subItemLabels.has(lowerName) || lowerName.startsWith('discount') ||
          lowerName.startsWith('savings plan') || lowerName.startsWith('vat') ||
          lowerName.startsWith('gst') || lowerName.startsWith('estimated') ||
          lowerName.startsWith('credits') || lowerName === 'ct' || lowerName === 'tax') {
        continue;
      }

      const serviceKey = serviceNameToKey(name);
      if (serviceKey && amount > 0) {
        breakdowns.push({
          accountId: currentAccountId,
          accountName: accountLookup.get(currentAccountId) || currentAccountId,
          serviceName: name,
          serviceKey,
          costUsd: amount,
        });
      }
    }
  }

  return breakdowns;
}

export function parseAwsSummaryPdf(pdfBuffer: Buffer): ParseResult {
  const text = extractText(pdfBuffer);

  const serviceEntries = parseServiceEntries(text);
  const accounts = parseLinkedAccounts(text);
  const accountServiceBreakdowns = parseAccountServiceBreakdowns(text, accounts);

  const lineItems: ParsedLineItem[] = [];
  const discounts: NamedDiscount[] = [];
  const warnings: string[] = [];

  // Extract billing period
  let billingPeriod = '';
  const periodMatch = text.match(
    /billing period\s+((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s*-\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s*,?\s*\d{4})/i
  );
  if (periodMatch) billingPeriod = periodMatch[1].trim();

  // Extract account ID
  let accountId = '';
  const acctMatch = text.match(/Account\s*(?:number|ID)[:\s]+(\d{12})/i);
  if (acctMatch) accountId = acctMatch[1];

  // Extract grand total
  let grandTotal = 0;
  const totalMatch = text.match(/TOTAL\s+AMOUNT\s+DUE[^\n]*?\$([\d,.]+)/i);
  if (totalMatch) grandTotal = parseFormattedNumber(totalMatch[1]);
  if (!grandTotal) {
    const altTotal = text.match(/Total\s+for\s+this\s+invoice\s+\$?([\d,.]+)/i);
    if (altTotal) grandTotal = parseFormattedNumber(altTotal[1]);
  }

  // Aggregate discounts across all services, tracking storage-specific amounts
  const discountTotals: Record<string, number> = {};
  const storageDiscountTotals: Record<string, number> = {};
  let storageGrossCharges = 0;
  for (const entry of serviceEntries) {
    const { category } = classifyService(entry.name);
    const isStorage = category === 'storage';
    if (isStorage && entry.charges > 0) {
      storageGrossCharges += entry.charges;
    }
    for (const d of entry.discounts) {
      discountTotals[d.name] = (discountTotals[d.name] || 0) + d.amount;
      if (isStorage) {
        storageDiscountTotals[d.name] = (storageDiscountTotals[d.name] || 0) + d.amount;
      }
    }
  }
  for (const [name, amount] of Object.entries(discountTotals)) {
    if (amount > 0) {
      const storageAmount = storageDiscountTotals[name] || 0;
      discounts.push({
        name,
        amountUsd: amount,
        storageAmountUsd: storageAmount || undefined,
        storageGrossCharges: storageAmount > 0 ? storageGrossCharges : undefined,
        estimatedPercent: storageGrossCharges > 0 && storageAmount > 0
          ? Math.round((storageAmount / storageGrossCharges) * 1000) / 10
          : undefined,
      });
    }
  }

  // Create line items for storage-relevant services
  for (const entry of serviceEntries) {
    if (entry.netTotal === 0 && entry.charges === 0) continue;

    const { category, subcategory, storageClass } = classifyService(entry.name);

    // Only create line items for storage-relevant categories
    if (category === 'out-of-scope') continue;

    const costForEstimate = entry.charges > 0 ? entry.charges : entry.netTotal;
    const estimatedGb = category === 'storage' ? estimateStorageGb(costForEstimate, storageClass) : undefined;

    const serviceDiscounts = entry.discounts.map(d => `${d.name}: -$${d.amount.toLocaleString()}`).join(', ');
    let description = `Net: $${entry.netTotal.toLocaleString()}`;
    if (entry.charges !== entry.netTotal) {
      description += ` (Charges: $${entry.charges.toLocaleString()}`;
      if (serviceDiscounts) description += `, ${serviceDiscounts}`;
      description += ')';
    }

    lineItems.push({
      id: uuid(),
      provider: 'aws',
      service: entry.name,
      region: 'All Regions',
      sku: 'SUMMARY',
      description,
      category,
      subcategory,
      storageClass,
      unitRate: undefined,
      usageQuantity: estimatedGb,
      usageUnit: estimatedGb ? 'GB-Mo' : undefined,
      costUsd: entry.netTotal,
      isEstimate: true,
      isEdited: false,
    });
  }

  warnings.push(
    'This is a summary invoice without per-SKU detail. Storage quantities are estimated from total cost using list pricing. For accurate analysis, request the detailed billing export (Cost & Usage Report) from AWS.'
  );

  if (lineItems.length === 0) {
    warnings.push('No storage-related services found in the summary invoice.');
  }

  const parsedTotal = lineItems.reduce((sum, item) => sum + item.costUsd, 0);

  return {
    provider: 'aws',
    billType: 'summary-invoice',
    billingPeriod,
    accountId,
    detectionSignals: [],
    parsedBill: {
      lineItems,
      accounts: accounts.length > 0 ? accounts : undefined,
      accountServiceBreakdowns: accountServiceBreakdowns.length > 0 ? accountServiceBreakdowns : undefined,
      grandTotal: grandTotal || parsedTotal,
      parseConfidence: 0.5,
      warnings,
      discounts: discounts.length > 0 ? discounts : undefined,
    },
  };
}

export function isSummaryInvoice(pdfBuffer: Buffer): boolean {
  const tmpPath = join(tmpdir(), `detect-${Date.now()}.pdf`);
  try {
    writeFileSync(tmpPath, pdfBuffer);
    const text = execSync(`pdftotext -layout "${tmpPath}" - | head -500`, {
      maxBuffer: 10 * 1024 * 1024,
    }).toString('utf-8');

    const hasConsolidatedBill = /Detail for Consolidated Bill/i.test(text);
    const hasInvoiceSummary = /Invoice Summary/i.test(text);
    const hasSkuCodes = /[A-Z]{2,4}\d?-TimedStorage|[A-Z]{2,4}\d?-Requests-Tier/i.test(text);

    return (hasConsolidatedBill || hasInvoiceSummary) && !hasSkuCodes;
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}
