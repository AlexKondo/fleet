-- BR-004/GT-011 (docs/instruction.md's referenced Controlled Engineering Set): "A driver
-- must be authorized and have a non-expired CNH" / "Expired CNH -> user cannot checkout as
-- driver." Previously unenforced anywhere — any profile could perform record_pickup with
-- no license data at all. driver_authorized defaults true and the license fields default
-- null so this migration changes no existing organization's observed behavior until a
-- fleet_manager/administrator actually sets a license and/or revokes authorization via
-- /settings/users.

alter table profiles
  add column driver_authorized boolean not null default true,
  add column drivers_license_number text,
  add column drivers_license_category text,
  add column drivers_license_expiration date;

-- record_pickup — same signature as 0004_operational_actions.sql (create or replace keeps
-- the existing `grant execute ... to authenticated`), with one new guard inserted before
-- the vehicle-status check: the trip's requester (the person who will actually drive, not
-- necessarily whoever is performing this pickup call — e.g. security checking a traveler
-- out) must be driver_authorized and hold a non-expired CNH. Checked here, not only in the
-- UI, per SECURITY_AND_PERMISSIONS.md's "RBAC enforced server-side; UI hiding is not
-- authorization."
create or replace function record_pickup(
  p_reservation_id uuid,
  p_odometer_km integer,
  p_fuel_level_percent numeric,
  p_battery_level_percent numeric,
  p_has_damage boolean,
  p_damage_notes text,
  p_missing_safety_equipment text[],
  p_is_dirty_exterior boolean,
  p_is_dirty_interior boolean,
  p_role inspection_role
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
  v_inspection_id uuid;
  v_requester_id uuid;
  v_caller_role user_role;
  v_driver_authorized boolean;
  v_license_expiration date;
begin
  select r.vehicle_id, tr.requester_id into v_vehicle_id, v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_requester_id
     and v_caller_role not in ('security', 'fleet_manager', 'administrator') then
    raise exception 'Not authorized to perform this inspection';
  end if;

  select driver_authorized, drivers_license_expiration
    into v_driver_authorized, v_license_expiration
    from profiles where id = v_requester_id;
  if not coalesce(v_driver_authorized, false) then
    raise exception 'DRIVER_NOT_AUTHORIZED';
  end if;
  if v_license_expiration is not null and v_license_expiration < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status not in ('reserved', 'awaiting_pickup') then
    raise exception 'Vehicle is not ready for pickup (current status: %)', v_vehicle_status;
  end if;

  insert into inspections (
    organization_id, reservation_id, vehicle_id, type, performed_by, performed_by_role,
    odometer_km, fuel_level_percent, battery_level_percent, has_new_damage, damage_notes,
    missing_safety_equipment, is_dirty_exterior, is_dirty_interior
  ) values (
    v_org_id, p_reservation_id, v_vehicle_id, 'pickup', auth.uid(), p_role,
    p_odometer_km, p_fuel_level_percent, p_battery_level_percent, p_has_damage, p_damage_notes,
    p_missing_safety_equipment, p_is_dirty_exterior, p_is_dirty_interior
  ) returning id into v_inspection_id;

  update vehicles set status = 'in_use', updated_at = now() where id = v_vehicle_id;

  return v_inspection_id;
end;
$$;
