// Backend-agnostic storage facade for the analyzer. Each public function routes to the
// Postgres backend (postgres.ts) when DATABASE_URL is configured, and otherwise to the
// B2 object store via the low-level helpers below. Uploaded bill bytes always live in B2
// even in DB mode — Postgres only holds metadata and the JSON artifacts.
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getB2Client, getBucketName } from './b2-client';
import {
  deleteDatabaseAnalysis,
  getDatabaseAnalysisMeta,
  getDatabaseB2Usage,
  getDatabaseModelConfig,
  getDatabaseParsedBill,
  getDatabaseUserProfile,
  getLatestDatabaseSnapshot,
  getLatestDatabaseUpload,
  hasDatabaseB2Usage,
  hasDatabaseParsedBill,
  isDatabaseStorageEnabled,
  listDatabaseAnalyses,
  listDatabaseReportSnapshots,
  recordDatabaseUpload,
  saveDatabaseAnalysisMeta,
  saveDatabaseB2Usage,
  saveDatabaseModelConfig,
  saveDatabaseParsedBill,
  saveDatabaseReportSnapshot,
  saveDatabaseUserProfile,
} from './postgres';
import type { Analysis, ParsedBill, ModelConfig, B2UsageInput } from '@/types/analysis';
import type { ReportSnapshot } from '@/types/model';
import {
  parseStoredAnalysis,
  parseStoredParsedBill,
  parseStoredModelConfig,
  parseStoredB2Usage,
  parseStoredSnapshot,
  safeJsonParse,
  isRecord,
} from './validate';

interface ListedObject {
  key: string;
  lastModified?: Date;
}

/**
 * Classified storage failure for the API layer to turn into an HTTP response.
 * status is 503 for transient (retryable) faults and 500 for config/other faults.
 * message is operator-safe and deliberately generic — never leak it into customer-facing output.
 */
export interface StorageErrorDetails {
  status: 500 | 503;
  code:
    | 'storage_config_error'
    | 'storage_unavailable'
    | 'storage_error'
    | 'database_config_error'
    | 'database_unavailable';
  message: string;
}

/** An uploaded bill retrieved from storage: original filename, raw bytes, and content type. */
export interface StoredUpload {
  filename: string;
  content: Buffer;
  contentType: string;
}

