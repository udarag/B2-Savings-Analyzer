import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getB2Client, getBucketName } from './b2-client';
import type { Analysis, ParsedBill, ModelConfig } from '@/types/analysis';
import type { ReportSnapshot } from '@/types/model';

interface ListedObject {
  key: string;
  lastModified?: Date;
}

export interface StorageErrorDetails {
  status: 500 | 503;
  code: 'storage_config_error' | 'storage_unavailable' | 'storage_error';
  message: string;
}

export interface StoredUpload {
  filename: string;
  content: Buffer;
  contentType: string;
}

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

function userPrefix(userEmail: string): string {
  return `users/${userEmail}`;
}

function analysisPath(userEmail: string, id: string): string {
  return `${userPrefix(userEmail)}/analyses/${id}`;
}

function latestSnapshotPath(userEmail: string, id: string): string {
  return `${analysisPath(userEmail, id)}/latest-snapshot.json`;
}

// --- Analysis CRUD ---

export async function listAnalyses(userEmail: string): Promise<Analysis[]> {
  const analysesPrefix = `${userPrefix(userEmail)}/analyses/`;
  const analysisPrefixes = await listChildPrefixes(analysesPrefix);
  const metaKeys = analysisPrefixes.length > 0
    ? analysisPrefixes.map((prefix) => `${prefix}meta.json`)
    : (await listKeys(analysesPrefix)).filter((k) => k.endsWith('/meta.json'));

  const analyses = (await Promise.all(
    metaKeys.map(async (key) => {
      try {
        const data = await getObject(key);
        return data ? JSON.parse(data) as Analysis : null;
      } catch (error) {
        console.error(`Skipping unreadable analysis metadata at ${key}:`, error);
        return null;
      }
    }),
  )).filter((analysis): analysis is Analysis => analysis !== null);

  return analyses.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getAnalysisMeta(userEmail: string, id: string): Promise<Analysis | null> {
  const data = await getObject(`${analysisPath(userEmail, id)}/meta.json`);
  return data ? JSON.parse(data) : null;
}

export async function saveAnalysisMeta(userEmail: string, id: string, meta: Analysis): Promise<void> {
  await putObject(`${analysisPath(userEmail, id)}/meta.json`, JSON.stringify(meta, null, 2));
}

export async function getParsedBill(userEmail: string, id: string): Promise<ParsedBill | null> {
  const data = await getObject(`${analysisPath(userEmail, id)}/parsed.json`);
  return data ? JSON.parse(data) : null;
}

export async function hasParsedBill(userEmail: string, id: string): Promise<boolean> {
  return objectExists(`${analysisPath(userEmail, id)}/parsed.json`);
}

export async function saveParsedBill(userEmail: string, id: string, parsed: ParsedBill): Promise<void> {
  await putObject(`${analysisPath(userEmail, id)}/parsed.json`, JSON.stringify(parsed, null, 2));
}

export async function getModelConfig(userEmail: string, id: string): Promise<ModelConfig | null> {
  const data = await getObject(`${analysisPath(userEmail, id)}/model-config.json`);
  return data ? JSON.parse(data) : null;
}

export async function saveModelConfig(userEmail: string, id: string, config: ModelConfig): Promise<void> {
  await putObject(`${analysisPath(userEmail, id)}/model-config.json`, JSON.stringify(config, null, 2));
}

export async function uploadFile(
  userEmail: string,
  id: string,
  filename: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await putBinaryObject(`${analysisPath(userEmail, id)}/uploads/${filename}`, body, contentType);
}

export async function getLatestUploadedFile(userEmail: string, id: string): Promise<StoredUpload | null> {
  const uploadPrefix = `${analysisPath(userEmail, id)}/uploads/`;
  const uploads = (await listObjects(uploadPrefix))
    .filter((obj) => obj.key !== uploadPrefix)
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

export async function deleteAnalysis(userEmail: string, id: string): Promise<void> {
  const keys = await listKeys(`${analysisPath(userEmail, id)}/`);
  for (const key of keys) {
    await deleteObject(key);
  }
}

// --- Snapshots ---

export async function saveReportSnapshot(userEmail: string, id: string, snapshot: ReportSnapshot): Promise<void> {
  const body = JSON.stringify(snapshot, null, 2);
  await Promise.all([
    putObject(`${analysisPath(userEmail, id)}/snapshots/${snapshot.id}.json`, body),
    putObject(latestSnapshotPath(userEmail, id), body),
  ]);
}

export async function listReportSnapshots(userEmail: string, id: string): Promise<ReportSnapshot[]> {
  const keys = await listKeys(`${analysisPath(userEmail, id)}/snapshots/`);
  const snapshots: ReportSnapshot[] = [];
  for (const key of keys) {
    const data = await getObject(key);
    if (data) snapshots.push(JSON.parse(data));
  }
  return snapshots.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getLatestSnapshot(userEmail: string, id: string): Promise<ReportSnapshot | null> {
  const latestData = await getObject(latestSnapshotPath(userEmail, id));
  if (latestData) {
    try {
      return JSON.parse(latestData);
    } catch (error) {
      console.error(`Ignoring unreadable latest snapshot pointer for ${id}:`, error);
    }
  }

  const snapshotPrefix = `${analysisPath(userEmail, id)}/snapshots/`;
  const snapshots = (await listObjects(snapshotPrefix))
    .filter((obj) => obj.key !== snapshotPrefix && obj.key.endsWith('.json'))
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));

  const latest = snapshots[0];
  if (!latest) return null;

  const data = await getObject(latest.key);
  if (!data) return null;

  const snapshot = JSON.parse(data) as ReportSnapshot;
  putObject(latestSnapshotPath(userEmail, id), JSON.stringify(snapshot, null, 2)).catch((error) => {
    console.error(`Failed to backfill latest snapshot pointer for ${id}:`, error);
  });
  return snapshot;
}

// --- Pricing ---

export interface UserProfile {
  displayName: string;
  title?: string;
}

export async function getUserProfile(userEmail: string): Promise<UserProfile | null> {
  const data = await getObject(`users/${userEmail}/profile.json`);
  return data ? JSON.parse(data) : null;
}

export async function saveUserProfile(userEmail: string, profile: UserProfile): Promise<void> {
  await putObject(`users/${userEmail}/profile.json`, JSON.stringify(profile, null, 2));
}

export async function getPricing(provider: string): Promise<unknown> {
  const data = await getObject(`pricing/${provider}.json`);
  return data ? JSON.parse(data) : null;
}

export async function savePricing(provider: string, pricing: unknown): Promise<void> {
  await putObject(`pricing/${provider}.json`, JSON.stringify(pricing, null, 2));
}

export function getStorageErrorDetails(error: unknown): StorageErrorDetails {
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

function isStorageConfigError(error: unknown): boolean {
  const message = getErrorString(error, 'message');
  return message.startsWith('Missing B2 credentials') || message.startsWith('Missing B2_BUCKET_NAME');
}

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
