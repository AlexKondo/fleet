-- §14 Current Vehicle Location: "No check-in, o último usuário deverá informar onde
-- estacionou o veículo... Current Location = localização real registrada no último
-- check-in." In this codebase's terminology check-in is the RETURN step (check-out is
-- pickup) — vehicles.current_location_id has existed since 0001_init_schema.sql and is
-- already surfaced on the Fleet Manager dashboard, but nothing has ever written to it.
-- This migration closes that loop by extending record_return (0004_operational_actions.sql)
-- with an optional p_current_location_id parameter, following the same
-- create-or-replace-in-place convention 0005 used for other record_return-adjacent work.
--
-- `default null` keeps the signature backward compatible: any existing caller that omits
-- the new argument (there should be none after this round, but nothing enforces that)
-- still resolves to this same overload and behaves exactly as before — the vehicle UPDATE
-- simply leaves current_location_id untouched when the argument is null or omitted.
create or replace function record_return(
  p_reservation_id uuid,
  p_odometer_km integer,
  p_fuel_level_percent numeric,
  p_battery_level_percent numeric,
  p_has_new_damage boolean,
  p_damage_notes text,
  p_missing_safety_equipment text[],
  p_is_dirty_exterior boolean,
  p_is_dirty_interior boolean,
  p_role inspection_role,
  p_vehicle_event text,
  p_workflow_tasks workflow_task_type[],
  p_current_location_id uuid default null
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
  v_task workflow_task_type;
  v_requester_id uuid;
  v_caller_role user_role;
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

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status not in ('in_use', 'returning') then
    raise exception 'Vehicle is not on an active trip (current status: %)', v_vehicle_status;
  end if;
  if p_odometer_km < (select odometer_km from vehicles where id = v_vehicle_id) then
    raise exception 'Odometer cannot go backwards';
  end if;

  -- Defense in depth (same rationale as the CASE-derived status re-derivation below): the
  -- client picks the location from a dropdown sourced from this org's vehicle_locations,
  -- but a malformed or cross-tenant id must never be written to vehicles.current_location_id.
  if p_current_location_id is not null
     and not exists (
       select 1 from vehicle_locations
       where id = p_current_location_id and organization_id = v_org_id
     ) then
    raise exception 'Invalid current location for this organization';
  end if;

  insert into inspections (
    organization_id, reservation_id, vehicle_id, type, performed_by, performed_by_role,
    odometer_km, fuel_level_percent, battery_level_percent, has_new_damage, damage_notes,
    missing_safety_equipment, is_dirty_exterior, is_dirty_interior
  ) values (
    v_org_id, p_reservation_id, v_vehicle_id, 'return', auth.uid(), p_role,
    p_odometer_km, p_fuel_level_percent, p_battery_level_percent, p_has_new_damage, p_damage_notes,
    p_missing_safety_equipment, p_is_dirty_exterior, p_is_dirty_interior
  ) returning id into v_inspection_id;

  update reservations set status = 'completed' where id = p_reservation_id;

  update vehicles set
    odometer_km = p_odometer_km,
    fuel_level_percent = coalesce(p_fuel_level_percent, fuel_level_percent),
    battery_level_percent = coalesce(p_battery_level_percent, battery_level_percent),
    has_blocking_damage = has_blocking_damage or p_has_new_damage,
    missing_safety_equipment = p_missing_safety_equipment,
    is_clean_exterior = not p_is_dirty_exterior,
    is_clean_interior = not p_is_dirty_interior,
    current_location_id = coalesce(p_current_location_id, current_location_id),
    status = case p_vehicle_event
      when 'COMPLETE_RETURN_INSPECTION_CLEAN' then 'available'
      when 'COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING' then 'cleaning'
      when 'COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING' then 'charging'
      when 'COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE' then 'maintenance'
      else (select status from vehicles where id = v_vehicle_id)
    end,
    updated_at = now()
    where id = v_vehicle_id;

  foreach v_task in array p_workflow_tasks loop
    insert into workflow_tasks (organization_id, vehicle_id, type, source_inspection_id)
    values (v_org_id, v_vehicle_id, v_task, v_inspection_id);
  end loop;

  return v_inspection_id;
end;
$$;

-- Signature widened by one trailing default-valued parameter — grant needs the new
-- signature too (a grant on the old arity would otherwise dangle once postgres treats
-- this as the current overload of record_return).
grant execute on function record_return(
  uuid, integer, numeric, numeric, boolean, text, text[], boolean, boolean, inspection_role,
  text, workflow_task_type[], uuid
) to authenticated;
