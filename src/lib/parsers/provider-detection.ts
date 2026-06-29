// Content-based provider detection: a fallback for when the column-header checks in detect.ts can't
// identify the export. Each provider has a table of regex "signals" with weights — the more specific
// and exclusive a marker (e.g. an AWS SKU prefix or a GCP-only storage class), the higher its weight
// — and the provider with the highest summed score wins. This is a best-effort hint, not ground
// truth; the result only steers parser selection and is shown to the AE as a detection signal.
import type { Provider } from '@/types/analysis';

interface DetectionResult {
  provider: Provider;
  /** 0–1 hint strength, not a probability; see the `/ 10` saturation in `detectProviderFromContent`. */
  confidence: number;
  signals: string[];
}

interface SignalDef {
  pattern: RegExp;
  label: string;
  /** Higher = more exclusive to this provider; ~3 for near-unique SKU/redundancy markers, 1 for generic brand mentions. */
  weight: number;
}

const AWS_SIGNALS: SignalDef[] = [
  // Storage tier SKU patterns (highly specific to AWS)
  { pattern: /TimedStorage-ByteHrs/i, label: 'S3 Standard storage SKU', weight: 3 },
  { pattern: /TimedStorage-SIA/i, label: 'S3 Standard-IA storage SKU', weight: 3 },
  { pattern: /TimedStorage-ZIA/i, label: 'S3 One Zone-IA storage SKU', weight: 3 },
  { pattern: /TimedStorage-INT-FA/i, label: 'S3 Intelligent-Tiering (Frequent Access) SKU', weight: 3 },
  { pattern: /TimedStorage-INT-IA/i, label: 'S3 Intelligent-Tiering (Infrequent Access) SKU', weight: 3 },
  { pattern: /TimedStorage-INT-AIA/i, label: 'S3 Intelligent-Tiering (Archive Instant) SKU', weight: 3 },
  { pattern: /TimedStorage-GIR/i, label: 'S3 Glacier Instant Retrieval SKU', weight: 3 },
  { pattern: /TimedStorage-GlacierByteHrs/i, label: 'S3 Glacier Flexible Retrieval SKU', weight: 3 },
  { pattern: /TimedStorage-GDA/i, label: 'S3 Glacier Deep Archive SKU', weight: 3 },
  { pattern: /TimedStorage-XZ/i, label: 'S3 Express One Zone SKU', weight: 3 },
  { pattern: /TimedStorage-RRS/i, label: 'S3 Reduced Redundancy SKU', weight: 3 },

  // Storage class display names
  { pattern: /Intelligent.Tiering/i, label: 'Intelligent-Tiering storage class', weight: 2 },
  { pattern: /Standard.IA\b/i, label: 'Standard-IA storage class', weight: 2 },
  { pattern: /One.Zone.IA/i, label: 'One Zone-IA storage class', weight: 2 },
  { pattern: /Glacier Instant Retrieval/i, label: 'Glacier Instant Retrieval class', weight: 2 },
  { pattern: /Glacier Flexible Retrieval/i, label: 'Glacier Flexible Retrieval class', weight: 2 },
  { pattern: /Glacier Deep Archive/i, label: 'Glacier Deep Archive class', weight: 2 },

  // AWS service names
  { pattern: /Amazon Simple Storage Service/i, label: 'Amazon S3 service name', weight: 3 },
  { pattern: /Amazon S3/i, label: 'Amazon S3 reference', weight: 2 },
  { pattern: /AWS Data Transfer/i, label: 'AWS Data Transfer service', weight: 2 },

  // AWS region codes in SKUs (e.g., USW2-, USE1-, APS1-)
  { pattern: /\b(USW[12]|USE[12]|APS[1-5]|APN[1-3]|EUW[1-3]|EUC1|EUN1|SAE1|CAN1|MES1|AFS1)-/i, label: 'AWS region code in SKU', weight: 2 },

  // AWS egress patterns
  { pattern: /DataTransfer-Out-Bytes/i, label: 'AWS egress SKU pattern', weight: 2 },
  { pattern: /CloudFront-Out-Bytes/i, label: 'CloudFront egress SKU', weight: 2 },

  // AWS billing columns
  { pattern: /lineItem\/UsageType/i, label: 'AWS CUR column format', weight: 3 },
  { pattern: /lineItem\/BlendedCost/i, label: 'AWS CUR blended cost column', weight: 3 },

  // AWS request patterns
  { pattern: /Requests-Tier[12]/i, label: 'AWS S3 request tier SKU', weight: 2 },
  { pattern: /Monitoring-Automation/i, label: 'S3 Intelligent-Tiering monitoring SKU', weight: 2 },
];

