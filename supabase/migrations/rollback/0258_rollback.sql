-- Removes the link between units and mobility points. The units and vehicle links created by 0258 are kept: they may already carry custodians, manager scopes or
-- reservations, and fm_units has no delete path by design. After this they are ordinary units again.
drop trigger if exists fm_location_point_moves_vehicles on public.vehicle_locations;
drop trigger if exists fm_vehicle_unit_follows_location on public.vehicles;
drop trigger if exists fm_point_unit_delete on public.corporate_mobility_points;
drop trigger if exists fm_point_unit_rename on public.corporate_mobility_points;
drop trigger if exists fm_point_unit_insert on public.corporate_mobility_points;
drop function if exists public.fm_location_units_on_change();
drop function if exists public.fm_vehicle_unit_on_change();
drop function if exists public.fm_vehicle_follows_location(uuid, boolean);
drop function if exists public.fm_point_unit_sync();
drop index if exists public.fm_units_mobility_point;
alter table public.fm_units drop column if exists mobility_point_id;
