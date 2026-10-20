-- Pacote 01 integration fix: the scoped views from 0180 were created with `select v.*`, which freezes the column list at creation.
-- 0184 added inspections.equipment_contract_id and 0185 added vehicles.archived_at/archived_by/archive_reason/pre_archive_status/lifecycle_version,
-- so the app (command center, /fleet, /analytics, vehicle page: `.is("archived_at", null)`) failed with 42703 for managers.
-- CREATE OR REPLACE VIEW may append columns at the end; definitions, security_invoker, ownership and grants stay as they are.
create or replace view public.fm_managed_vehicles with (security_invoker = true) as
  select v.* from public.vehicles v where public.fm_can_manage_vehicle(v.id);
create or replace view public.fm_managed_inspections with (security_invoker = true) as
  select i.* from public.inspections i where public.fm_can_manage_vehicle(i.vehicle_id);
