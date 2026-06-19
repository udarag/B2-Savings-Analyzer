import {
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getB2Client, getBucketName } from './b2-client';
import type { Analysis, ParsedBill, ModelConfig } from '@/types/analysis';
import type { ReportSnapshot } from '@/types/model';

async function getObject(key: string): Promise<string | null> {
  try {
    const res = await getB2Client().send(
      new GetObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return (await res.Body?.transformToString()) ?? null;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'name' in e && e.name === 'NoSuchKey') return null;
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

async function deleteObject(key: string) {
  await getB2Client().send(
    new DeleteObjectCommand({ Bucket: getBucketName(), Key: key })
  );
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
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
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

// --- User-scoped helpers ---

function userPrefix(userEmail: string): string {
  return `users/${userEmail}`;
}

function analysisPath(userEmail: string, id: string): string {
  return `${userPrefix(userEmail)}/analyses/${id}`;
}

// --- Analysis CRUD ---

export async function listAnalyses(userEmail: string): Promise<Analysis[]> {
  const keys = await listKeys(`${userPrefix(userEmail)}/analyses/`);
  const metaKeys = keys.filter((k) => k.endsWith('/meta.json'));

  const analyses: Analysis[] = [];
  for (const key of metaKeys) {
    const data = await getObject(key);
    if (data) analyses.push(JSON.parse(data));
  }

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

export async function deleteAnalysis(userEmail: string, id: string): Promise<void> {
  const keys = await listKeys(`${analysisPath(userEmail, id)}/`);
  for (const key of keys) {
    await deleteObject(key);
  }
}

// --- Snapshots ---

export async function saveReportSnapshot(userEmail: string, id: string, snapshot: ReportSnapshot): Promise<void> {
  await putObject(
    `${analysisPath(userEmail, id)}/snapshots/${snapshot.id}.json`,
    JSON.stringify(snapshot, null, 2),
  );
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
  const snapshots = await listReportSnapshots(userEmail, id);
  return snapshots[0] || null;
}

// --- Pricing ---

export async function getPricing(provider: string): Promise<unknown> {
  const data = await getObject(`pricing/${provider}.json`);
  return data ? JSON.parse(data) : null;
}

export async function savePricing(provider: string, pricing: unknown): Promise<void> {
  await putObject(`pricing/${provider}.json`, JSON.stringify(pricing, null, 2));
}
