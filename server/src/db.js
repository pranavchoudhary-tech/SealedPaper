import pg from 'pg';
import { config } from './config.js';
// Triggers and functions find pgcrypto through their pinned search_path (migration 007),
// so pooled connections need no per-session setup.
import { pgOptions } from './pgOptions.js';

// Return bigint counts as numbers (safe for our sizes) instead of strings.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  ...pgOptions(config.databaseUrl, process.env.DATABASE_SSL),
  max: config.dbPoolMax,                 // keep under the Supabase pooler's client limit
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,       // a paused free-tier database can take a few seconds to wake
  keepAlive: true,
});

// A dropped idle connection (the pooler restarting, the network blinking) must not crash the API.
pool.on('error', (err) => {
  console.error('database pool error (connection will be replaced):', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

// Run fn(client) inside BEGIN ... COMMIT. Any error rolls the whole thing back.
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
