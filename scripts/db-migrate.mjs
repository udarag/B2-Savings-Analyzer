// Applies pending SQL migrations from migrations/ in filename order, tracking what's been run in a
// schema_migrations table so reruns are idempotent. Each migration runs in its own transaction.
import nextEnv from '@next/env';
import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import { Pool } from 'pg';

const { loadEnvConfig } = nextEnv;

// Load .env(.local) the same way Next does so DATABASE_URL etc. resolve identically to the app.
loadEnvConfig(process.cwd());

const migrationsDir = path.join(process.cwd(), 'migrations');
const pool = new Pool({
  connectionString: requireDatabaseUrl(),
  max: parsePoolMax(process.env.DATABASE_POOL_MAX),
  ssl: getSslConfig(),
});

try {
  await runMigrations();
} finally {
  await pool.end();
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Lexicographic sort defines apply order, so migration files must be named to sort
    // chronologically (e.g. a numeric/date prefix). The version key is just the filename sans .sql.
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1 LIMIT 1',
        [version],
      );

      if (applied.rowCount > 0) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`Applying ${file}`);
      // Run the migration and record its version atomically: a failure rolls back both so the
      // migration is never marked applied without its schema change actually landing.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }
  return process.env.DATABASE_URL;
}

function parsePoolMax(value) {
  const parsed = Number.parseInt(value || '5', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

// SSL is opt-in: undefined (the pg default of no TLS) unless DATABASE_SSL is explicitly truthy.
// When on, certs are verified by default; only a deliberate "false" disables verification (e.g.
// a managed DB with a self-signed chain). An optional CA file pins a custom root.
function getSslConfig() {
  const flag = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (!flag || flag === 'false' || flag === '0' || flag === 'off') return undefined;

  const sslConfig = {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };

  if (process.env.DATABASE_SSL_CA_FILE) {
    sslConfig.ca = readFileSync(process.env.DATABASE_SSL_CA_FILE, 'utf8');
  }

  return sslConfig;
}
