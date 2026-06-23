import nextEnv from '@next/env';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const userEmails = process.argv.slice(2).map((email) => email.trim().toLowerCase()).filter(Boolean);

if (userEmails.length === 0) {
  console.error('Usage: npm run db:backfill -- user@backblaze.com [other@backblaze.com]');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: requireEnv('B2_ENDPOINT'),
  region: process.env.B2_REGION || 'us-west-004',
  credentials: {
    accessKeyId: requireEnv('B2_KEY_ID'),
    secretAccessKey: requireEnv('B2_APP_KEY'),
  },
  forcePathStyle: true,
});

const bucket = requireEnv('B2_BUCKET_NAME');
const pool = new Pool({
  connectionString: requireEnv('DATABASE_URL'),
  max: parsePoolMax(process.env.DATABASE_POOL_MAX),
  ssl: getSslConfig(),
});

try {
  for (const userEmail of userEmails) {
    await backfillUser(userEmail);
  }
} finally {
  await pool.end();
}

async function backfillUser(userEmail) {
  console.log(`Backfilling ${userEmail}`);
  const userPrefix = `users/${userEmail}`;
  const objects = await listObjects(`${userPrefix}/analyses/`);
  const metaObjects = objects.filter((object) => object.key.endsWith('/meta.json'));

  const profile = await getJsonObject(`${userPrefix}/profile.json`);
  if (profile) await saveUserProfile(userEmail, profile);

  for (const metaObject of metaObjects) {
    const analysisId = metaObject.key.slice(`${userPrefix}/analyses/`.length).split('/')[0];
    if (!analysisId) continue;

    const analysisPrefix = `${userPrefix}/analyses/${analysisId}`;
    const meta = await getJsonObject(`${analysisPrefix}/meta.json`);
    if (!meta) continue;

    await saveAnalysis(userEmail, analysisId, meta);

    const parsed = await getJsonObject(`${analysisPrefix}/parsed.json`);
    if (parsed) await saveParsedBill(userEmail, analysisId, parsed);

    const modelConfig = await getJsonObject(`${analysisPrefix}/model-config.json`);
    if (modelConfig) await saveModelConfig(userEmail, analysisId, modelConfig);

    const snapshotObjects = objects.filter((object) => (
      object.key.startsWith(`${analysisPrefix}/snapshots/`) && object.key.endsWith('.json')
    ));

    for (const snapshotObject of snapshotObjects) {
      const snapshot = await getJsonObject(snapshotObject.key);
      if (snapshot?.id) await saveReportSnapshot(userEmail, analysisId, snapshot);
    }

    const uploadObjects = objects.filter((object) => (
      object.key.startsWith(`${analysisPrefix}/uploads/`) && object.key !== `${analysisPrefix}/uploads/`
    ));

    for (const uploadObject of uploadObjects) {
      const filename = uploadObject.key.slice(`${analysisPrefix}/uploads/`.length);
      if (!filename) continue;

      const head = await headObject(uploadObject.key);
      await saveUpload({
        userEmail,
        analysisId,
        filename,
        objectKey: uploadObject.key,
        contentType: head.contentType || guessContentType(filename),
        sizeBytes: head.sizeBytes,
        createdAt: uploadObject.lastModified?.toISOString(),
      });
    }

    console.log(`  ${analysisId}: backfilled`);
  }
}

async function listObjects(prefix) {
  const objects = [];
  let continuationToken;

  do {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of result.Contents ?? []) {
      if (object.Key) {
        objects.push({
          key: object.Key,
          lastModified: object.LastModified,
        });
      }
    }

    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

async function getJsonObject(key) {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }
}

async function headObject(key) {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      contentType: result.ContentType,
      sizeBytes: result.ContentLength ?? 0,
    };
  } catch (error) {
    if (isMissingObjectError(error)) {
      return {
        contentType: undefined,
        sizeBytes: 0,
      };
    }
    throw error;
  }
}

async function saveAnalysis(userEmail, id, meta) {
  await pool.query(
    `
      INSERT INTO analyses (user_email, id, meta, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, $5)
      ON CONFLICT (user_email, id)
      DO UPDATE SET
        meta = EXCLUDED.meta,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [userEmail, id, JSON.stringify(meta), meta.createdAt, meta.updatedAt],
  );
}

async function saveParsedBill(userEmail, analysisId, parsed) {
  await pool.query(
    `
      INSERT INTO analysis_parsed_bills (user_email, analysis_id, parsed, updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (user_email, analysis_id)
      DO UPDATE SET parsed = EXCLUDED.parsed, updated_at = EXCLUDED.updated_at
    `,
    [userEmail, analysisId, JSON.stringify(parsed)],
  );
}

async function saveModelConfig(userEmail, analysisId, config) {
  await pool.query(
    `
      INSERT INTO analysis_model_configs (user_email, analysis_id, config, updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (user_email, analysis_id)
      DO UPDATE SET config = EXCLUDED.config, updated_at = EXCLUDED.updated_at
    `,
    [userEmail, analysisId, JSON.stringify(config)],
  );
}

async function saveReportSnapshot(userEmail, analysisId, snapshot) {
  await pool.query(
    `
      INSERT INTO report_snapshots (user_email, analysis_id, id, snapshot, created_at, trigger)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      ON CONFLICT (user_email, analysis_id, id)
      DO UPDATE SET
        snapshot = EXCLUDED.snapshot,
        created_at = EXCLUDED.created_at,
        trigger = EXCLUDED.trigger
    `,
    [userEmail, analysisId, snapshot.id, JSON.stringify(snapshot), snapshot.createdAt, snapshot.trigger],
  );
}

async function saveUpload({ userEmail, analysisId, filename, objectKey, contentType, sizeBytes, createdAt }) {
  await pool.query(
    `
      INSERT INTO analysis_uploads (
        user_email,
        analysis_id,
        filename,
        object_key,
        content_type,
        size_bytes,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
      ON CONFLICT (user_email, analysis_id, object_key)
      DO UPDATE SET
        filename = EXCLUDED.filename,
        content_type = EXCLUDED.content_type,
        size_bytes = EXCLUDED.size_bytes,
        created_at = EXCLUDED.created_at
    `,
    [userEmail, analysisId, filename, objectKey, contentType, sizeBytes, createdAt],
  );
}

async function saveUserProfile(userEmail, profile) {
  await pool.query(
    `
      INSERT INTO user_profiles (user_email, profile, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (user_email)
      DO UPDATE SET profile = EXCLUDED.profile, updated_at = EXCLUDED.updated_at
    `,
    [userEmail, JSON.stringify(profile)],
  );
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parsePoolMax(value) {
  const parsed = Number.parseInt(value || '5', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function getSslConfig() {
  const flag = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (!flag || flag === 'false' || flag === '0' || flag === 'off') return undefined;

  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

function isMissingObjectError(error) {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? error.name : undefined;
  const statusCode = '$metadata' in error ? error.$metadata?.httpStatusCode : undefined;
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404;
}

function guessContentType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}
