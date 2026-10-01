-- Phase C2 security fix: increment_geo_provider_quota_counter was created as
-- SECURITY DEFINER intended to be service_role-only, but Supabase's default
-- privileges on newly created functions in the `public` schema grant EXECUTE
-- to `authenticated` and `anon` separately from PUBLIC. The prior migration's
-- `revoke all on function ... from public` does not revoke those explicit
-- grants (PUBLIC and authenticated/anon are distinct grantees in Postgres).
-- This left the function callable directly via PostgREST by any authenticated
-- (and possibly anonymous) caller, allowing them to grief another
-- organization's Cost Guard quota/circuit-breaker counters.
--
-- This migration revokes those explicit grants so only service_role (and the
-- postgres superuser, which is expected/harmless) retains EXECUTE.

revoke execute on function public.increment_geo_provider_quota_counter(uuid, text, date) from authenticated, anon;
