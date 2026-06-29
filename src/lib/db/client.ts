// Postgres access layer: one lazily-created connection pool plus thin query/transaction helpers.
// Storage is optional — the app also runs against object storage alone — so callers gate on
// isDatabaseStorageEnabled() before touching the pool.
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { readFileSync } from 'fs';

// Module-level singleton so all callers share one pool across requests (serverless warm reuse).
let pool: Pool | null = null;

/**
 * Whether persistence to Postgres is on. Requires a DATABASE_URL and is opt-out via
 * DATABASE_STORAGE_ENABLED (false/0/off) for environments that have a URL set but want it disabled.
 */
export function isDatabaseStorageEnabled(): boolean {
  const flag = process.env.DATABASE_STORAGE_ENABLED?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  return Boolean(process.env.DATABASE_URL);
}

/** Lazily build and return the shared connection pool; throws if DATABASE_URL is missing. */
export function getDatabasePool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when database storage is enabled.');
  }

  pool = new Pool({
    connectionString,
    max: parsePoolMax(process.env.DATABASE_POOL_MAX),
    ssl: getSslConfig(),
  });

  return pool;
}

/** Run a single parameterized query on the pool. Pass `values` for $1, $2… placeholders; never interpolate user input into `text`. */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return getDatabasePool().query<T>(text, values);
}

/**
 * Run `callback` inside a single BEGIN/COMMIT transaction on a dedicated client, rolling back on
 * any throw. The client is always released; do all queries via the passed client (not dbQuery,
 * which would grab a different pooled connection outside the transaction).
 */
export async function dbTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDatabasePool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Pool size from DATABASE_POOL_MAX, defaulting to 5 and ignoring non-positive/garbage values.
// Keep this modest: managed Postgres tiers cap total connections and serverless can spin up many
// instances, so an oversized pool per instance exhausts the server's connection limit.
function parsePoolMax(value?: string): number {
  const parsed = Number.parseInt(value || '5', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

// Build the pg SSL option from env. Off by default; DATABASE_SSL (true/1/on) enables it. SSL is
// verified unless DATABASE_SSL_REJECT_UNAUTHORIZED=false, and a custom CA bundle can be supplied
// via DATABASE_SSL_CA_FILE (read synchronously at pool init — runs once).
function getSslConfig(): { rejectUnauthorized: boolean; ca?: string } | undefined {
  const flag = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (!flag || flag === 'false' || flag === '0' || flag === 'off') return undefined;

  const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };

  if (process.env.DATABASE_SSL_CA_FILE) {
    sslConfig.ca = readFileSync(process.env.DATABASE_SSL_CA_FILE, 'utf8');
  }

  return sslConfig;
}
