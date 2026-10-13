-- Rollback of 0072 (new kinds must have no rows; the table and function are dropped).
drop function if exists public.consume_route_map_view(uuid, integer);
drop table if exists public.route_map_user_usage;
delete from public.geo_provider_quota_counters where provider_call_kind in ('map_geocode', 'map_routing', 'static_map');
alter table public.geo_provider_quota_counters drop constraint if exists geo_provider_quota_counters_provider_call_kind_check;
alter table public.geo_provider_quota_counters
  add constraint geo_provider_quota_counters_provider_call_kind_check
  check (provider_call_kind in ('geocode', 'place_search', 'routing'));
