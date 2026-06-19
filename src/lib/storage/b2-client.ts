import { S3Client } from '@aws-sdk/client-s3';

let client: S3Client | null = null;

export function getB2Client(): S3Client {
  if (client) return client;

  const endpoint = process.env.B2_ENDPOINT;
  const region = process.env.B2_REGION || 'us-west-004';
  const keyId = process.env.B2_KEY_ID;
  const appKey = process.env.B2_APP_KEY;

  if (!endpoint || !keyId || !appKey) {
    throw new Error(
      'Missing B2 credentials. Set B2_ENDPOINT, B2_KEY_ID, and B2_APP_KEY environment variables.'
    );
  }

  client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: appKey,
    },
    forcePathStyle: true,
  });

  return client;
}

export function getBucketName(): string {
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) {
    throw new Error('Missing B2_BUCKET_NAME environment variable.');
  }
  return bucket;
}
