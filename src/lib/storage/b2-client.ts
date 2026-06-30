import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';

// Memoized so every storage call reuses one client (and its connection pool)
// rather than re-reading env and re-handshaking per request.
let client: S3Client | null = null;

/**
 * Returns the shared S3 client pointed at Backblaze B2's S3-compatible API.
 * Throws (rather than constructing a half-configured client) when credentials
 * are absent, so the caller can surface a clear config error.
 */
export function getB2Client(): S3Client {
  if (client) return client;

  const endpoint = process.env.B2_ENDPOINT;
  // Region must match the B2 endpoint's region; us-west-004 is the default B2 cluster.
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
    // B2 serves bucket-in-path URLs, not the virtual-hosted bucket.endpoint style
    // the SDK defaults to; without this, every request 404s.
    forcePathStyle: true,
    // Bound every B2 request so a stalled connection (e.g. a transient network/B2 hiccup)
    // fails fast instead of hanging indefinitely. Without this the default handler has no
    // socket timeout, so a stuck read leaves API routes pending forever and the UI spins with
    // no error. On timeout the storage layer classifies it into a safe JSON error and the
    // client surfaces a retryable "couldn't load" state. Bounded by maxAttempts (default 3),
    // worst case stays under the client-side 60s load timeout.
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      requestTimeout: 15_000,
    }),
  });

  return client;
}

/** Bucket all analyzer objects live under. Throws if unset so storage fails loudly, not silently. */
export function getBucketName(): string {
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) {
    throw new Error('Missing B2_BUCKET_NAME environment variable.');
  }
  return bucket;
}
