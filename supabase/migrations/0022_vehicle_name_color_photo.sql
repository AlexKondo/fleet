-- Fleet managers could only identify a vehicle by its plate on the Frota cards — adding
-- a friendly name, its color, and a photo so the card actually reads like "this specific
-- car" instead of a license-plate lookup table. Reuses the existing private
-- `vehicle-photos` bucket (0002_operational_cycle.sql) under a `<org_id>/vehicles/<id>.*`
-- path, which its RLS policies already scope by organization_id as the first path
-- segment — no new bucket or policy needed.

alter table vehicles
  add column name text,
  add column color text,
  add column photo_storage_path text;