const GCP_SIGNALS: SignalDef[] = [
  // GCP-exclusive storage class names
  { pattern: /\bNearline\b/i, label: 'Nearline storage class (GCP-exclusive)', weight: 3 },
  { pattern: /\bColdline\b/i, label: 'Coldline storage class (GCP-exclusive)', weight: 3 },

  // GCP CSV column headers
  { pattern: /Service description/i, label: 'GCP billing export column', weight: 2 },
  { pattern: /SKU description/i, label: 'GCP SKU description column', weight: 2 },
  { pattern: /SKU ID/i, label: 'GCP SKU ID column', weight: 2 },
  { pattern: /Savings programs \(\$\)/i, label: 'GCP savings programs column', weight: 2 },

  // GCP service names
  { pattern: /Cloud Storage/i, label: 'GCP Cloud Storage service name', weight: 2 },
  { pattern: /Google Cloud/i, label: 'Google Cloud reference', weight: 1 },

  // GCP units
  { pattern: /gibibyte month/i, label: 'GCP gibibyte month unit', weight: 2 },
  { pattern: /\bgibibyte\b/i, label: 'GCP gibibyte unit', weight: 1 },

  // GCP operation types
  { pattern: /Class A Operations?/i, label: 'GCP Class A operations', weight: 2 },
  { pattern: /Class B Operations?/i, label: 'GCP Class B operations', weight: 2 },

  // GCP location patterns
  { pattern: /Multi-region/i, label: 'GCP Multi-region location type', weight: 1 },
  { pattern: /Dual-region/i, label: 'GCP Dual-region location type', weight: 2 },
];

const AZURE_SIGNALS: SignalDef[] = [
  // Azure-exclusive access tier names
  { pattern: /\bHot\s+(?:Access\s+)?Tier/i, label: 'Azure Hot access tier', weight: 2 },
  { pattern: /\bCool\s+(?:Access\s+)?Tier/i, label: 'Azure Cool access tier', weight: 2 },
  { pattern: /\bCold\s+(?:Access\s+)?Tier/i, label: 'Azure Cold access tier (Azure-exclusive)', weight: 3 },

  // Azure redundancy types (highly specific)
  { pattern: /\bLRS\b/, label: 'Azure LRS redundancy', weight: 3 },
  { pattern: /\bZRS\b/, label: 'Azure ZRS redundancy', weight: 3 },
  { pattern: /\bGRS\b/, label: 'Azure GRS redundancy', weight: 3 },
  { pattern: /\bRA-GRS\b/, label: 'Azure RA-GRS redundancy', weight: 3 },
  { pattern: /\bGZRS\b/, label: 'Azure GZRS redundancy', weight: 3 },
  { pattern: /\bRA-GZRS\b/, label: 'Azure RA-GZRS redundancy', weight: 3 },

  // Azure blob types
  { pattern: /Block Blob/i, label: 'Azure Block Blob type', weight: 3 },
  { pattern: /Page Blob/i, label: 'Azure Page Blob type', weight: 3 },
  { pattern: /Append Blob/i, label: 'Azure Append Blob type', weight: 3 },

  // Azure service names
  { pattern: /Azure Blob Storage/i, label: 'Azure Blob Storage service name', weight: 3 },
  { pattern: /Azure Data Lake/i, label: 'Azure Data Lake Storage reference', weight: 3 },
  { pattern: /Microsoft Azure/i, label: 'Microsoft Azure reference', weight: 2 },
  { pattern: /Azure Storage/i, label: 'Azure Storage service', weight: 2 },

  // Azure region names
  { pattern: /\b(?:East US|West US|North Europe|West Europe|Southeast Asia)\b/i, label: 'Azure region name', weight: 1 },

  // Azure billing columns
  { pattern: /MeterCategory/i, label: 'Azure billing MeterCategory column', weight: 3 },
  { pattern: /MeterSubCategory/i, label: 'Azure billing MeterSubCategory column', weight: 3 },
  { pattern: /ResourceGroup/i, label: 'Azure billing ResourceGroup column', weight: 2 },
  { pattern: /SubscriptionId/i, label: 'Azure SubscriptionId column', weight: 2 },

  // Azure-specific operations
  { pattern: /Write Operations.*(?:Hot|Cool|Cold|Archive)/i, label: 'Azure tier-specific write operations', weight: 2 },
  { pattern: /Read Operations.*(?:Hot|Cool|Cold|Archive)/i, label: 'Azure tier-specific read operations', weight: 2 },
  { pattern: /Data Retrieval.*(?:Cool|Cold|Archive)/i, label: 'Azure tier retrieval fee', weight: 2 },
];