// The low-level helpers below treat a missing object as null/false (a normal "not found"
// outcome) and only rethrow genuine errors, so callers can branch on absence without try/catch.
async function getObject(key: string): Promise<string | null> {
  try {
    const res = await getB2Client().send(
      new GetObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return (await res.Body?.transformToString()) ?? null;
  } catch (e: unknown) {
    if (isMissingObjectError(e)) return null;
    throw e;
  }
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await getB2Client().send(
      new HeadObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return true;
  } catch (e: unknown) {
    if (isMissingObjectError(e)) return false;
    throw e;
  }
}

async function putObject(key: string, body: string, contentType = 'application/json') {
  await getB2Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

async function putBinaryObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  await getB2Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

async function getBinaryObject(key: string): Promise<{ body: Buffer; contentType?: string } | null> {
  try {
    const res = await getB2Client().send(
      new GetObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    const body = res.Body ? Buffer.from(await res.Body.transformToByteArray()) : Buffer.alloc(0);
    return { body, contentType: res.ContentType };
  } catch (e: unknown) {
    if (isMissingObjectError(e)) return null;
    throw e;
  }
}

async function deleteObject(key: string) {
  await getB2Client().send(
    new DeleteObjectCommand({ Bucket: getBucketName(), Key: key })
  );
}

// Flat list of every object under a prefix, paging through ListObjectsV2's 1000-key limit.
async function listObjects(prefix: string): Promise<ListedObject[]> {
  const objects: ListedObject[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await getB2Client().send(
      new ListObjectsV2Command({
        Bucket: getBucketName(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified });
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

// Lists immediate "subdirectories" under a prefix using a '/' delimiter, so we can enumerate
// analysis folders without fetching every object inside them (cheaper than listObjects + filter).
async function listChildPrefixes(prefix: string): Promise<string[]> {
  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await getB2Client().send(
      new ListObjectsV2Command({
        Bucket: getBucketName(),
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken,
      })
    );
    for (const commonPrefix of res.CommonPrefixes ?? []) {
      if (commonPrefix.Prefix) prefixes.push(commonPrefix.Prefix);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return prefixes;
}

async function listKeys(prefix: string): Promise<string[]> {
  return (await listObjects(prefix)).map((obj) => obj.key);
}

// --- User-scoped helpers ---
// Object keys are namespaced by user email so listings/deletes can't cross tenant boundaries.
// Layout: users/<email>/analyses/<id>/{meta,parsed,model-config}.json, uploads/, snapshots/.

function userPrefix(userEmail: string): string {
  return `users/${userEmail}`;
}

function analysisPath(userEmail: string, id: string): string {
  return `${userPrefix(userEmail)}/analyses/${id}`;
}

// Convenience pointer to the newest snapshot (see getLatestSnapshot) — avoids a list+sort
// on the hot read path by maintaining a single well-known key alongside the snapshots/ folder.
function latestSnapshotPath(userEmail: string, id: string): string {
  return `${analysisPath(userEmail, id)}/latest-snapshot.json`;
}

// --- Analysis CRUD ---

/** Lists a user's analyses, newest first. One unreadable record is skipped, not fatal to the list. */
export async function listAnalyses(userEmail: string): Promise<Analysis[]> {
  if (isDatabaseStorageEnabled()) {
    return listDatabaseAnalyses(userEmail);
  }

  const analysesPrefix = `${userPrefix(userEmail)}/analyses/`;
  // Prefer the cheap delimiter listing to find analysis folders; fall back to a full key scan
  // for legacy buckets where the delimiter listing returns no common prefixes.
  const analysisPrefixes = await listChildPrefixes(analysesPrefix);
  const metaKeys = analysisPrefixes.length > 0
    ? analysisPrefixes.map((prefix) => `${prefix}meta.json`)
    : (await listKeys(analysesPrefix)).filter((k) => k.endsWith('/meta.json'));

  const analyses = (await Promise.all(
    metaKeys.map(async (key) => {
      try {
        const data = await getObject(key);
        return data ? parseStoredAnalysis(data) : null;
      } catch (error) {
        // A single corrupt/inaccessible record shouldn't blank the whole list.
        console.error(`Skipping unreadable analysis metadata at ${key}:`, error);
        return null;
      }
    }),
  )).filter((analysis): analysis is Analysis => analysis !== null);

  return analyses.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Loads one analysis's metadata, or null if it doesn't exist or fails validation. */
export async function getAnalysisMeta(userEmail: string, id: string): Promise<Analysis | null> {
  if (isDatabaseStorageEnabled()) {
    return getDatabaseAnalysisMeta(userEmail, id);
  }

  const data = await getObject(`${analysisPath(userEmail, id)}/meta.json`);
  return data ? parseStoredAnalysis(data) : null;
}

/** Creates or overwrites an analysis's metadata. */
export async function saveAnalysisMeta(userEmail: string, id: string, meta: Analysis): Promise<void> {
  if (isDatabaseStorageEnabled()) {
    await saveDatabaseAnalysisMeta(userEmail, id, meta);
    return;
  }

  await putObject(`${analysisPath(userEmail, id)}/meta.json`, JSON.stringify(meta, null, 2));
}

/** Loads the parsed bill (line items + totals) for an analysis, or null if absent/invalid. */
export async function getParsedBill(userEmail: string, id: string): Promise<ParsedBill | null> {
  if (isDatabaseStorageEnabled()) {
    return getDatabaseParsedBill(userEmail, id);
  }

  const data = await getObject(`${analysisPath(userEmail, id)}/parsed.json`);
  return data ? parseStoredParsedBill(data) : null;
}

/** Cheap existence check for a parsed bill, without fetching/validating its contents. */
export async function hasParsedBill(userEmail: string, id: string): Promise<boolean> {
  if (isDatabaseStorageEnabled()) {
    return hasDatabaseParsedBill(userEmail, id);
  }

  return objectExists(`${analysisPath(userEmail, id)}/parsed.json`);
}

/** Persists the parsed bill for an analysis. */
export async function saveParsedBill(userEmail: string, id: string, parsed: ParsedBill): Promise<void> {
  if (isDatabaseStorageEnabled()) {
    await saveDatabaseParsedBill(userEmail, id, parsed);
    return;
  }

  await putObject(`${analysisPath(userEmail, id)}/parsed.json`, JSON.stringify(parsed, null, 2));
}

/** Loads the saved cost-model config (tier toggles, egress, B2 price, term) for an analysis. */
export async function getModelConfig(userEmail: string, id: string): Promise<ModelConfig | null> {
  if (isDatabaseStorageEnabled()) {
    return getDatabaseModelConfig(userEmail, id);
  }

  const data = await getObject(`${analysisPath(userEmail, id)}/model-config.json`);
  return data ? parseStoredModelConfig(data) : null;
}

/** Persists the cost-model config for an analysis. */
export async function saveModelConfig(userEmail: string, id: string, config: ModelConfig): Promise<void> {
  if (isDatabaseStorageEnabled()) {
    await saveDatabaseModelConfig(userEmail, id, config);
    return;
  }

  await putObject(`${analysisPath(userEmail, id)}/model-config.json`, JSON.stringify(config, null, 2));
}

/** Loads the AE-entered B2 usage input for a commit-upsell analysis, or null if absent/invalid. */
export async function getB2UsageInput(userEmail: string, id: string): Promise<B2UsageInput | null> {
  if (isDatabaseStorageEnabled()) {
    return getDatabaseB2Usage(userEmail, id);
  }

  const data = await getObject(`${analysisPath(userEmail, id)}/b2-usage.json`);
  return data ? parseStoredB2Usage(data) : null;
}

/** Cheap existence check for a saved B2 usage input, without fetching/validating its contents. */
export async function hasB2UsageInput(userEmail: string, id: string): Promise<boolean> {
  if (isDatabaseStorageEnabled()) {
    return hasDatabaseB2Usage(userEmail, id);
  }

  return objectExists(`${analysisPath(userEmail, id)}/b2-usage.json`);
}

/** Persists the B2 usage input for a commit-upsell analysis. */
export async function saveB2UsageInput(userEmail: string, id: string, usage: B2UsageInput): Promise<void> {
  if (isDatabaseStorageEnabled()) {
    await saveDatabaseB2Usage(userEmail, id, usage);
    return;
  }

  await putObject(`${analysisPath(userEmail, id)}/b2-usage.json`, JSON.stringify(usage, null, 2));
}

/**
 * Stores an uploaded bill. Bytes always go to B2; in DB mode we additionally record a
 * pointer row so getLatestUploadedFile can find it without a B2 listing.
 */
export async function uploadFile(
  userEmail: string,
  id: string,
  filename: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  const objectKey = `${analysisPath(userEmail, id)}/uploads/${filename}`;
  await putBinaryObject(objectKey, body, contentType);

  if (isDatabaseStorageEnabled()) {
    await recordDatabaseUpload({
      userEmail,
      analysisId: id,
      filename,
      objectKey,
      contentType,
      sizeBytes: body.byteLength,
    });
  }
}

/**
 * Returns the most recently uploaded bill for an analysis, or null if none.
 * In DB mode it resolves via the pointer row first, then falls through to a B2
 * listing so uploads recorded before DB mode (or with a stale pointer) still resolve.
 */
export async function getLatestUploadedFile(userEmail: string, id: string): Promise<StoredUpload | null> {
  if (isDatabaseStorageEnabled()) {
    const upload = await getLatestDatabaseUpload(userEmail, id);
    if (upload) {
      const data = await getBinaryObject(upload.objectKey);
      if (data) {
        return {
          filename: upload.filename,
          content: data.body,
          contentType: data.contentType || upload.contentType || guessContentType(upload.filename),
        };
      }
    }
  }

  // B2 path (and DB fallback): pick the newest object under uploads/ by last-modified.
  const uploadPrefix = `${analysisPath(userEmail, id)}/uploads/`;
  const uploads = (await listObjects(uploadPrefix))
    .filter((obj) => obj.key !== uploadPrefix) // drop the zero-byte folder-marker object
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));

  const latest = uploads[0];
  if (!latest) return null;

  const data = await getBinaryObject(latest.key);
  if (!data) return null;

  return {
    filename: latest.key.slice(uploadPrefix.length),
    content: data.body,
    contentType: data.contentType || guessContentType(latest.key),
  };
}

/**
 * Deletes an analysis and everything under it. Always clears the B2 objects (where
 * upload bytes live regardless of backend), then the DB rows when in DB mode.
 */
export async function deleteAnalysis(userEmail: string, id: string): Promise<void> {
  const keys = await listKeys(`${analysisPath(userEmail, id)}/`);
  for (const key of keys) {
    await deleteObject(key);
  }

  if (isDatabaseStorageEnabled()) {
    await deleteDatabaseAnalysis(userEmail, id);
  }
}

// --- Snapshots ---

/**
 * Persists a report snapshot. In B2 mode it writes the snapshot twice — once under its
 * id and once to the well-known latest-snapshot key — so the common "load the latest"
 * read is a single GET instead of a list+sort.
 */
export async function saveReportSnapshot(userEmail: string, id: string, snapshot: ReportSnapshot): Promise<void> {
  if (isDatabaseStorageEnabled()) {
    await saveDatabaseReportSnapshot(userEmail, id, snapshot);
    return;
  }

  const body = JSON.stringify(snapshot, null, 2);
  await Promise.all([
    putObject(`${analysisPath(userEmail, id)}/snapshots/${snapshot.id}.json`, body),
    putObject(latestSnapshotPath(userEmail, id), body),
  ]);
}

/** Lists all report snapshots for an analysis, newest first; silently skips unreadable ones. */
export async function listReportSnapshots(userEmail: string, id: string): Promise<ReportSnapshot[]> {
  if (isDatabaseStorageEnabled()) {
    return listDatabaseReportSnapshots(userEmail, id);
  }

  const keys = await listKeys(`${analysisPath(userEmail, id)}/snapshots/`);
  const snapshots: ReportSnapshot[] = [];
  for (const key of keys) {
    const data = await getObject(key);
    if (!data) continue;
    const snapshot = parseStoredSnapshot(data);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Returns the newest report snapshot for an analysis, or null if none.
 * Fast path reads the latest-snapshot pointer; if it's missing (e.g. snapshots
 * written before the pointer existed), it falls back to listing snapshots/ and
 * lazily backfills the pointer for next time.
 */
export async function getLatestSnapshot(userEmail: string, id: string): Promise<ReportSnapshot | null> {
  if (isDatabaseStorageEnabled()) {
    return getLatestDatabaseSnapshot(userEmail, id);
  }

  const latestData = await getObject(latestSnapshotPath(userEmail, id));
  if (latestData) {
    const pointer = parseStoredSnapshot(latestData);
    if (pointer) return pointer;
  }

  const snapshotPrefix = `${analysisPath(userEmail, id)}/snapshots/`;
  const snapshots = (await listObjects(snapshotPrefix))
    .filter((obj) => obj.key !== snapshotPrefix && obj.key.endsWith('.json'))
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));

  const latest = snapshots[0];
  if (!latest) return null;

  const data = await getObject(latest.key);
  if (!data) return null;

  const snapshot = parseStoredSnapshot(data);
  if (!snapshot) return null;
  // Backfill the pointer, but don't await or fail the read on it — it's a best-effort cache write.
  putObject(latestSnapshotPath(userEmail, id), JSON.stringify(snapshot, null, 2)).catch((error) => {
    console.error(`Failed to backfill latest snapshot pointer for ${id}:`, error);
  });
  return snapshot;
}

// --- Pricing ---

/** AE's profile used to personalize the customer-facing report (e.g. the "prepared by" line). */
export interface UserProfile {
  displayName: string;
  title?: string;
}

/** Loads the user's profile, or null if unset or missing the required displayName. */
export async function getUserProfile(userEmail: string): Promise<UserProfile | null> {
  if (isDatabaseStorageEnabled()) {
    return getDatabaseUserProfile(userEmail);
  }

  const data = await getObject(`users/${userEmail}/profile.json`);
  if (!data) return null;
  // displayName is the only hard requirement; title is optional.
  const v = safeJsonParse(data, 'user profile');
  return isRecord(v) && typeof v.displayName === 'string' ? (v as unknown as UserProfile) : null;
}

/** Persists the user's profile. */
export async function saveUserProfile(userEmail: string, profile: UserProfile): Promise<void> {
  if (isDatabaseStorageEnabled()) {
    await saveDatabaseUserProfile(userEmail, profile);
    return;
  }

  await putObject(`users/${userEmail}/profile.json`, JSON.stringify(profile, null, 2));
}

// Pricing tables are global (provider rate cards), not user-scoped, and live in B2 only —
// there's no DB path and no schema validation, so callers must treat the result as unknown.
/** Loads the cached rate card for a provider (e.g. 'aws', 'gcp', 'azure'), or null if none. */
export async function getPricing(provider: string): Promise<unknown> {
  const data = await getObject(`pricing/${provider}.json`);
  return data ? JSON.parse(data) : null;
}

/** Persists a provider's rate card. */
export async function savePricing(provider: string, pricing: unknown): Promise<void> {
  await putObject(`pricing/${provider}.json`, JSON.stringify(pricing, null, 2));
}

/**
 * Maps a thrown storage error to an operator-safe {status, code, message} for the API layer.
 * Order matters: config (non-retryable, 500) is checked before transient (retryable, 503),
 * and database faults before B2 faults, so the most specific cause wins. The returned message
 * is generic by design — it must never carry env-var names, file paths, or internal warnings
 * into anything customer-facing.
 */
export function getStorageErrorDetails(error: unknown): StorageErrorDetails {
  if (isDatabaseConfigError(error)) {
    return {
      status: 500,
      code: 'database_config_error',
      message: 'Database storage is not configured for this environment.',
    };
  }

  if (isTransientDatabaseError(error)) {
    return {
      status: 503,
      code: 'database_unavailable',
      message: 'Database storage is temporarily unavailable. Please retry.',
    };
  }

  if (isStorageConfigError(error)) {
    return {
      status: 500,
      code: 'storage_config_error',
      message: 'Storage is not configured for this environment.',
    };
  }

  if (isTransientStorageError(error)) {
    return {
      status: 503,
      code: 'storage_unavailable',
      message: 'Storage is temporarily unavailable. Please retry.',
    };
  }

  return {
    status: 500,
    code: 'storage_error',
    message: 'Storage could not complete the request. Please retry.',
  };
}

function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

// True for a B2/S3 "object not found" — by SDK error name or a raw 404 in the response
// metadata, since different command paths surface the absence in different shapes.
function isMissingObjectError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;

  const name = 'name' in e ? e.name : undefined;
  if (name === 'NoSuchKey' || name === 'NotFound') return true;

  const metadata = '$metadata' in e ? e.$metadata : undefined;
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    'httpStatusCode' in metadata &&
    metadata.httpStatusCode === 404
  );
}

// Config errors are detected by matching the exact messages thrown in b2-client.ts /
// the db client. Keep these prefixes in sync with those throw sites.
function isStorageConfigError(error: unknown): boolean {
  const message = getErrorString(error, 'message');
  return message.startsWith('Missing B2 credentials') || message.startsWith('Missing B2_BUCKET_NAME');
}

function isDatabaseConfigError(error: unknown): boolean {
  const message = getErrorString(error, 'message');
  return message.startsWith('DATABASE_URL is required');
}

// Retryable Postgres faults, keyed on SQLSTATE: 53300 too-many-connections, the 57Pxx
// admin-shutdown/crash codes, the 58xxx I/O-system errors, and the 08xxx connection-exception
// family. Also treats network-level transients (shared with B2) as retryable.
function isTransientDatabaseError(error: unknown): boolean {
  const code = getErrorString(error, 'code');
  const transientCodes = new Set([
    '53300',
    '57P01',
    '57P02',
    '57P03',
    '58000',
    '58030',
    '08000',
    '08003',
    '08006',
    '08001',
    '08004',
    '08007',
    '08P01',
  ]);

  return transientCodes.has(code) || isTransientStorageError(error);
}

// Retryable B2/network faults. Matches on SDK error name, OS-level socket error codes,
// 5xx/408/429 HTTP status, and as a last resort substrings in the message, because the
// same underlying timeout/reset surfaces inconsistently across the SDK and Node layers.
function isTransientStorageError(error: unknown): boolean {
  const name = getErrorString(error, 'name');
  const code = getErrorString(error, 'code');
  const message = getErrorString(error, 'message').toLowerCase();
  const statusCode = getErrorStatusCode(error);
  const transientNames = new Set([
    'TimeoutError',
    'NetworkingError',
    'RequestTimeout',
    'Throttling',
    'ThrottlingException',
    'SlowDown',
  ]);
  const transientCodes = new Set([
    'TimeoutError',
    'NetworkingError',
    'RequestTimeout',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
  ]);

  return (
    transientNames.has(name) ||
    transientCodes.has(code) ||
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('eai_again')
  );
}

function getErrorString(error: unknown, key: 'name' | 'code' | 'message'): string {
  if (!error || typeof error !== 'object' || !(key in error)) return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('$metadata' in error)) return undefined;
  const metadata = error.$metadata;
  if (!metadata || typeof metadata !== 'object' || !('httpStatusCode' in metadata)) return undefined;
  const statusCode = metadata.httpStatusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}
