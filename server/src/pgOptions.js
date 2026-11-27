// One place that turns DATABASE_URL into node-postgres options, shared by the API, the
// migrations and the SQL runner, so all three connect the same way.
//
// Hosted databases (Supabase, Neon) need SSL. Their URLs often end in ?sslmode=require, which
// newer node-postgres reads as "verify the full certificate chain" and then refuses Supabase's
// pooler certificate. So the sslmode part is removed here and SSL is configured explicitly.
// DATABASE_SSL=true|false overrides; when unset, SSL is on for any host that is not local.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);

export function pgOptions(url = process.env.DATABASE_URL, sslSetting = process.env.DATABASE_SSL) {
  if (!url) throw new Error('Set DATABASE_URL first (see .env.example)');
  const parsed = new URL(url);
  const askedForSsl = ['require', 'verify-ca', 'verify-full', 'prefer'].includes(parsed.searchParams.get('sslmode'));
  parsed.searchParams.delete('sslmode');
  const useSsl = sslSetting === 'true' || (sslSetting !== 'false' && (askedForSsl || !LOCAL_HOSTS.has(parsed.hostname)));
  return {
    connectionString: parsed.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  };
}

// pgcrypto sits in the "extensions" schema on Supabase and in "public" elsewhere.
// Unknown schemas in search_path are ignored, so this one line works on both.
export const SEARCH_PATH_SQL = 'SET search_path TO public, extensions';
