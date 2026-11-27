// One place that turns DATABASE_URL into node-postgres options, shared by the API, the
// migrations and the SQL runner, so all three connect the same way.
//
// The URL is split by hand into user, password, host, port and database instead of being
// handed to a URL parser. Copied connection strings often break URL parsers: passwords with
// / ? # @ % that were never percent-encoded, quotes around the value, a pasted
// "DATABASE_URL=" prefix, or stray spaces. Splitting at the LAST "@" accepts all of these.
//
// Hosted databases (Supabase, Neon) need SSL. Their URLs often end in ?sslmode=require, which
// newer node-postgres reads as "verify the full certificate chain" and then refuses Supabase's
// pooler certificate. So SSL is configured explicitly here instead.
// DATABASE_SSL=true|false overrides; when unset, SSL is on for any host that is not local.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);

function fail(problem) {
  // Never echo the value itself: it contains the database password.
  throw new Error(
    `DATABASE_URL is not usable: ${problem}. Expected postgresql://USER:PASSWORD@HOST:5432/DATABASE ` +
      '(on Supabase: Connect > Session pooler, with your password in place of the [YOUR-...] placeholder).',
  );
}

function decode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part; // a literal "%" in a password that was never encoded
  }
}

/** Splits a postgres URL into its parts. Exported for tests. */
export function parseDatabaseUrl(raw) {
  if (!raw || !String(raw).trim()) fail('it is empty');
  let url = String(raw).trim();
  url = url.replace(/^DATABASE_URL\s*=\s*/i, '').trim();
  url = url.replace(/^(['"])(.*)\1$/, '$2').trim();

  const scheme = url.match(/^(postgres|postgresql):\/\//i);
  if (!scheme) fail('it must start with postgresql://');
  const rest = url.slice(scheme[0].length);

  const at = rest.lastIndexOf('@');
  if (at === -1) fail('the "user:password@" part is missing');
  const userInfo = rest.slice(0, at);
  const hostPart = rest.slice(at + 1);

  const colon = userInfo.indexOf(':');
  const user = decode(colon === -1 ? userInfo : userInfo.slice(0, colon));
  const password = colon === -1 ? '' : decode(userInfo.slice(colon + 1));
  if (!user) fail('the user name is missing');
  if (/^\[YOUR-.*\]$/i.test(password)) fail('the [YOUR-...PASSWORD] placeholder is still in it');

  const m = hostPart.match(/^([^/:?#]+)(?::(\d+))?(?:\/([^?#]*))?(?:\?([^#]*))?/);
  if (!m || !m[1]) fail('the host name is missing');
  const [, host, port, database, query = ''] = m;
  const params = new URLSearchParams(query);

  return {
    user,
    password,
    host,
    port: port ? Number(port) : 5432,
    database: decode(database || 'postgres'),
    sslmode: params.get('sslmode'),
  };
}

export function pgOptions(url = process.env.DATABASE_URL, sslSetting = process.env.DATABASE_SSL) {
  const { user, password, host, port, database, sslmode } = parseDatabaseUrl(url);
  const askedForSsl = ['require', 'verify-ca', 'verify-full', 'prefer'].includes(sslmode);
  const useSsl = sslSetting === 'true' || (sslSetting !== 'false' && (askedForSsl || !LOCAL_HOSTS.has(host)));
  return {
    user,
    password,
    host,
    port,
    database,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  };
}

// pgcrypto sits in the "extensions" schema on Supabase and in "public" elsewhere.
// Unknown schemas in search_path are ignored, so this one line works on both.
export const SEARCH_PATH_SQL = 'SET search_path TO public, extensions';
