drop function if exists public.consume_user_geo_quota(uuid, text, integer);
drop table if exists public.user_daily_geo_usage;
delete from public.geo_provider_quota_counters where provider_call_kind = 'place_autocomplete';
alter table public.geo_provider_quota_counters drop constraint if exists geo_provider_quota_counters_provider_call_kind_check;
alter table public.geo_provider_quota_counters
  add constraint geo_provider_quota_counters_provider_call_kind_check
  check (provider_call_kind in ('geocode', 'place_search', 'routing', 'map_geocode', 'map_routing', 'static_map'));
