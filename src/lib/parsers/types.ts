import type { ParsedBill, BillType, Provider } from '@/types/analysis';

export interface ParseResult {
  provider: Provider;
  billType: BillType;
  billingPeriod?: string;
  accountId?: string;
  detectionSignals: string[];
  parsedBill: ParsedBill;
}

export interface ParserOptions {
  filename: string;
  content: Buffer | string;
  mimeType: string;
}
