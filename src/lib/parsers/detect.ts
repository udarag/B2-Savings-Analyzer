import Papa from 'papaparse';
import type { ParserOptions, ParseResult } from './types';
import { parseGcpCsv } from './gcp-csv';
import { parseAwsDetailPdf } from './aws-detail-pdf';
import { parseAwsSummaryPdf, isSummaryInvoice } from './aws-summary-pdf';
import { parseAwsCostCsv } from './aws-cost-csv';
import { parseGenericTabularCsv } from './generic-csv';
import { transformHeader, resolveColumn } from './csv-utils';
import { detectProviderFromContent } from './provider-detection';

// Trailing currency/unit marker on an AWS cost-export SKU column header, e.g. "($)" / " (USD)".
const COST_COLUMN_SUFFIX = /\s*\((?:\$|usd|eur|gbp|€|£)?\)\s*$/i;

// Decode CSV bytes, honoring a UTF-16 BOM (common from Excel/Sheets "Unicode Text" exports).
// A UTF-16 file decoded as UTF-8 has a NUL between every character, which breaks all header
// detection and yields a misleading "unknown format" error.
function decodeCsv(content: Buffer | string): string {
  if (typeof content === 'string') return content;
  if (content.length >= 2) {
    if (content[0] === 0xff && content[1] === 0xfe) return content.toString('utf16le');
    if (content[0] === 0xfe && content[1] === 0xff) {
      const swapped = Buffer.from(content); // copy so we don't mutate the caller's buffer
      swapped.swap16();
      return swapped.toString('utf16le');
    }
  }
  return content.toString('utf-8');
}

export function detectAndParse(options: ParserOptions): ParseResult {
  const { filename, content, mimeType } = options;
  const lower = filename.toLowerCase();

  // CSV
  if (lower.endsWith('.csv') || mimeType === 'text/csv') {
    return detectCsvProvider(decodeCsv(content));
  }

  // PDF
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    const buffer = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('File does not look like a valid PDF (missing %PDF header).');
    }
    return detectPdfType(buffer);
  }

  // Excel
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseExcel(content);
  }

  throw new Error(`Unsupported file type: ${filename} (${mimeType})`);
}

function detectCsvProvider(text: string): ParseResult {
  const contentDetection = detectProviderFromContent(text);

  // Run a chosen parser but fall through (rather than hard-fail) if it throws, so a near-miss of
  // a known shape still gets a shot at the generic fallback instead of a 422.
  const attempt = (parse: () => ParseResult, signal: string): ParseResult | null => {
    try {
      const result = parse();
      result.detectionSignals = [signal, ...contentDetection.signals];
      return result;
    } catch {
      return null;
    }
  };

  // GCP cost-table CSV has "Service description" and "SKU description" columns
  if (text.includes('Service description') && text.includes('SKU description') && text.includes('SKU ID')) {
    const r = attempt(() => parseGcpCsv(text), 'CSV format: GCP billing export (Service description, SKU description columns)');
    if (r) return r;
  }

  // AWS CUR format
  if (text.includes('lineItem/UsageType') || text.includes('lineItem/BlendedCost')) {
    throw new Error('AWS CUR/Cost Explorer CSV parsing not yet implemented');
  }

  // AWS S3 usage-type cost CSV (pivoted: SKUs as columns, months as rows)
  if (text.includes('Usage type') && text.includes('Total costs($)') && text.includes('TimedStorage')) {
    const r = attempt(() => parseAwsCostCsv(text), 'CSV format: AWS S3 cost export (Usage type, Total costs columns, TimedStorage SKUs)');
    if (r) return r;
  }

  // Alias-based header detection for exports renamed/re-cased enough to miss the literal checks
  // above. Parse only the header row, then match canonical column sets tolerantly.
  const probeFields = (Papa.parse<Record<string, string>>(text, {
    header: true,
    preview: 1,
    transformHeader,
  }).meta.fields) ?? [];
  if (
    resolveColumn(probeFields, ['SKU description', 'SKU desc']) &&
    resolveColumn(probeFields, ['Service description', 'Service'])
  ) {
    const r = attempt(() => parseGcpCsv(text), 'CSV format: GCP billing export (header alias match)');
    if (r) return r;
  }
  if (
    resolveColumn(probeFields, ['Usage type', 'UsageType']) &&
    probeFields.some((h) => COST_COLUMN_SUFFIX.test(h))
  ) {
    const r = attempt(() => parseAwsCostCsv(text), 'CSV format: AWS cost export (header alias match)');
    if (r) return r;
  }

  // Fallback: try content-based detection
  if (contentDetection.confidence > 0.3) {
    if (contentDetection.provider === 'gcp') {
      try {
        const result = parseGcpCsv(text);
        result.detectionSignals = [
          'Content-based detection: GCP (no standard column headers found)',
          ...contentDetection.signals,
        ];
        return result;
      } catch {
        // Fall through
      }
    }
    if (contentDetection.provider === 'aws') {
      try {
        const result = parseAwsCostCsv(text);
        result.detectionSignals = [
          'Content-based detection: AWS (no standard column headers found)',
          ...contentDetection.signals,
        ];
        return result;
      } catch {
        // Fall through
      }
    }
  }

  // Last resort: a guarded generic tabular parse for plausibly-billing CSVs that matched no
  // known shape. Returns null (and we throw) for anything that isn't clearly a billing export.
  const generic = parseGenericTabularCsv(text);
  if (generic) {
    generic.detectionSignals = [
      'CSV format: unrecognized — parsed with the generic tabular fallback (verify categorization)',
      ...contentDetection.signals,
    ];
    return generic;
  }

  throw new Error('Could not detect CSV format. Expected GCP cost-table, AWS cost export, or AWS CUR format.');
}

function detectPdfType(buffer: Buffer): ParseResult {
  if (isSummaryInvoice(buffer)) {
    const result = parseAwsSummaryPdf(buffer);
    result.detectionSignals = [
      'PDF format: AWS summary invoice (no per-SKU detail)',
    ];
    return result;
  }

  const result = parseAwsDetailPdf(buffer);

  // If the detail parser found nothing, try summary parser as fallback
  if (result.parsedBill.lineItems.length === 0) {
    const summaryResult = parseAwsSummaryPdf(buffer);
    if (summaryResult.parsedBill.lineItems.length > 0) {
      summaryResult.detectionSignals = [
        'PDF format: fell back to summary invoice parser (detail parser found 0 items)',
      ];
      return summaryResult;
    }
  }

  result.detectionSignals = [
    'PDF format: parsed as AWS detailed billing statement',
  ];
  return result;
}

function parseExcel(content: Buffer | string): ParseResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheetName = workbook.SheetNames.find((name: string) => {
    const lower = name.toLowerCase();
    return lower.includes('cost') || lower.includes('billing') || lower.includes('charge') || lower.includes('usage');
  }) || workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const csvContent = XLSX.utils.sheet_to_csv(sheet);

  const result = detectCsvProvider(csvContent);
  result.detectionSignals = [
    `Excel file: extracted sheet "${sheetName}" as CSV`,
    ...(result.detectionSignals || []),
  ];
  return result;
}
