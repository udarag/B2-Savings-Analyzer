// Postgres-backed storage backend, used when DATABASE_URL is configured. Mirrors the
// B2 object-store backend in storage.ts; the two are kept interchangeable so an analysis
// behaves the same whichever backend is active. Each entity is one row keyed by
// (user_email, id/analysis_id); writes upsert so re-saving is idempotent.
import { dbQuery, dbTransaction, isDatabaseStorageEnabled } from '@/lib/db/client';
import type { Analysis, ModelConfig, ParsedBill } from '@/types/analysis';
import type { ReportSnapshot } from '@/types/model';
import type { UserProfile } from './storage';

export { isDatabaseStorageEnabled };

/** Pointer to a stored upload's bytes (which live in B2), resolved from the DB upload record. */
export interface DatabaseStoredUploadReference {
  filename: string;
  objectKey: string;
  contentType: string;
}

// A jsonb column may come back already-parsed (object) or as a raw string depending on
// driver/column config, so every payload field is typed `T | string` and run through
// parseJson() rather than assumed to be one or the other.
interface JsonRow<T> {
  body?: T | string;
  meta?: T | string;
  parsed?: T | string;
  config?: T | string;
  profile?: T | string;
  snapshot?: T | string;
}

interface UploadRow {
  filename: string;
  object_key: string;
  content_type: string | null;
}

/** Lists a user's analyses (metadata only), newest first. */
export async function listDatabaseAnalyses(userEmail: string): Promise<Analysis[]> {
  const { rows } = await dbQuery<JsonRow<Analysis>>(
    `
      SELECT meta
      FROM analyses
      WHERE user_email = $1
      ORDER BY created_at DESC
    `,
    [userEmail],
  );

  return rows.map((row) => parseJson<Analysis>(row.meta));
}

export async function getDatabaseAnalysisMeta(userEmail: string, id: string): Promise<Analysis | null> {
  const { rows } = await dbQuery<JsonRow<Analysis>>(
    `
      SELECT meta
      FROM analyses
      WHERE user_email = $1 AND id = $2
      LIMIT 1
    `,
    [userEmail, id],
  );

  return rows[0] ? parseJson<Analysis>(rows[0].meta) : null;
}

/**
 * Upserts an analysis's metadata. created_at/updated_at are driven by the caller's
 * meta object (not now()) so the app stays the source of truth for those timestamps
 * and re-saving doesn't reset the original creation time.
 */
