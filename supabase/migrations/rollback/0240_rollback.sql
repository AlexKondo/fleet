drop index if exists public.vehicle_locations_mobility_point_idx;
alter table public.vehicle_locations drop column if exists mobility_point_id;
