-- FleetMind Smart Carpool & Geospatial Intelligence — Phase C2 (Geospatial Layer).
--
-- Atomic upsert-increment for `geo_provider_quota_counters` (0054). Cost Guard
-- (apps/web/lib/geospatial/costGuard.ts) calls this once per guarded provider call, before
-- the real Google API call is made, so the counter is accurate even under concurrent
-- requests from multiple Vercel instances hitting the same (organization, call kind, day)
-- row simultaneously — a read-then-write from the application layer would race; a single
-- `insert ... on conflict do update set call_count = call_count + 1` does not.
--
-- security definer + fixed search_path, matching this repo's existing RPC precedent
-- (e.g. `log_audit_event`, 0015_audit_trail.sql) since this must be callable by the
-- service-role client Cost Guard already uses.

create or replace function increment_geo_provider_quota_counter(
  p_organization_id uuid,
  p_provider_call_kind text,
  p_day date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into geo_provider_quota_counters (organization_id, provider_call_kind, day, call_count)
  values (p_organization_id, p_provider_call_kind, p_day, 1)
  on conflict (organization_id, provider_call_kind, day)
  do update set call_count = geo_provider_quota_counters.call_count + 1,
                updated_at = now();
end;
$$;

revoke all on function increment_geo_provider_quota_counter(uuid, text, date) from public;
grant execute on function increment_geo_provider_quota_counter(uuid, text, date) to service_role;
