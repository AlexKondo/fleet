-- Rollback for 0064_carpool_places_privacy.sql (NOT auto-applied).
-- WARNING: re-opens the exact pickup/drop-off + host snapshot columns to the host/rider JWTs. Roll the
-- app back first (loadHostCarpool reads places through host_ride_request_places).
grant select on public.carpool_ride_requests to authenticated;
drop function if exists public.host_ride_request_places(uuid);
drop function if exists public.carpool_coarse_label(text);
