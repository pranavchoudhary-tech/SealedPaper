// Runs a .sql file with psql-free Node (handy when psql is not installed).
// Usage: npm run viva:sql   (runs sql/viva_checks.sql and prints the PASS/FAIL table)
// Note: psql meta-commands (lines starting with \) are skipped.
import fs from 'node:fs';
import pg from 'pg';
import { pgOptions, SEARCH_PATH_SQL } from '../src/pgOptions.js';

const file = process.argv[2];
const sql = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('\\')).join('\n');
const client = new pg.Client(pgOptions());
await client.connect();
await client.query(SEARCH_PATH_SQL);
const results = await client.query(sql);
for (const r of [].concat(results)) {
  if (r.command === 'SELECT' && r.rows.length && r.fields.some((f) => f.name === 'outcome')) console.table(r.rows);
}
await client.end();
