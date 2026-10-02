-- 0071: retention of exact carpool locations (LGPD). ADDITIVE: one new function, no existing object changes.
-- Pickup/dropoff of a ride request hold exact coordinates + address + provider place ref. After p_days (default 180) the request is
-- no longer needed in exact form: coordinates, address and place ref are removed, a coarse marker is kept so reports still count the
-- request. PENDING requests are never touched (still live). Host address snapshots (text, unused by the app) are cleared too.
-- Corporate Mobility Points are company places, not personal data: never purged. Service_role only (called by the daily cron).
create or replace function public.purge_old_carpool_locations(p_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := greatest(coalesce(p_days, 180), 30);
  v_count integer;
begin
  with purged as (
    update public.carpool_ride_requests r
       set pickup_location  = case when r.pickup_location  is null then null
                                   else (r.pickup_location  - 'coordinates' - 'formattedAddress' - 'providerPlaceRef') || jsonb_build_object('purged', true) end,
           dropoff_location = case when r.dropoff_location is null then null
                                   else (r.dropoff_location - 'coordinates' - 'formattedAddress' - 'providerPlaceRef') || jsonb_build_object('purged', true) end,
           host_origin_snapshot = null,
           host_destination_snapshot = null
     where r.status <> 'PENDING'
       and r.created_at < now() - make_interval(days => v_days)
       and (coalesce((r.pickup_location ->> 'purged')::boolean, false) = false
            or coalesce((r.dropoff_location ->> 'purged')::boolean, false) = false
            or r.host_origin_snapshot is not null or r.host_destination_snapshot is not null)
    returning 1
  )
  select count(*) into v_count from purged;
  return v_count;
end;
$$;

revoke all on function public.purge_old_carpool_locations(integer) from public, anon, authenticated;
grant execute on function public.purge_old_carpool_locations(integer) to service_role;
