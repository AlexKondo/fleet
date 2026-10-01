-- PENDING migration (TIGHTENING, hygiene / defence in depth) - apply with the others after the app deploy.
-- Rollback: supabase/migrations-pending/rollback/0069_rollback.sql (generated from the real before-state ACLs).
--
-- L5: `anon` still holds ALL table privileges (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) on audit_log,
-- chat_conversations, chat_messages, inspection_photos, organization_settings, organizations, safety_equipment_items,
-- vehicle_categories, vehicle_locations, vehicles and workflow_tasks (the 0063 revoke covered only the journey/PII
-- tables), and anon holds the MAINTAIN privilege on more tables. RLS returns no rows to anon today, so this is hygiene: a
-- future permissive policy (or TRUNCATE, which ignores RLS) must not become reachable with the public anon key.
--
-- PROVEN UNUSED: no unauthenticated flow reads a table with the anon key. login / signup / forgot-password /
-- reset-password / auth callback use the Auth API and the service-role client (signUpOrganization); middleware skips
-- every public route and, for protected ones, redirects before any table access; the only browser-side table access
-- is NotificationBell (signed-in session). Cron routes use the service-role client. Verified by code audit and by a
-- fetch-logger run of the unauthenticated flows (testing/live-demo/c7b-unauth-flows.mjs): 0 PostgREST requests with the anon key.
--
-- Selection is by pg_class.relacl (NOT information_schema.role_table_grants, which does not list MAINTAIN and hides
-- grants made by other grantors): EVERY relation of the public schema (tables, partitioned tables, views,
-- materialized views, sequences) gets `revoke all ... from anon`, so anon ends with nothing it does not need (it needs nothing).
-- authenticated additionally loses TRUNCATE / REFERENCES / TRIGGER / MAINTAIN (no API verb for them; TRUNCATE ignores RLS;
-- the app never needs any of the four). authenticated keeps SELECT/INSERT/UPDATE/DELETE exactly as before.

do $$
declare r record;
begin
  for r in
    select c.oid::regclass as rel, c.relkind
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence %s from anon', r.rel);
    else
      execute format('revoke all on table %s from anon', r.rel);
      begin
        execute format('revoke truncate, references, trigger, maintain on table %s from authenticated', r.rel);
      exception when others then
        -- PostgreSQL < 17 has no MAINTAIN privilege
        execute format('revoke truncate, references, trigger on table %s from authenticated', r.rel);
      end;
    end if;
  end loop;
end $$;
