import type { Category } from '@/types/analysis';

export interface S3SuffixClassification {
  category: Category;
  subcategory?: string;
  storageClass?: string;
}

// The S3 usage-type suffix patterns the detailed-PDF and cost-CSV parsers classify
// identically: request tiers, per-class request charges, and per-class retrieval.
// The region prefix is expected to be already stripped by the caller. Returns null
// for anything outside this shared set so each parser keeps applying its own
// format-specific rules (e.g. the PDF's rate-description "glacier instant"
// fallback, early-deletion handling, or CSV-only Tier4/S3RTC/Metadata SKUs).
export function classifyS3Suffix(suffix: string): S3SuffixClassification | null {
  if (suffix.startsWith('Requests-Tier1') || suffix.startsWith('Requests-INT-Tier1')) {
    return { category: 'operations', subcategory: 'PUT/COPY/POST/LIST' };
  }
  if (suffix.startsWith('Requests-Tier2') || suffix.startsWith('Requests-INT-Tier2')) {
    return { category: 'operations', subcategory: 'GET/SELECT' };
  }
  if (suffix.startsWith('Requests-SIA')) {
    return { category: 'operations', subcategory: 'Standard-IA Requests', storageClass: 'Standard-IA' };
  }
  if (suffix.startsWith('Requests-ZIA')) {
    return { category: 'operations', subcategory: 'One Zone-IA Requests', storageClass: 'One Zone-IA' };
  }
  if (suffix.startsWith('Requests-GDA')) {
    return { category: 'operations', subcategory: 'Glacier Deep Archive Requests', storageClass: 'Glacier Deep Archive' };
  }
  if (suffix.startsWith('Requests-GIR')) {
    return { category: 'operations', subcategory: 'Glacier IR Requests', storageClass: 'Glacier Instant Retrieval' };
  }
  if (suffix.includes('Retrieval-SIA')) {
    return { category: 'retrieval', storageClass: 'Standard-IA' };
  }
  if (suffix.includes('Retrieval-ZIA')) {
    return { category: 'retrieval', storageClass: 'One Zone-IA' };
  }
  if (suffix.includes('Retrieval-GIR')) {
    return { category: 'retrieval', storageClass: 'Glacier Instant Retrieval' };
  }
  return null;
}
