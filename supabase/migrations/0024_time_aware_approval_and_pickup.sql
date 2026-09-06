-- approve_reservation (0015_audit_trail.sql) required vehicles.status = 'available' before
-- letting a pending_approval reservation become confirmed. That status is a single
-- snapshot field, not a calendar — it only reaches 'reserved' once SOME reservation on
-- that vehicle is approved, and stays that way until that specific trip is returned. Two
-- reservations on the same vehicle at genuinely different, non-overlapping times (which
-- the reservations table's own EXCLUDE constraint, 0001_init_schema.sql, already
-- guarantees can never conflict) could both exist as pending_approval, and approving the
-- earlier one made every later one permanently unapprovable — "Veículo ocupado em outra
-- viagem" even though nothing about *this* reservation's own time window was ever in
-- question. The EXCLUDE constraint is the actual, correct guarantee against double-booking;
-- the status check was strictly redundant with it and wrong whenever it disagreed.
create or replace function approve_reservation(p_reservation_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
  v_requester_id uuid;
begin
  select vehicle_id into v_vehicle_id from reservations where id = p_reservation_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status in ('maintenance', 'blocked') then
    raise exception 'Vehicle is not available to approve (current status: %)', v_vehicle_status;
  end if;

  update reservations
    set status = 'confirmed', approved_by = auth.uid(), approved_at = now()
    where id = p_reservation_id and status = 'pending_approval';
  if not found then
    raise exception 'Reservation is not pending approval';
  end if;

  -- Only claim the vehicle's status for THIS trip when it's the immediate next one up
  -- (vehicle currently sitting idle) — a reservation scheduled further out shouldn't
  -- overwrite whatever status an earlier, already-approved trip left the vehicle in.
  if v_vehicle_status = 'available' then
    update vehicles set status = 'reserved', updated_at = now() where id = v_vehicle_id;
  end if;

  select tr.requester_id into v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id;

  insert into notifications (organization_id, user_id, title, body)
  values (
    current_organization_id(), v_requester_id, 'Reserva aprovada',
    'Sua reserva foi aprovada e o veículo está confirmado.'
  );

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_approved', 'reservation',
    p_reservation_id, null, jsonb_build_object('status', 'confirmed')
  );
end;
$$;

-- record_pickup (0019_early_pickup_window.sql) only allowed pickup when vehicle.status
-- was 'reserved' or 'awaiting_pickup' — which, per the same reasoning above, a vehicle
-- can fail to be in even when THIS reservation's own scheduled window has arrived and
-- nothing is actually blocking it (e.g. status is still plain 'available' because no
-- earlier reservation ever claimed it). Pickup should be gated on real operational
-- readiness — not physically out with someone else, and not hard-blocked — not on
-- whichever reservation happened to last touch the status field.
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
  if v_vehicle_status not in ('available', 'reserved', 'awaiting_pickup') then
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

-- swap_reservation_vehicle (0018_automatic_reassignment.sql) had the identical bug: it
-- refused to swap a reservation onto any vehicle not currently 'available', even for a
-- target time window that vehicle has no actual conflict with. The reservations table's
-- own EXCLUDE constraint already rejects (with a friendly 'exclusion_violation' catch
-- below) any swap that *would* genuinely double-book the target vehicle — the extra
-- status check was redundant whenever it agreed and wrong whenever it didn't. Only truly
-- hard-blocking states (physically out right now, or taken out of rotation entirely)
-- still refuse the swap outright.
create or replace function swap_reservation_vehicle(p_reservation_id uuid, p_new_vehicle_id uuid)
returns void
language plpgsql
as $$
declare
  v_old_vehicle_id uuid;
  v_reservation_status reservation_status;
  v_old_vehicle_status vehicle_status;
  v_new_vehicle_status vehicle_status;
  v_first_id uuid;
  v_second_id uuid;
  v_other_confirmed_count integer;
begin
  select vehicle_id, status into v_old_vehicle_id, v_reservation_status
    from reservations where id = p_reservation_id for update;
  if v_old_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;
  if v_reservation_status not in ('pending_approval', 'confirmed') then
    raise exception 'Cannot swap vehicle on a reservation with status %', v_reservation_status;
  end if;
  if p_new_vehicle_id = v_old_vehicle_id then
    raise exception 'New vehicle is the same as the currently assigned vehicle';
  end if;

  if v_old_vehicle_id < p_new_vehicle_id then
    v_first_id := v_old_vehicle_id;
    v_second_id := p_new_vehicle_id;
  else
    v_first_id := p_new_vehicle_id;
    v_second_id := v_old_vehicle_id;
  end if;
  perform 1 from vehicles where id = v_first_id for update;
  perform 1 from vehicles where id = v_second_id for update;

  select status into v_old_vehicle_status from vehicles where id = v_old_vehicle_id;
  select status into v_new_vehicle_status from vehicles where id = p_new_vehicle_id;
  if v_new_vehicle_status is null then
    raise exception 'Target vehicle not found';
  end if;
  if v_old_vehicle_status in ('in_use', 'returning') then
    raise exception 'This trip is already underway on the current vehicle (status: %); cannot swap', v_old_vehicle_status;
  end if;
  if v_new_vehicle_status in ('maintenance', 'blocked', 'in_use', 'returning', 'inspection') then
    raise exception 'Target vehicle is not available (current status: %)', v_new_vehicle_status;
  end if;

  begin
    update reservations
      set vehicle_id = p_new_vehicle_id, impacted_at = null, impacted_reason = null
      where id = p_reservation_id;
    if not found then
      raise exception 'Not authorized to swap this reservation, or it no longer exists';
    end if;
  exception
    when exclusion_violation then
      raise exception 'Target vehicle already has a conflicting reservation for this time window';
  end;

  if v_reservation_status = 'confirmed' then
    if v_new_vehicle_status = 'available' then
      update vehicles set status = 'reserved', updated_at = now() where id = p_new_vehicle_id;
    end if;

    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_old_vehicle_id and id <> p_reservation_id and status = 'confirmed';

    if v_old_vehicle_status = 'reserved' and v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now() where id = v_old_vehicle_id;
    end if;
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_vehicle_reassigned', 'reservation',
    p_reservation_id,
    jsonb_build_object('vehicle_id', v_old_vehicle_id),
    jsonb_build_object('vehicle_id', p_new_vehicle_id)
  );
end;
$$;
