-- 007: Hardening for hosted PostgreSQL (Supabase, Neon). Safe to run on a plain local database too.
--
-- 1. Supabase publishes every table in the public schema through its REST "Data API" and, by
--    default, grants the public roles `anon` and `authenticated` full rights on new tables.
--    The anon key is public, so without this block anyone could read users and document_blobs.
--    SealedPaper only talks to the database through its own API, so those roles get nothing.
-- 2. Row Level Security is switched on for every table as a second wall. The migration owner
--    (the API's login) bypasses RLS as table owner; sealedpaper_app gets an explicit policy.
-- 3. Every function gets a fixed search_path. On Supabase, pgcrypto (digest, gen_random_bytes)
--    lives in the `extensions` schema; a pinned path makes triggers find it on every connection,
--    and stops anyone hijacking a function by creating look-alike objects earlier in the path.

DO $$
DECLARE
    t record;
    f record;
    has_app boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sealedpaper_app');
BEGIN
    -- 1. take everything away from Supabase's public API roles
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
    END IF;

    -- 2. RLS on every table we own; the app role keeps full access through one policy per table
    FOR t IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
        IF has_app AND NOT EXISTS (SELECT 1 FROM pg_policies
                                   WHERE schemaname = 'public' AND tablename = t.relname AND policyname = 'app_full_access') THEN
            EXECUTE format('CREATE POLICY app_full_access ON %I TO sealedpaper_app USING (true) WITH CHECK (true)', t.relname);
        END IF;
    END LOOP;

    -- 3. pin search_path on our own functions (extension functions are left alone)
    FOR f IN
        SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = current_user
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_catalog', f.sig);
    END LOOP;
END $$;
