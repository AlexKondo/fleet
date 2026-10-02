-- PENDING migration (TIGHTENING, prevents recurrence) - apply after the others. Rollback:
-- supabase/migrations-pending/rollback/0070_rollback.sql.
--
-- F5: Supabase installs default privileges so that EVERY table, function and sequence created in `public` is automatically granted
-- to anon, authenticated (and service_role). That is the root cause of the S1 finding (internal SECURITY DEFINER functions
-- callable by anyone) and of the over-wide table grants fixed by 0068/0069: a new object is exposed unless the author remembers to
-- revoke. After this migration objects created by the migration roles are NOT exposed to anon / authenticated until granted
-- explicitly (RLS stays the row-level guard; service_role keeps its default access, the admin client needs it).
--
-- Which role creates objects: migrations run through the Management API as `postgres` (current_user = session_user = postgres);
-- Supabase's own tooling (dashboard SQL editor / CLI) may run as `supabase_admin`. pg_default_acl holds defaults for BOTH roles in
-- schema public (and for other schemas), so both are tightened (supabase_admin only if postgres may alter its defaults; a failure
-- there is reported with a NOTICE, never silently skipped for postgres).
--
-- Effect on EXISTING objects: none (default privileges only apply to objects created later). Effect on future migrations: every new
-- function / table the app needs from a signed-in user must be followed by an explicit
--   grant execute on function ... to authenticated;   grant select, insert, update, delete on ... to authenticated;
-- (see supabase/migrations/README-migrations.md).

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- PUBLIC's implicit EXECUTE is a GLOBAL default (an in-schema revoke cannot remove it; proven by the preflight): functions created by
-- `postgres` in ANY schema are no longer executable by everyone by default. Trade-off: a future `create extension` run as postgres
-- must grant execute on the extension's functions explicitly (Supabase's own extensions are installed by supabase_admin and are unaffected).
alter default privileges for role postgres revoke execute on functions from public;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from anon, authenticated';
  -- supabase_admin's GLOBAL PUBLIC default is left alone on purpose: it creates the platform's extensions
exception when others then
  raise notice 'could not alter default privileges for supabase_admin (%): objects created by that role keep the Supabase defaults', sqlerrm;
end $$;
