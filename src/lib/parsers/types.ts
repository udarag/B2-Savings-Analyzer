import type { ParsedBill, BillType, Provider } from '@/types/analysis';

/** Output of a single parser run: the extracted bill plus how it was detected. */
export interface ParseResult {
  provider: Provider;
  billType: BillType;
  billingPeriod?: string;
  accountId?: string;
  /** Human-readable trail of which format/heuristic matched, surfaced in the internal parse review. */
  detectionSignals: string[];
  parsedBill: ParsedBill;
}

/** Input to `detectAndParse`: the raw upload plus the hints used to pick a parser. */
export interface ParserOptions {
  filename: string;
  /** Raw upload bytes (PDF/Excel) or already-decoded text; `decodeCsv` handles BOM/UTF-16 for CSVs. */
  content: Buffer | string;
  mimeType: string;
}