export async function saveDatabaseAnalysisMeta(userEmail: string, id: string, meta: Analysis): Promise<void> {
  await dbQuery(
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

export async function getDatabaseParsedBill(userEmail: string, id: string): Promise<ParsedBill | null> {
  const { rows } = await dbQuery<JsonRow<ParsedBill>>(
    `
      SELECT parsed
      FROM analysis_parsed_bills
      WHERE user_email = $1 AND analysis_id = $2
      LIMIT 1
    `,
    [userEmail, id],
  );

  return rows[0] ? parseJson<ParsedBill>(rows[0].parsed) : null;
}

export async function hasDatabaseParsedBill(userEmail: string, id: string): Promise<boolean> {
  const { rowCount } = await dbQuery(
    `
      SELECT 1
      FROM analysis_parsed_bills
      WHERE user_email = $1 AND analysis_id = $2
      LIMIT 1
    `,
    [userEmail, id],
  );

  return (rowCount ?? 0) > 0;
}

export async function saveDatabaseParsedBill(userEmail: string, id: string, parsed: ParsedBill): Promise<void> {
  await dbQuery(
    `
      INSERT INTO analysis_parsed_bills (user_email, analysis_id, parsed, updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (user_email, analysis_id)
      DO UPDATE SET parsed = EXCLUDED.parsed, updated_at = EXCLUDED.updated_at
    `,
    [userEmail, id, JSON.stringify(parsed)],
  );
}

export async function getDatabaseModelConfig(userEmail: string, id: string): Promise<ModelConfig | null> {
  const { rows } = await dbQuery<JsonRow<ModelConfig>>(
    `
      SELECT config
      FROM analysis_model_configs
      WHERE user_email = $1 AND analysis_id = $2
      LIMIT 1
    `,
    [userEmail, id],
  );

  return rows[0] ? parseJson<ModelConfig>(rows[0].config) : null;
}

export async function saveDatabaseModelConfig(userEmail: string, id: string, config: ModelConfig): Promise<void> {
  await dbQuery(
    `
      INSERT INTO analysis_model_configs (user_email, analysis_id, config, updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (user_email, analysis_id)
      DO UPDATE SET config = EXCLUDED.config, updated_at = EXCLUDED.updated_at
    `,
    [userEmail, id, JSON.stringify(config)],
  );
}

/**
 * Records (or refreshes) the DB pointer to an uploaded bill. The bytes live in B2 at
 * objectKey; this row just indexes them. createdAt is optional and defaults to now().
 */
export async function recordDatabaseUpload(options: {
  userEmail: string;
  analysisId: string;
  filename: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  createdAt?: Date;
}): Promise<void> {
  await dbQuery(
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
    [
      options.userEmail,
      options.analysisId,
      options.filename,
      options.objectKey,
      options.contentType,
      options.sizeBytes,
      options.createdAt?.toISOString(),
    ],
  );
}

/** Returns the pointer to the most recently uploaded bill for an analysis, or null if none. */
export async function getLatestDatabaseUpload(
  userEmail: string,
  id: string,
): Promise<DatabaseStoredUploadReference | null> {
  const { rows } = await dbQuery<UploadRow>(
    `
      SELECT filename, object_key, content_type
      FROM analysis_uploads
      WHERE user_email = $1 AND analysis_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [userEmail, id],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    filename: row.filename,
    objectKey: row.object_key,
    // Older rows may have a null content_type; fall back to a guess from the extension.
    contentType: row.content_type || guessContentType(row.filename),
  };
}

export async function deleteDatabaseAnalysis(userEmail: string, id: string): Promise<void> {
  await dbQuery(
    `
      DELETE FROM analyses
      WHERE user_email = $1 AND id = $2
    `,
    [userEmail, id],
  );
}

/** Upserts a report snapshot (the immutable rendered state behind a customer report/PDF). */
export async function saveDatabaseReportSnapshot(
  userEmail: string,
  id: string,
  snapshot: ReportSnapshot,
): Promise<void> {
  await dbTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO report_snapshots (
          user_email,
          analysis_id,
          id,
          snapshot,
          created_at,
          trigger
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        ON CONFLICT (user_email, analysis_id, id)
        DO UPDATE SET
          snapshot = EXCLUDED.snapshot,
          created_at = EXCLUDED.created_at,
          trigger = EXCLUDED.trigger
      `,
      [
        userEmail,
        id,
        snapshot.id,
        JSON.stringify(snapshot),
        snapshot.createdAt,
        snapshot.trigger,
      ],
    );
  });
}

export async function listDatabaseReportSnapshots(userEmail: string, id: string): Promise<ReportSnapshot[]> {
  const { rows } = await dbQuery<JsonRow<ReportSnapshot>>(
    `
      SELECT snapshot
      FROM report_snapshots
      WHERE user_email = $1 AND analysis_id = $2
      ORDER BY created_at DESC, id DESC
    `,
    [userEmail, id],
  );

  return rows.map((row) => parseJson<ReportSnapshot>(row.snapshot));
}

export async function getLatestDatabaseSnapshot(userEmail: string, id: string): Promise<ReportSnapshot | null> {
  const { rows } = await dbQuery<JsonRow<ReportSnapshot>>(
    `
      SELECT snapshot
      FROM report_snapshots
      WHERE user_email = $1 AND analysis_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [userEmail, id],
  );

  return rows[0] ? parseJson<ReportSnapshot>(rows[0].snapshot) : null;
}

export async function getDatabaseUserProfile(userEmail: string): Promise<UserProfile | null> {
  const { rows } = await dbQuery<JsonRow<UserProfile>>(
    `
      SELECT profile
      FROM user_profiles
      WHERE user_email = $1
      LIMIT 1
    `,
    [userEmail],
  );

  return rows[0] ? parseJson<UserProfile>(rows[0].profile) : null;
}

export async function saveDatabaseUserProfile(userEmail: string, profile: UserProfile): Promise<void> {
  await dbQuery(
    `
      INSERT INTO user_profiles (user_email, profile, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (user_email)
      DO UPDATE SET profile = EXCLUDED.profile, updated_at = EXCLUDED.updated_at
    `,
    [userEmail, JSON.stringify(profile)],
  );
}

// Normalizes a jsonb payload that the driver may return either as a raw string or
// as an already-parsed object (see JsonRow). undefined means the SELECT didn't include
// the column — a programming error, so we throw rather than return a bogus value.
function parseJson<T>(value: T | string | undefined): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  if (value === undefined) throw new Error('Database row did not include expected JSON payload.');
  return value;
}

// Last-resort content type from the filename extension, for upload rows missing one.
function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}
