-- Forward-only replacements from exact supplied source. ACLs and INVOKER/DEFINER retained.
-- Vehicle locks precede reservation/task locks. Concurrent connection testing still required.
create or replace function swap_reservation_vehicle(p_reservation_id uuid, p_new_vehicle_id uuid)
returns void
language plpgsql
as $$
declare
  v_old_vehicle_id uuid;
  v_expected_vehicle_id uuid;
  v_reservation_status reservation_status;
  v_old_vehicle_status vehicle_status;
  v_new_vehicle_status vehicle_status;
  v_first_id uuid;
  v_second_id uuid;
  v_other_confirmed_count integer;
begin
  select vehicle_id, status into v_old_vehicle_id, v_reservation_status
    from reservations where id = p_reservation_id;
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

  v_expected_vehicle_id := v_old_vehicle_id;
  select vehicle_id,status into v_old_vehicle_id,v_reservation_status from reservations where id=p_reservation_id for update;
  if v_old_vehicle_id is distinct from v_expected_vehicle_id then raise exception 'CONCURRENT_UPDATE';end if;
  if v_reservation_status not in ('pending_approval','confirmed') then raise exception 'INVALID_STATE_TRANSITION';end if;

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

create or replace function auto_reassign_reservation_vehicle(
  p_organization_id uuid,
  p_reservation_id uuid,
  p_new_vehicle_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_vehicle_id uuid;
  v_expected_vehicle_id uuid;
  v_reservation_status reservation_status;
  v_old_vehicle_status vehicle_status;
  v_new_vehicle_status vehicle_status;
  v_first_id uuid;
  v_second_id uuid;
  v_other_confirmed_count integer;
begin
  select vehicle_id, status into v_old_vehicle_id, v_reservation_status
    from reservations
    where id = p_reservation_id and organization_id = p_organization_id
    ;
  if v_old_vehicle_id is null then
    raise exception 'Reservation not found in this organization';
  end if;
  if v_reservation_status not in ('pending_approval', 'confirmed') then
    raise exception 'Cannot auto-reassign a reservation with status %', v_reservation_status;
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
  perform 1 from vehicles where id = v_first_id and organization_id = p_organization_id for update;
  perform 1 from vehicles where id = v_second_id and organization_id = p_organization_id for update;

  v_expected_vehicle_id := v_old_vehicle_id;
  select vehicle_id,status into v_old_vehicle_id,v_reservation_status from reservations where id=p_reservation_id and organization_id = p_organization_id for update;
  if v_old_vehicle_id is distinct from v_expected_vehicle_id then raise exception 'CONCURRENT_UPDATE';end if;
  if v_reservation_status not in ('pending_approval','confirmed') then raise exception 'INVALID_STATE_TRANSITION';end if;

  select status into v_old_vehicle_status
    from vehicles where id = v_old_vehicle_id and organization_id = p_organization_id;
  select status into v_new_vehicle_status
    from vehicles where id = p_new_vehicle_id and organization_id = p_organization_id;
  if v_new_vehicle_status is null then
    raise exception 'Target vehicle not found in this organization';
  end if;
  -- Deliberately NO "old vehicle already in_use/returning" guard here, unlike
  -- swap_reservation_vehicle: this function only ever runs for a reservation that
  -- hasn't started yet (p_reservation_id's own status is still pending_approval/
  -- confirmed, checked above) whose vehicle_id happens to point at the SAME vehicle a
  -- DIFFERENT, currently in-progress reservation just reported a delay on — that
  -- vehicle being 'in_use' right now is the entire reason this function is being
  -- called, not a reason to refuse. p_reservation_id's own trip was never underway on
  -- it. (This guard's absence was a confirmed bug in the first version of this
  -- function — it made every real invocation raise unconditionally, since the source
  -- vehicle is reliably 'in_use' whenever a delay is actually being reported on it.)
  if v_new_vehicle_status is distinct from 'available' then
    raise exception 'Target vehicle is not available (current status: %)', v_new_vehicle_status;
  end if;

  begin
    update reservations
      set vehicle_id = p_new_vehicle_id, impacted_at = null, impacted_reason = null
      where id = p_reservation_id and organization_id = p_organization_id;
    if not found then
      raise exception 'Reservation no longer exists in this organization';
    end if;
  exception
    when exclusion_violation then
      raise exception 'Target vehicle already has a conflicting reservation for this time window';
  end;

  if v_reservation_status = 'confirmed' then
    update vehicles set status = 'reserved', updated_at = now()
      where id = p_new_vehicle_id and organization_id = p_organization_id;

    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_old_vehicle_id and id <> p_reservation_id and status = 'confirmed';

    if v_old_vehicle_status = 'reserved' and v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now()
        where id = v_old_vehicle_id and organization_id = p_organization_id;
    end if;
  end if;

  -- p_actor_id is null on purpose: this is a system-initiated action, not a specific
  -- user's — log_audit_event's own guard (0015) only validates actor/org when
  -- auth.uid() is non-null, which it never is under the service-role key this function
  -- is restricted to.
  perform log_audit_event(
    p_organization_id, null, 'reservation_vehicle_auto_reassigned', 'reservation',
    p_reservation_id,
    jsonb_build_object('vehicle_id', v_old_vehicle_id),
    jsonb_build_object('vehicle_id', p_new_vehicle_id, 'trigger', 'delay_impact')
  );
