-- 0072: ADDITIVE. Route-map feature (Google Static Maps card) gets its OWN quota counters and a per-user daily cap, so a cosmetic map
-- can never exhaust the 'geocode' / 'routing' quotas that carpool matching depends on (auditor finding, High).
--  1. geo_provider_quota_counters.provider_call_kind accepts three new kinds: map_geocode, map_routing, static_map (existing rows/kinds untouched).
--  2. route_map_user_usage: one row per (user, day) counting map views; consume_route_map_view() is an atomic check-and-increment
--     (returns false once the daily cap is reached). service_role only (the server action uses the admin client).
alter table public.geo_provider_quota_counters drop constraint if exists geo_provider_quota_counters_provider_call_kind_check;
alter table public.geo_provider_quota_counters
  add constraint geo_provider_quota_counters_provider_call_kind_check
  check (provider_call_kind in ('geocode', 'place_search', 'routing', 'map_geocode', 'map_routing', 'static_map'));

create table public.route_map_user_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.route_map_user_usage enable row level security;
revoke all on table public.route_map_user_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.route_map_user_usage to service_role;

create function public.consume_route_map_view(p_user_id uuid, p_daily_cap integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_views integer;
begin
  if p_user_id is null or p_daily_cap is null or p_daily_cap < 1 then
    return false;
  end if;
  insert into public.route_map_user_usage as u (user_id, day, views)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set views = u.views + 1, updated_at = now()
    where u.views < p_daily_cap
  returning u.views into v_views;
  return v_views is not null;
end;
$$;
revoke all on function public.consume_route_map_view(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_route_map_view(uuid, integer) to service_role;
