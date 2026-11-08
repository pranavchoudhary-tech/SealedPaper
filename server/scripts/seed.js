// server/scripts/seed.js — Seeds the 9 demo accounts from docs/DEMO.md and exam centres
import pg from 'pg';
import argon2 from 'argon2';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL first');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
console.log('Connected to database for seeding...');

const DEMO_PASSWORD = 'correct horse battery';
const passwordHash = await argon2.hash(DEMO_PASSWORD);

// Dummy 128-float face descriptor for mock / seed tests
const dummyDescriptor = Buffer.alloc(128 * 4);
for (let i = 0; i < 128; i++) dummyDescriptor.writeFloatLE(0.05, i * 4);

const dummyTotpEnc = Buffer.from('mock_seed_totp_secret_bytes_12345');

const DEMO_USERS = [
  { id: '10000000-0000-0000-0000-000000000001', name: 'Exam Controller', email: 'controller@test.dev', role: 'admin' },
  { id: '10000000-0000-0000-0000-000000000002', name: 'Setter A', email: 'setter_a@test.dev', role: 'setter' },
  { id: '10000000-0000-0000-0000-000000000003', name: 'Setter B', email: 'setter_b@test.dev', role: 'setter' },
  { id: '10000000-0000-0000-0000-000000000004', name: 'Custodian One', email: 'custodian1@test.dev', role: 'custodian' },
  { id: '10000000-0000-0000-0000-000000000005', name: 'Custodian Two', email: 'custodian2@test.dev', role: 'custodian' },
  { id: '10000000-0000-0000-0000-000000000006', name: 'Custodian Three', email: 'custodian3@test.dev', role: 'custodian' },
  { id: '10000000-0000-0000-0000-000000000007', name: 'Superintendent Delhi', email: 'delhi_sup@test.dev', role: 'superintendent' },
  { id: '10000000-0000-0000-0000-000000000008', name: 'Superintendent Pune', email: 'pune_sup@test.dev', role: 'superintendent' },
  { id: '10000000-0000-0000-0000-000000000009', name: 'Investigator', email: 'investigator@test.dev', role: 'investigator' },
];

const DEMO_CENTRES = [
  { id: '20000000-0000-0000-0000-000000000001', code: 'DEL01', name: 'Delhi Central Examination Centre', city: 'New Delhi' },
  { id: '20000000-0000-0000-0000-000000000002', code: 'PUN02', name: 'Pune City Testing Centre', city: 'Pune' },
];

try {
  await client.query('BEGIN');

  // 1. Seed Users
  for (const u of DEMO_USERS) {
    await client.query(`
      INSERT INTO users (id, name, email, password_hash, role, status, totp_enabled, totp_secret_enc)
      VALUES ($1, $2, $3, $4, $5, 'active', true, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        status = 'active',
        totp_enabled = true,
        totp_secret_enc = EXCLUDED.totp_secret_enc
    `, [u.id, u.name, u.email, passwordHash, u.role, dummyTotpEnc]);

    await client.query(`
      INSERT INTO face_templates (user_id, descriptor_enc)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET descriptor_enc = EXCLUDED.descriptor_enc
    `, [u.id, dummyDescriptor]);
  }
  console.log(`✓ Seeded ${DEMO_USERS.length} demo users with active status, TOTP & face templates.`);

  // 2. Seed Centres
  for (const c of DEMO_CENTRES) {
    await client.query(`
      INSERT INTO centres (id, code, name, city)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        city = EXCLUDED.city
    `, [c.id, c.code, c.name, c.city]);
  }
  console.log(`✓ Seeded ${DEMO_CENTRES.length} examination centres (DEL01, PUN02).`);

  // 3. Seed Sample Exam
  const examRes = await client.query(`
    INSERT INTO exams (id, name, created_by)
    VALUES ('30000000-0000-0000-0000-000000000001', 'Mid-semester examination 2026', '10000000-0000-0000-0000-000000000001')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name;
  `);
  console.log(`✓ Seeded exam: "${examRes.rows[0].name}"`);

  await client.query('COMMIT');
  console.log('\n--- Demo Accounts (Password for all: "correct horse battery") ---');
  console.table(DEMO_USERS.map((u) => ({ Role: u.role, Name: u.name, Email: u.email })));
  console.log('--- Centres ---');
  console.table(DEMO_CENTRES.map((c) => ({ Code: c.code, Name: c.name, City: c.city })));
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Seeding error:', err);
  process.exit(1);
} finally {
  await client.end();
}