const R2_SIGNALS: SignalDef[] = [
  // R2-specific identifiers
  { pattern: /Cloudflare R2/i, label: 'Cloudflare R2 service name', weight: 3 },
  { pattern: /\bR2\b.*(?:Storage|Bucket|Object)/i, label: 'R2 storage reference', weight: 2 },
  { pattern: /Workers.*R2/i, label: 'Cloudflare Workers R2 binding', weight: 3 },

  // Cloudflare billing
  { pattern: /Cloudflare/i, label: 'Cloudflare reference', weight: 1 },
  { pattern: /Class A Operations.*R2/i, label: 'R2 Class A operations', weight: 3 },
  { pattern: /Class B Operations.*R2/i, label: 'R2 Class B operations', weight: 3 },
];

interface ProviderScore {
  provider: Provider;
  score: number;
  signals: string[];
}

/**
 * Score the raw bill text against every provider's signal table and return the best match with the
 * signals that fired. With no signals at all, defaults to AWS (the most common upload) at confidence
 * 0 so callers can tell a default apart from a real match.
 */
export function detectProviderFromContent(text: string): DetectionResult {
  const providers: ProviderScore[] = [
    { provider: 'aws', score: 0, signals: [] },
    { provider: 'gcp', score: 0, signals: [] },
    { provider: 'azure', score: 0, signals: [] },
    { provider: 'r2', score: 0, signals: [] },
  ];

  const signalSets: [SignalDef[], number][] = [
    [AWS_SIGNALS, 0],
    [GCP_SIGNALS, 1],
    [AZURE_SIGNALS, 2],
    [R2_SIGNALS, 3],
  ];

  for (const [signals, idx] of signalSets) {
    for (const signal of signals) {
      if (signal.pattern.test(text)) {
        providers[idx].score += signal.weight;
        providers[idx].signals.push(signal.label);
      }
    }
  }

  providers.sort((a, b) => b.score - a.score);
  const best = providers[0];

  if (best.score === 0) {
    return {
      provider: 'aws',
      confidence: 0,
      signals: ['No provider-specific signals detected — defaulting to AWS'],
    };
  }

  return {
    provider: best.provider,
    // Saturate at a score of 10 (~3-4 strong signals) so a heavily-matched bill maxes out at 1.0;
    // detectCsvProvider only trusts this path above a 0.3 confidence threshold.
    confidence: Math.min(1, best.score / 10),
    signals: best.signals,
  };
}
