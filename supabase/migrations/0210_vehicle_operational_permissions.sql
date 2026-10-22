-- Incremental permission contraction. Existing applied migrations remain byte-for-byte unchanged.
-- INVOKER routines relied on broad UPDATE grants; recreate exact supplied bodies with explicit guards.
-- auth.uid/current_organization_id retain the session identity inside these DEFINER functions.


create or replace function approve_reservation(p_reservation_id uuid)
returns void
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
  v_requester_id uuid;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if public.current_user_role() not in ('fleet_manager','administrator') or not coalesce(public.fm_can_manage_reservation(p_reservation_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

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

  if v_vehicle_status = 'available' then
    update vehicles set status = 'reserved', updated_at = now() where id = v_vehicle_id;
  end if;

  select tr.requester_id into v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id;

  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
  values (
    current_organization_id(), v_requester_id, 'Reserva aprovada',
    'Sua reserva foi aprovada e o veículo está confirmado.',
    'reservation', p_reservation_id
  );

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_approved', 'reservation',
    p_reservation_id, null, jsonb_build_object('status', 'confirmed')
  );
end;
$$;

create or replace function swap_reservation_vehicle(p_reservation_id uuid, p_new_vehicle_id uuid)
returns void
language plpgsql security definer set search_path=public,pg_temp
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
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if public.current_user_role() not in ('fleet_manager','administrator') or not coalesce(public.fm_can_manage_reservation(p_reservation_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 if not coalesce(public.fm_can_manage_vehicle(p_new_vehicle_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

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

create or replace function complete_workflow_task(p_task_id uuid)
returns void
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_vehicle_id uuid;
  v_task_type workflow_task_type;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if not exists(select 1 from public.workflow_tasks t where t.id=p_task_id and t.organization_id=public.current_organization_id() and (public.current_user_role()='maintenance_operator' or (public.current_user_role() in ('fleet_manager','administrator') and public.fm_can_manage_vehicle(t.vehicle_id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

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
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_vehicle_id uuid;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if not exists(select 1 from public.workflow_tasks t where t.id=p_task_id and t.organization_id=public.current_organization_id() and (public.current_user_role()='maintenance_operator' or (public.current_user_role() in ('fleet_manager','administrator') and public.fm_can_manage_vehicle(t.vehicle_id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

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

create or replace function block_vehicle(p_vehicle_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if public.current_user_role() not in ('fleet_manager','administrator') or not coalesce(public.fm_can_manage_vehicle(p_vehicle_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

  update vehicles
    set pre_block_status = status, status = 'blocked', updated_at = now()
    where id = p_vehicle_id
      and organization_id = current_organization_id()
      and status not in ('in_use', 'returning', 'blocked');
  if not found then
    raise exception 'Vehicle cannot be blocked from its current status';
  end if;

  insert into workflow_tasks (organization_id, vehicle_id, type, notes)
  values (current_organization_id(), p_vehicle_id, 'safety', p_reason);

  insert into notifications (organization_id, user_id, title, body)
  select current_organization_id(), profiles.id, 'Veículo bloqueado',
    coalesce('Motivo: ' || p_reason, 'Um veículo foi bloqueado.')
  from profiles
  where profiles.organization_id = current_organization_id()
    and profiles.role in ('fleet_manager', 'administrator');

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'vehicle_blocked', 'vehicle', p_vehicle_id,
    null, jsonb_build_object('reason', p_reason)
  );
end;
$$;

create or replace function public.unblock_vehicle(p_vehicle_id uuid)
 returns void
 language plpgsql security definer
 set search_path = public, pg_temp
as $function$
declare
  v_vehicle vehicles%rowtype;
  v_pending text[] := '{}';
  v_restored_status vehicle_status;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if public.current_user_role() not in ('fleet_manager','administrator') or not coalesce(public.fm_can_manage_vehicle(p_vehicle_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

  select * into v_vehicle from vehicles
    where id = p_vehicle_id and organization_id = current_organization_id()
    for update;
  if not found or v_vehicle.status <> 'blocked' then
    raise exception 'Vehicle is not blocked';
  end if;

  if v_vehicle.has_blocking_damage then v_pending := v_pending || 'has_blocking_damage'::text; end if;
  if not v_vehicle.documentation_valid then v_pending := v_pending || 'documentation_invalid'::text; end if;
  if coalesce(cardinality(v_vehicle.missing_safety_equipment), 0) > 0 then v_pending := v_pending || 'missing_safety_equipment'::text; end if;
  if cardinality(v_pending) > 0 then
    raise exception 'VEHICLE_UNBLOCK_CONDITIONS_PENDING' using detail = array_to_string(v_pending, ',');
  end if;

  update vehicles
    set status = coalesce(pre_block_status, 'available'), pre_block_status = null, updated_at = now()
    where id = p_vehicle_id and organization_id = current_organization_id() and status = 'blocked'
    returning status into v_restored_status;
  if not found then
    raise exception 'Vehicle is not blocked';
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'vehicle_unblocked', 'vehicle', p_vehicle_id,
    null, jsonb_build_object('restored_status', v_restored_status)
  );
end;
$function$;


revoke update on public.vehicles from authenticated;
DO $acl$
declare cols text;
begin
 select string_agg(quote_ident(attname),',') into cols from pg_attribute where attrelid='public.vehicles'::regclass and attnum>0 and not attisdropped;
 execute 'revoke update('||cols||') on public.vehicles from authenticated';
end;$acl$;
grant update(plate,category_id,odometer_km,fuel_level_percent,battery_level_percent,estimated_range_km,next_service_odometer_km,home_location_id,name,color,vin,next_service_date,updated_at) on public.vehicles to authenticated;
create policy fm_direct_vehicle_identity_update on public.vehicles as restrictive for update to authenticated
 using(current_user_role() in ('fleet_manager','administrator') and fm_can_manage_vehicle(id))
 with check(current_user_role() in ('fleet_manager','administrator') and fm_can_manage_vehicle(id));
-- Reference photos are linked only by fm_photo_finalize; damage/status/equipment/doc/archive fields use checked routines.
