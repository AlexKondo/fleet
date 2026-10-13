-- 0073: ADDITIVE. Address autocomplete (Google Places Autocomplete (New)) gets its own org quota kind and a generic per-user daily cap, so
-- typing in an address box can never exhaust the 'geocode' / 'routing' quotas carpool matching depends on.
--  1. geo_provider_quota_counters.provider_call_kind also accepts 'place_autocomplete'.
--  2. user_daily_geo_usage (user, kind, day) + consume_user_geo_quota(): atomic check-and-increment, false once the daily cap is reached.
--     service_role only. (route_map_user_usage / consume_route_map_view from 0072 stay as they are.)
alter table public.geo_provider_quota_counters drop constraint if exists geo_provider_quota_counters_provider_call_kind_check;
alter table public.geo_provider_quota_counters
  add constraint geo_provider_quota_counters_provider_call_kind_check
  check (provider_call_kind in ('geocode', 'place_search', 'routing', 'map_geocode', 'map_routing', 'static_map', 'place_autocomplete'));

create table public.user_daily_geo_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('place_autocomplete')),
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);
alter table public.user_daily_geo_usage enable row level security;
revoke all on table public.user_daily_geo_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.user_daily_geo_usage to service_role;

create function public.consume_user_geo_quota(p_user_id uuid, p_kind text, p_daily_cap integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_calls integer;
begin
  if p_user_id is null or p_kind is null or p_daily_cap is null or p_daily_cap < 1 then
    return false;
  end if;
  insert into public.user_daily_geo_usage as u (user_id, kind, day, calls)
  values (p_user_id, p_kind, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, kind, day) do update
    set calls = u.calls + 1, updated_at = now()
    where u.calls < p_daily_cap
  returning u.calls into v_calls;
  return v_calls is not null;
end;
$$;
revoke all on function public.consume_user_geo_quota(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_user_geo_quota(uuid, text, integer) to service_role;
