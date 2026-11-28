import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDatabaseUrl, pgOptions } from '../src/pgOptions.js';

const host = 'aws-1-ap-southeast-1.pooler.supabase.com';

test('DATABASE_URL: the Supabase session pooler string', () => {
  const o = pgOptions(`postgresql://postgres.cijrnvrgxrpqcuumklss:Abc123xyz@${host}:5432/postgres`);
  assert.equal(o.user, 'postgres.cijrnvrgxrpqcuumklss');
  assert.equal(o.password, 'Abc123xyz');
  assert.equal(o.host, host);
  assert.equal(o.port, 5432);
  assert.equal(o.database, 'postgres');
  assert.deepEqual(o.ssl, { rejectUnauthorized: false });
});

test('DATABASE_URL: copy-paste mistakes are tolerated', () => {
  for (const raw of [
    `  "postgresql://u:pw@${host}:5432/postgres"  `,
    `'postgresql://u:pw@${host}:5432/postgres'`,
    `DATABASE_URL=postgresql://u:pw@${host}:5432/postgres`,
    `postgresql://u:pw@${host}:5432/postgres?sslmode=require`,
  ]) {
    const o = parseDatabaseUrl(raw);
    assert.equal(o.password, 'pw', raw);
    assert.equal(o.host, host, raw);
  }
});

test('DATABASE_URL: unencoded special characters in the password', () => {
  for (const pw of ['a/b?c#d', 'p@ss@word', '100%sure', 'x:y:z', 'sp ace']) {
    assert.equal(parseDatabaseUrl(`postgresql://u:${pw}@${host}:5432/postgres`).password, pw, pw);
  }
  assert.equal(parseDatabaseUrl(`postgresql://u:a%40b@${host}:5432/postgres`).password, 'a@b');
});

test('DATABASE_URL: clear errors that never print the password', () => {
  const cases = [
    ['', /empty/],
    [`${host}:5432/postgres`, /must start with postgresql/],
    [`postgresql://u:[YOUR-DATABASE-PASSWORD]@${host}:5432/postgres`, /placeholder/],
    ['postgresql://u:secret123', /user:password@/],
  ];
  for (const [raw, msg] of cases) {
    assert.throws(() => parseDatabaseUrl(raw), (e) => msg.test(e.message) && !e.message.includes('secret123'));
  }
});

test('DATABASE_URL: local databases get no SSL', () => {
  assert.equal(pgOptions('postgres://postgres:postgres@localhost:5432/sealedpaper').ssl, false);
  assert.deepEqual(pgOptions('postgres://p:p@localhost:5432/x', 'true').ssl, { rejectUnauthorized: false });
});
