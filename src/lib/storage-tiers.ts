import type { Provider } from '@/types/analysis';

const AWS_STORAGE_CLASSES_URL = 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html';
const AWS_INTELLIGENT_TIERING_URL = 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/intelligent-tiering-overview.html';
const GCP_STORAGE_CLASSES_URL = 'https://cloud.google.com/storage/docs/storage-classes';
const AZURE_ACCESS_TIERS_URL = 'https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview';
const R2_PRICING_URL = 'https://developers.cloudflare.com/r2/pricing/';

const STORAGE_TIER_DISPLAY_NAMES: Record<string, string> = {
  'S3 (Summary)': 'Standard',
  'Intelligent-Tiering-FA': 'Intelligent-Tiering Frequent',
  'Intelligent-Tiering-IA': 'Intelligent-Tiering Infrequent',
  'Intelligent-Tiering-AIA': 'Intelligent-Tiering Archive Instant',
  'Intelligent-Tiering-AA': 'Intelligent-Tiering Archive',
  'Intelligent-Tiering-DAA': 'Intelligent-Tiering Deep Archive',
};

export interface StorageTierHelp {
  description: string;
  docsUrl: string;
}

export function formatStorageTierName(storageClass: string): string {
  return STORAGE_TIER_DISPLAY_NAMES[storageClass] || storageClass;
}

export function getStorageTierHelp(
  storageClass: string,
  provider?: Provider,
): StorageTierHelp {
  if (provider === 'gcp') return getGcpTierHelp(storageClass);
  if (provider === 'azure') return getAzureTierHelp(storageClass);
  if (provider === 'r2') return getR2TierHelp(storageClass);
  return getAwsTierHelp(storageClass);
}

function getAwsTierHelp(storageClass: string): StorageTierHelp {
  const intelligentTieringUrl = AWS_INTELLIGENT_TIERING_URL;

  const help: Record<string, StorageTierHelp> = {
    Standard: {
      description: 'AWS S3 hot storage for active data. Millisecond access, no retrieval fee, highest storage price among common S3 object tiers.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    'S3 (Summary)': {
      description: 'AWS S3 Standard shown from a summary bill. Treat as hot, frequently accessed object storage unless the bill breaks out colder tiers separately.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    'Standard-IA': {
      description: 'AWS S3 Infrequent Access across multiple Availability Zones. Still millisecond access, but retrieval fees and minimum-duration behavior can apply.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    'One Zone-IA': {
      description: 'AWS S3 Infrequent Access stored in one Availability Zone. Lower cost than Standard-IA, but not resilient to losing that AZ.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    'Glacier Instant Retrieval': {
      description: 'AWS archive tier for rarely accessed data that still needs millisecond retrieval. Lower storage cost, retrieval fees and minimum duration apply.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    'Glacier Flexible Retrieval': {
      description: 'AWS archive storage where objects must be restored before use. Retrieval typically takes minutes to hours, so it is not hot application data.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    Glacier: {
      description: 'AWS Glacier-style archive storage. In this analyzer it is treated like Glacier Flexible Retrieval unless the bill gives a more specific class.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    'Glacier Deep Archive': {
      description: 'AWS lowest-cost deep archive class for data accessed very rarely. Restore is hours-scale and minimum-duration charges can apply.',
      docsUrl: AWS_STORAGE_CLASSES_URL,
    },
    'Intelligent-Tiering-FA': {
      description: 'AWS S3 Intelligent-Tiering Frequent Access. This is the hot/current access tier where objects start or return when accessed.',
      docsUrl: intelligentTieringUrl,
    },
    'Intelligent-Tiering-IA': {
      description: 'AWS S3 Intelligent-Tiering Infrequent Access. Objects move here automatically after no access for about 30 days; still online, no retrieval fee.',
      docsUrl: intelligentTieringUrl,
    },
    'Intelligent-Tiering-AIA': {
      description: 'AWS S3 Intelligent-Tiering Archive Instant Access. Objects move here after longer inactivity; lower storage cost while keeping instant access.',
      docsUrl: intelligentTieringUrl,
    },
    'Intelligent-Tiering-AA': {
      description: 'AWS S3 Intelligent-Tiering optional Archive Access. Data is asynchronous archive; restore is required before application reads.',
      docsUrl: intelligentTieringUrl,
    },
    'Intelligent-Tiering-DAA': {
      description: 'AWS S3 Intelligent-Tiering optional Deep Archive Access. Deep archive for long-dormant data; restore is required before reads.',
      docsUrl: intelligentTieringUrl,
    },
  };

  return help[storageClass] || {
    description: 'AWS storage class detected from the bill. Check the AWS storage class docs for exact retrieval, durability, and minimum-duration behavior.',
    docsUrl: AWS_STORAGE_CLASSES_URL,
  };
}

function getGcpTierHelp(storageClass: string): StorageTierHelp {
  const help: Record<string, string> = {
    Standard: 'Google Cloud Storage hot storage for frequently accessed data or short-lived data. No retrieval fee or minimum storage duration.',
    Nearline: 'Google Cloud Storage lower-cost tier for data read or modified about once a month or less. Retrieval fees and a 30-day minimum can apply.',
    Coldline: 'Google Cloud Storage colder tier for data read or modified about once a quarter or less. Retrieval fees and a 90-day minimum can apply.',
    Archive: 'Google Cloud Storage lowest-cost archive tier for data accessed less than once a year. It remains online, but retrieval fees and a 365-day minimum can apply.',
  };

  return {
    description: help[storageClass] || 'Google Cloud Storage class detected from the bill. Check the GCP docs for exact retrieval and minimum-duration behavior.',
    docsUrl: GCP_STORAGE_CLASSES_URL,
  };
}

function getAzureTierHelp(storageClass: string): StorageTierHelp {
  if (storageClass.startsWith('Hot-')) {
    return {
      description: 'Azure Blob hot access tier. Best for active data with frequent reads or writes; highest storage cost, lowest access cost.',
      docsUrl: AZURE_ACCESS_TIERS_URL,
    };
  }

  if (storageClass.startsWith('Cool-')) {
    return {
      description: 'Azure Blob cool access tier. Online storage for infrequently accessed data; lower storage cost, higher access cost, 30-day minimum.',
      docsUrl: AZURE_ACCESS_TIERS_URL,
    };
  }

  if (storageClass.startsWith('Cold-')) {
    return {
      description: 'Azure Blob cold access tier. Online storage for rarely accessed data that still needs fast retrieval; 90-day minimum.',
      docsUrl: AZURE_ACCESS_TIERS_URL,
    };
  }

  if (storageClass.startsWith('Archive-')) {
    return {
      description: 'Azure Blob archive access tier. Offline archive storage; data must be rehydrated before reads and can take hours to access.',
      docsUrl: AZURE_ACCESS_TIERS_URL,
    };
  }

  return {
    description: 'Azure Blob storage tier detected from the bill. Check Microsoft docs for access, retrieval, redundancy, and minimum-duration behavior.',
    docsUrl: AZURE_ACCESS_TIERS_URL,
  };
}

function getR2TierHelp(storageClass: string): StorageTierHelp {
  const isInfrequent = storageClass.toLowerCase().includes('infrequent');

  return {
    description: isInfrequent
      ? 'Cloudflare R2 Infrequent Access. Lower storage cost than Standard, but retrieval and higher operation costs can apply; egress remains free.'
      : 'Cloudflare R2 Standard storage. General-purpose object storage with free egress and separate operation charges.',
    docsUrl: R2_PRICING_URL,
  };
}
