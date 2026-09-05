-- ISSUE-014 (MVP Remediation Pack v1.0, Wave A — Integrity & Safety): "Trip start/return
-- temporal controls are missing." record_pickup (0004_operational_actions.sql, extended by
-- 0014_driver_authorization.sql) only ever checked vehicle.status — never the reservation's
-- own scheduled start_at — so a reservation for tomorrow 09:00 could be picked up right now
-- as soon as its vehicle reached 'reserved'/'awaiting_pickup'. This undermines the
-- double-booking/scheduling guarantees the EXCLUDE constraint (0001) otherwise provides:
-- dispatching a vehicle before its window opens can collide with whatever else that
-- vehicle's schedule assumed was still free.
--
-- Grace period is organization-configurable (not hardcoded), matching the existing pattern
-- for every other tunable policy in this table (range_safety_buffer_percent,
-- maintenance_due_soon_days, etc. — 0007_organization_settings_extensions.sql). Default of
-- 15 minutes tolerates minor clock/traffic slack without opening a meaningful early-dispatch
-- window; applying this migration changes no organization's observed behavior until a
-- fleet_manager/administrator edits it via /settings.

alter table organization_settings
  add column early_pickup_grace_minutes integer not null default 15;

-- record_pickup — same signature as 0014_driver_authorization.sql (create or replace keeps
-- the existing grant), with one new guard inserted after the driver-authorization checks
-- and before the vehicle-status check: pickup is rejected if attempted more than
-- early_pickup_grace_minutes before the reservation's own start_at.
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
  v_start_at timestamptz;
  v_caller_role user_role;
  v_driver_authorized boolean;
  v_license_expiration date;
  v_grace_minutes integer;
begin
  select r.vehicle_id, tr.requester_id, r.start_at into v_vehicle_id, v_requester_id, v_start_at
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

  select early_pickup_grace_minutes into v_grace_minutes
    from organization_settings where organization_id = v_org_id;
  if now() < v_start_at - make_interval(mins => coalesce(v_grace_minutes, 15)) then
    raise exception 'EARLY_PICKUP_NOT_ALLOWED';
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
