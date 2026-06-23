import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { readFileSync } from 'fs';

let pool: Pool | null = null;

export function isDatabaseStorageEnabled(): boolean {
  const flag = process.env.DATABASE_STORAGE_ENABLED?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  return Boolean(process.env.DATABASE_URL);
}

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

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return getDatabasePool().query<T>(text, values);
}

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

function parsePoolMax(value?: string): number {
  const parsed = Number.parseInt(value || '5', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

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
