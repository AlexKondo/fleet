-- A vehicle location (Carregador GA Shop, Portaria P1, ...) is a sub-location INSIDE a corporate mobility point (the plant / office, e.g. Iracemápolis).
-- The person's work location is a mobility point, so "is there a vehicle at my unit" = "is there a vehicle in any sub-location of my point".
-- Additive: the column is nullable (existing locations keep working by name until they are linked).
alter table public.vehicle_locations
  add column if not exists mobility_point_id uuid references public.corporate_mobility_points(id) on delete set null;

create index if not exists vehicle_locations_mobility_point_idx on public.vehicle_locations (mobility_point_id);

-- vehicle_locations is granted by column: the new one needs its own grants (same lesson as profiles.work_location_id, 0238).
grant select (mobility_point_id), insert (mobility_point_id), update (mobility_point_id) on public.vehicle_locations to authenticated;
