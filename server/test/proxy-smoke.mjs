// Smoke test through the website's /api proxy (not part of npm test). Usage: node test/proxy-smoke.mjs http://localhost:3000
import request from 'supertest';
import { framesFor, codeFor } from './helpers.js';
const base = process.argv[2];
const stamp = Date.now();
async function register(name, person) {
  const a = request.agent(base);
  const email = `${person}${stamp}@demo.dev`;
  let r = await a.post('/api/auth/register').send({ name, email, password: 'correct horse battery' });
  if (r.status !== 201) throw new Error('register ' + r.status + JSON.stringify(r.body));
  const ch = await a.post('/api/auth/face-challenge').send({});
  r = await a.post('/api/auth/enroll/face').send({ challengeId: ch.body.challengeId, frames: framesFor(ch.body.poses, person) });
  if (r.status !== 200) throw new Error('enroll ' + JSON.stringify(r.body));
  const { secret } = (await a.post('/api/auth/enroll/totp').send({})).body;
  r = await a.post('/api/auth/enroll/totp/confirm').send({ code: codeFor(secret) });
  if (r.status !== 200) throw new Error('totp ' + JSON.stringify(r.body));
  return { a, email, person, user: r.body.user };
}
const admin = await register('Admin Smoke', 'adm');
const me = await admin.a.get('/api/auth/me');
console.log('register + cookies through proxy:', me.status, me.body.user?.role);
// fresh login: password, then face
const b = request.agent(base);
let r = await b.post('/api/auth/login').send({ email: admin.email, password: 'correct horse battery' });
console.log('login step 1:', r.status, JSON.stringify(r.body).slice(0, 80));
const ch = await b.post('/api/auth/face-challenge').send({});
r = await b.post('/api/auth/login/face').send({ challengeId: ch.body.challengeId, frames: framesFor(ch.body.poses, 'adm') });
console.log('login step 2 (face):', r.status);
console.log('me after login:', (await b.get('/api/auth/me')).status);
const wrong = await request(base).post('/api/auth/login').send({ email: admin.email, password: 'wrong password!!' });
console.log('wrong password refused:', wrong.status);
const anon = await request(base).get('/api/documents');
console.log('documents without login refused:', anon.status);
const docs = await admin.a.get('/api/documents');
console.log('documents list as admin:', docs.status);
