-- Atomic operations for the rest of the operational cycle (§5 approval, §9-10
-- check-in/out, §11 checklist -> workflow, §5 Fleet Manager vehicle actions). Each
-- function mirrors a transition already defined in
-- packages/domain/src/state-machine/vehicleTransitions.ts — the CASE mappings below are
-- deliberate defense-in-depth (same idea as the double-booking EXCLUDE constraint):
-- the client always decides the target event first, the DB independently re-derives the
-- resulting status instead of trusting a client-supplied status value.

create or replace function approve_reservation(p_reservation_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
begin
  select vehicle_id into v_vehicle_id from reservations where id = p_reservation_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status is distinct from 'available' then
    raise exception 'Vehicle is not available to approve (current status: %)', v_vehicle_status;
  end if;

  update reservations
    set status = 'confirmed', approved_by = auth.uid(), approved_at = now()
    where id = p_reservation_id and status = 'pending_approval';
  if not found then
    raise exception 'Reservation is not pending approval';
  end if;

  update vehicles set status = 'reserved', updated_at = now() where id = v_vehicle_id;
end;
$$;

grant execute on function approve_reservation(uuid) to authenticated;

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

grant execute on function record_pickup(
  uuid, integer, numeric, numeric, boolean, text, text[], boolean, boolean, inspection_role
) to authenticated;

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
  p_workflow_tasks workflow_task_type[]
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

grant execute on function record_return(
  uuid, integer, numeric, numeric, boolean, text, text[], boolean, boolean, inspection_role,
  text, workflow_task_type[]
) to authenticated;

create or replace function complete_workflow_task(p_task_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
  select vehicle_id into v_vehicle_id from workflow_tasks where id = p_task_id;
  if v_vehicle_id is null then
    raise exception 'Workflow task not found';
  end if;

  update workflow_tasks set status = 'done', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  -- Vehicle status is one field shared by every open task on it, so completing one task
  -- must re-derive status from ALL remaining open tasks — not just tasks of the same
  -- type — otherwise finishing a repair could release a vehicle that is still dirty.
  select
    count(*) filter (where type in ('repair', 'safety', 'preventive_maintenance')),
    count(*) filter (where type = 'cleaning'),
    count(*) filter (where type = 'charging')
    into v_open_maintenance_like, v_open_cleaning, v_open_charging
    from workflow_tasks
    where vehicle_id = v_vehicle_id and status in ('open', 'in_progress');

  select status into v_current_status from vehicles where id = v_vehicle_id;
  if v_current_status not in ('maintenance', 'cleaning', 'charging') then
    return;
  end if;

  if v_open_maintenance_like > 0 then
    update vehicles set status = 'maintenance', updated_at = now() where id = v_vehicle_id;
  elsif v_open_cleaning > 0 then
    update vehicles set status = 'cleaning', updated_at = now() where id = v_vehicle_id;
  elsif v_open_charging > 0 then
    update vehicles set status = 'charging', updated_at = now() where id = v_vehicle_id;
  else
    update vehicles
      set status = 'available', has_blocking_damage = false, updated_at = now()
      where id = v_vehicle_id;
  end if;
end;
$$;

grant execute on function complete_workflow_task(uuid) to authenticated;

create or replace function block_vehicle(p_vehicle_id uuid, p_reason text)
returns void
language plpgsql
as $$
begin
  update vehicles set status = 'blocked', updated_at = now()
    where id = p_vehicle_id
      and organization_id = current_organization_id()
      and status not in ('in_use', 'returning');
  if not found then
    raise exception 'Vehicle cannot be blocked from its current status';
  end if;

  insert into workflow_tasks (organization_id, vehicle_id, type, notes)
  values (current_organization_id(), p_vehicle_id, 'safety', p_reason);
end;
$$;

grant execute on function block_vehicle(uuid, text) to authenticated;

create or replace function unblock_vehicle(p_vehicle_id uuid)
returns void
language plpgsql
as $$
begin
  update vehicles set status = 'available', updated_at = now()
    where id = p_vehicle_id and organization_id = current_organization_id() and status = 'blocked';
  if not found then
    raise exception 'Vehicle is not blocked';
  end if;
end;
$$;

grant execute on function unblock_vehicle(uuid) to authenticated;

-- Authorization model for this file:
-- approve_reservation / block_vehicle / unblock_vehicle / complete_workflow_task run as
-- SECURITY INVOKER (the default) — RLS on reservations/vehicles/workflow_tasks already
-- restricts those UPDATEs to fleet_manager/administrator/maintenance_operator (0001,
-- 0002), so a plain employee calling them simply updates 0 rows and hits the "not
-- found" guard.
-- record_pickup / record_return run as SECURITY DEFINER because the traveler performing
-- their own checklist is a plain 'employee' who has no general UPDATE right on
-- vehicles — each function does its own explicit authorization check instead
-- (must be the trip's requester, or have the security/fleet_manager/administrator role).
