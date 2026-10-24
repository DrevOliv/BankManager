import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { config } from './config.js';

// Return NUMERIC as JS numbers and DATE as plain 'YYYY-MM-DD' strings.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// Bank times are local wall-clock times; keep them as 'YYYY-MM-DD HH:MM:SS' strings.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T | undefined> {
  const rows = await query<T>(text, params, db);
  return rows[0];
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Waits for Postgres to accept connections (the app container usually starts first). */
export async function waitForDb(attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Applies numbered .sql files from src/migrations once each, in order. */
export async function migrate(): Promise<void> {
  const dir = new URL('./migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await query<{ version: string }>('SELECT version FROM schema_migrations')).map((r) => r.version),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(new URL(file, dir), 'utf8');
    await tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });
  }
}