end;
$$;

create or replace function complete_workflow_task(p_task_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_task_type workflow_task_type;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
  select vehicle_id, type into v_vehicle_id, v_task_type from workflow_tasks where id = p_task_id;
  if v_vehicle_id is null then
    raise exception 'Workflow task not found';
  end if;

  perform 1 from vehicles where id=v_vehicle_id for update;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
  perform 1 from workflow_tasks where id=p_task_id and vehicle_id=v_vehicle_id for update;
  if not found then raise exception 'CONCURRENT_UPDATE';end if;

  update workflow_tasks set status = 'done', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  if v_task_type = 'safety' then
    update vehicles set missing_safety_equipment = '{}', updated_at = now()
      where id = v_vehicle_id;
  elsif v_task_type = 'fuel' then
    update vehicles set fuel_level_percent = 100, updated_at = now()
      where id = v_vehicle_id;
  elsif v_task_type = 'charging' then
    update vehicles set battery_level_percent = 100, updated_at = now()
      where id = v_vehicle_id;
  end if;

  select
    count(*) filter (where type in ('repair', 'safety', 'preventive_maintenance')),
    count(*) filter (where type = 'cleaning'),
    count(*) filter (where type = 'charging')
    into v_open_maintenance_like, v_open_cleaning, v_open_charging
    from workflow_tasks
    where vehicle_id = v_vehicle_id and status in ('open', 'in_progress');

  select status into v_current_status from vehicles where id = v_vehicle_id;
  if v_current_status not in ('maintenance', 'cleaning', 'charging') then
    perform log_audit_event(
      current_organization_id(), auth.uid(), 'workflow_task_completed', 'workflow_task',
      p_task_id, null, null
    );
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

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'workflow_task_completed', 'workflow_task',
    p_task_id, null, null
  );
end;
$$;

create or replace function cancel_workflow_task(p_task_id uuid)
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

  perform 1 from vehicles where id=v_vehicle_id for update;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
  perform 1 from workflow_tasks where id=p_task_id and vehicle_id=v_vehicle_id for update;
  if not found then raise exception 'CONCURRENT_UPDATE';end if;

  update workflow_tasks set status = 'cancelled', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  select
    count(*) filter (where type in ('repair', 'safety', 'preventive_maintenance')),
    count(*) filter (where type = 'cleaning'),
    count(*) filter (where type = 'charging')
    into v_open_maintenance_like, v_open_cleaning, v_open_charging
    from workflow_tasks
    where vehicle_id = v_vehicle_id and status in ('open', 'in_progress');

  select status into v_current_status from vehicles where id = v_vehicle_id;
  if v_current_status not in ('maintenance', 'cleaning', 'charging') then
    perform log_audit_event(
      current_organization_id(), auth.uid(), 'workflow_task_cancelled', 'workflow_task',
      p_task_id, null, null
    );
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

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'workflow_task_cancelled', 'workflow_task',
    p_task_id, null, null
  );
end;
$$;
