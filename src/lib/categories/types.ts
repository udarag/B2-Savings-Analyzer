/**
 * Classifies a GCP storage location label as regional / dual-region / multi-region.
 * The distinction drives durability matching: multi/dual-region GCP data implies a B2 second-region
 * copy (~2x storage) so the migration comparison stays apples-to-apples on geo-redundancy.
 */
export const GCP_LOCATION_TYPES: Record<string, string> = {
  'US Multi-region': 'multi-region',
  'EU Multi-region': 'multi-region',
  'Asia Multi-region': 'multi-region',
  'US Regional': 'regional',
  'Asia Regional': 'regional',
  'Europe Regional': 'regional',
  'US Dual-region': 'dual-region',
  Iowa: 'regional',
  Oregon: 'regional',
  'South Carolina': 'regional',
  'Northern Virginia': 'regional',
  'Los Angeles': 'regional',
  Singapore: 'regional',
  Sydney: 'regional',
  Tokyo: 'regional',
  Mumbai: 'regional',
  Jakarta: 'regional',
  Seoul: 'regional',
  Taiwan: 'regional',
  'Hong Kong': 'regional',
  Finland: 'regional',
  Netherlands: 'regional',
  Belgium: 'regional',
  London: 'regional',
  Frankfurt: 'regional',
  Warsaw: 'regional',
  Zurich: 'regional',
  'Sao Paulo': 'regional',
  Montreal: 'regional',
  Toronto: 'regional',
};

/**
 * Maps the abbreviated region prefixes AWS embeds in usage-type SKUs (e.g. "USE1-TimedStorage…")
 * to canonical region ids. AWS omits the prefix for us-east-1, so a SKU with no code falls back to
 * us-east-1 at the call site — that fallback lives there, not here.
 */
export const AWS_REGION_CODES: Record<string, string> = {
  USE1: 'us-east-1',
  USE2: 'us-east-2',
  USW1: 'us-west-1',
  USW2: 'us-west-2',
  APS1: 'ap-southeast-1',
  APS2: 'ap-southeast-2',
  APS3: 'ap-south-1',
  APN1: 'ap-northeast-1',
  APN2: 'ap-northeast-2',
  APN3: 'ap-northeast-3',
  EUW1: 'eu-west-1',
  EUW2: 'eu-west-2',
  EUW3: 'eu-west-3',
  EUC1: 'eu-central-1',
  EUN1: 'eu-north-1',
  SAE1: 'sa-east-1',
  CAN1: 'ca-central-1',
  MES1: 'me-south-1',
  AFS1: 'af-south-1',
  APE1: 'ap-east-1',
  APS4: 'ap-southeast-3',
  APS5: 'ap-south-2',
  EUS1: 'eu-south-1',
  CPH1: 'eu-north-2',
  AKL1: 'ap-southeast-5',
  PER1: 'ap-southeast-4',
  APE2: 'ap-east-2',
};

/**
 * Maps AWS S3 TimedStorage usage-type tokens to a human storage-class name. Several distinct SKUs
 * collapse to one class on purpose: e.g. the "-SmObjects" small-object variants bill separately but
 * are the same tier, and staging SKUs name the Glacier tier they stage for.
 */
export const AWS_SKU_STORAGE_CLASS: Record<string, string> = {
  'TimedStorage-ByteHrs': 'Standard',
  'TimedStorage-SIA-ByteHrs': 'Standard-IA',
  'TimedStorage-SIA-SmObjects': 'Standard-IA',
  'TimedStorage-ZIA-ByteHrs': 'One Zone-IA',
  'TimedStorage-ZIA-SmObjects': 'One Zone-IA',
  'TimedStorage-INT-FA-ByteHrs': 'Intelligent-Tiering-FA',
  'TimedStorage-INT-IA-ByteHrs': 'Intelligent-Tiering-IA',
  'TimedStorage-INT-AIA-ByteHrs': 'Intelligent-Tiering-AIA',
  'TimedStorage-INT-AA-ByteHrs': 'Intelligent-Tiering-AA',
  'TimedStorage-INT-DAA-ByteHrs': 'Intelligent-Tiering-DAA',
  'TimedStorage-GIR-ByteHrs': 'Glacier Instant Retrieval',
  'TimedStorage-GIR-SmObjects': 'Glacier Instant Retrieval',
  'TimedStorage-GlacierByteHrs': 'Glacier Flexible Retrieval',
  'TimedStorage-GlacierStaging': 'Glacier Staging',
  'TimedStorage-GDA-ByteHrs': 'Glacier Deep Archive',
  'TimedStorage-GDA-Staging': 'GDA Staging',
  'TimedStorage-XZ-ByteHrs': 'Express One Zone',
  'TimedStorage-RRS-ByteHrs': 'Reduced Redundancy',
};
