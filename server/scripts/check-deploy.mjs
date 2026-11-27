// After deploying, run:  node scripts/check-deploy.mjs https://<your-site>.vercel.app
// Checks the live site end to end without creating any data.
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: node scripts/check-deploy.mjs https://<your-site>.vercel.app');
  process.exit(1);
}
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const get = async (path, init) => {
  const t = Date.now();
  const res = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(90_000), ...init });
  return { res, ms: Date.now() - t };
};

try {
  const home = await get('/');
  check('website loads', home.res.status === 200, `${home.res.status}, ${home.ms} ms`);
  check('camera allowed only on this site', (home.res.headers.get('permissions-policy') || '').includes('camera=(self)'));

  const h = await get('/api/health');
  const body = await h.res.json().catch(() => ({}));
  check('API reachable through the website and database connected', h.res.status === 200 && body.ok === true, `${h.res.status}, ${h.ms} ms${h.ms > 20_000 ? ', API was asleep' : ''}`);
  check('real face verification is on', body.faceMode === 'real', `faceMode=${body.faceMode}`);

  const me = await get('/api/auth/me');
  check('protected API refuses anonymous requests', me.res.status === 401, String(me.res.status));

  const bad = await get('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'definitely-wrong-123' }),
  });
  check('wrong password refused', bad.res.status === 401, String(bad.res.status));

  if (base.startsWith('https://')) {
    const reg = await get('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    check('input validation works', reg.res.status === 400, String(reg.res.status));
  }
} catch (err) {
  check('site responded', false, err.message);
}
console.log(failed ? `\n${failed} check(s) failed. See docs/DEPLOY.md, "If something fails".` : '\nAll checks passed. The deployment is live.');
process.exit(failed ? 1 : 0);
