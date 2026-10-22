-- Rollback of 0215: restores the bodies captured with pg_get_functiondef BEFORE 0215 (database at 0214) and drops the helpers.
-- ACL of the restored functions is untouched by create or replace.

-- fm_release_damage_hold
CREATE OR REPLACE FUNCTION public.fm_release_damage_hold(p_vehicle_id uuid, p_source text, p_source_id uuid, p_inspection_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_vehicle vehicles%rowtype;
  v_status vehicle_status;
  v_trip uuid;
begin
  select * into v_vehicle from vehicles where id = p_vehicle_id for update;
  if not found or not v_vehicle.has_blocking_damage then return false; end if;
  -- maintenance / cleaning / charging: complete_workflow_task / cancel_workflow_task (0023) decide, unchanged.
  if v_vehicle.status in ('maintenance','cleaning','charging') then return false; end if;
  -- another damage item still pending -> keep the hold
  if exists(select 1 from workflow_tasks t where t.vehicle_id = p_vehicle_id and t.organization_id = v_vehicle.organization_id
            and t.type = 'repair' and t.status in ('open','in_progress')) then return false; end if;
  if exists(select 1 from fm_incidents c where c.vehicle_id = p_vehicle_id and c.organization_id = v_vehicle.organization_id
            and c.status in ('open','analyzing','referred') and fm_incident_holds_damage(c.kind, c.inspection_id)) then return false; end if;

  -- independence: nobody releases a damage they reported or that was reported on their own trip
  if v_actor is not null and exists(
       select 1 from inspections i
       join reservations r on r.id = i.reservation_id and r.organization_id = i.organization_id
       join trip_requests t on t.id = r.trip_request_id and t.organization_id = r.organization_id
       where i.vehicle_id = p_vehicle_id and i.organization_id = v_vehicle.organization_id and i.has_new_damage
         and (i.id = p_inspection_id or r.status = 'confirmed')
         and (t.requester_id = v_actor or i.performed_by = v_actor)) then
    raise exception 'DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED';
  end if;

  v_status := v_vehicle.status;
  if v_vehicle.status = 'blocked' and v_vehicle.pre_block_status is null and v_vehicle.archived_at is null
     and coalesce(cardinality(v_vehicle.missing_safety_equipment), 0) = 0 then
    select r.id into v_trip from reservations r
      where r.vehicle_id = p_vehicle_id and r.organization_id = v_vehicle.organization_id and r.status = 'confirmed'
        and fm_reservation_workflow(r.id) = 'key_custody'
        and exists(select 1 from fm_key_events k where k.reservation_id = r.id and k.kind = 'delivered')
        and exists(select 1 from inspections i where i.reservation_id = r.id and i.type = 'pickup' and i.actor_role_at_recording is not null)
      order by r.start_at desc limit 1;
    if v_trip is not null then
      v_status := case when exists(select 1 from inspections i where i.reservation_id = v_trip and i.type = 'return' and i.actor_role_at_recording is not null)
                       then 'returning'::vehicle_status else 'in_use'::vehicle_status end;
    end if;
  end if;

  update vehicles set has_blocking_damage = false, status = v_status, updated_at = now() where id = p_vehicle_id;

  perform log_audit_event(
    v_vehicle.organization_id, v_actor, 'vehicle.damage_hold_released', 'vehicle', p_vehicle_id,
    jsonb_build_object('has_blocking_damage', true, 'status', v_vehicle.status),
    jsonb_build_object('has_blocking_damage', false, 'status', v_status, 'source', p_source, 'source_id', p_source_id, 'reservation_id', v_trip)
  );
  return true;
end;
$function$;

-- complete_workflow_task
CREATE OR REPLACE FUNCTION public.complete_workflow_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- cancel_workflow_task
CREATE OR REPLACE FUNCTION public.cancel_workflow_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- cancel_reservation
CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_locked_vehicle_id uuid;
  v_requester_id uuid;
  v_reservation_status reservation_status;
  v_vehicle_status vehicle_status;
  v_caller_role user_role;
  v_other_confirmed_count integer;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
  select vehicle_id into v_locked_vehicle_id from reservations where id=p_reservation_id and organization_id=v_org_id;
  perform 1 from vehicles where id=v_locked_vehicle_id and organization_id=v_org_id for update;
  select r.vehicle_id, r.status, tr.requester_id
    into v_vehicle_id, v_reservation_status, v_requester_id
    from reservations r
    join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id
    for update of r;
  if v_vehicle_id is distinct from v_locked_vehicle_id then raise exception 'CONCURRENT_UPDATE';end if;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_requester_id
     and v_caller_role not in ('fleet_manager', 'administrator') then
    raise exception 'Not authorized to cancel this reservation';
  end if;

  if v_reservation_status not in ('pending_approval', 'confirmed') then
    raise exception 'Cannot cancel a reservation with status %', v_reservation_status;
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status in ('in_use', 'returning') then
    raise exception 'This trip is already underway (vehicle status: %); it can no longer be cancelled, only returned', v_vehicle_status;
  end if;
  -- 0200 (DEF-04): after a recorded pickup checklist, a key delivery or a physical gate movement the reservation is no longer
  -- cancellable; the audited exception path fm_operation_exception (outcome not_departed) closes it instead.
  if exists(select 1 from inspections where reservation_id = p_reservation_id and type = 'pickup')
     or exists(select 1 from fm_key_events where reservation_id = p_reservation_id and kind = 'delivered')
     or exists(select 1 from fm_gate_events where reservation_id = p_reservation_id and kind in ('departure', 'arrival')) then
    raise exception 'CANCEL_BLOCKED_OPERATION_STARTED';
  end if;

  update reservations
    set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
    where id = p_reservation_id and status = v_reservation_status;
  if not found then
    raise exception 'Reservation was modified concurrently, try again';
  end if;

  if v_reservation_status = 'confirmed' and v_vehicle_status in ('reserved', 'awaiting_pickup') then
    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_vehicle_id and id <> p_reservation_id and status = 'confirmed';
    if v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now() where id = v_vehicle_id;
    end if;
  end if;

  if auth.uid() is distinct from v_requester_id then
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (
      v_org_id, v_requester_id, 'Reserva cancelada',
      case when p_reason is not null and length(trim(p_reason)) > 0
        then 'Sua reserva foi cancelada: ' || p_reason
        else 'Sua reserva foi cancelada.'
      end,
      'reservation', p_reservation_id
    );
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_cancelled', 'reservation', p_reservation_id,
    jsonb_build_object('status', v_reservation_status),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason)
  );
end;
$function$;

-- fm_release_expired_reservations
CREATE OR REPLACE FUNCTION public.fm_release_expired_reservations(p_organization_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '2s'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  c record;
  v_res public.reservations%rowtype;
  v_vehicle_status public.vehicle_status;
  v_requester uuid;
  v_grace integer;
  v_reason text;
  v_restored boolean;
  v_released integer := 0;
  v_restored_count integer := 0;
  v_skipped_activity integer := 0;
  v_skipped_locked integer := 0;
begin
  -- Expired open reservations WITH activity are reported, never touched.
  select count(*) into v_skipped_activity
    from reservations r
    left join organization_settings s on s.organization_id = r.organization_id
   where r.status in ('pending_approval', 'confirmed')
     and coalesce(s.auto_release_enabled,false)
     and (p_organization_id is null or r.organization_id = p_organization_id)
     and r.end_at + make_interval(mins => coalesce(s.no_show_release_grace_minutes, 60)) < now()
     and (exists (select 1 from inspections i where i.reservation_id = r.id)
          or exists (select 1 from fm_gate_events g where g.reservation_id = r.id)
          or exists (select 1 from fm_key_events k where k.reservation_id = r.id));

  for c in
    select r.id, r.vehicle_id, r.organization_id
      from reservations r
      left join organization_settings s on s.organization_id = r.organization_id
     where r.status in ('pending_approval', 'confirmed')
       and coalesce(s.auto_release_enabled,false)
     and (p_organization_id is null or r.organization_id = p_organization_id)
       and r.end_at + make_interval(mins => coalesce(s.no_show_release_grace_minutes, 60)) < now()
       and not exists (select 1 from inspections i where i.reservation_id = r.id)
       and not exists (select 1 from fm_gate_events g where g.reservation_id = r.id)
       and not exists (select 1 from fm_key_events k where k.reservation_id = r.id)
     order by r.vehicle_id, r.end_at, r.id
     limit v_limit
  loop
    begin
      -- Canonical order (0194): vehicle first, then the reservation.
      select status into v_vehicle_status from vehicles
       where id = c.vehicle_id and organization_id = c.organization_id
       for update nowait;
      select * into v_res from reservations
       where id = c.id and organization_id = c.organization_id
       for update nowait;
    exception when lock_not_available then
      v_skipped_locked := v_skipped_locked + 1;
      continue;
    end;

    -- Re-check everything under the locks (the row may have moved on since the candidate scan).
    if not exists(select 1 from organization_settings where organization_id=c.organization_id and auto_release_enabled) then continue;end if;
    select coalesce(no_show_release_grace_minutes, 60) into v_grace
      from organization_settings where organization_id = c.organization_id;
    v_grace := coalesce(v_grace, 60);
    if v_res.id is null
       or v_res.vehicle_id is distinct from c.vehicle_id
       or v_res.status not in ('pending_approval', 'confirmed')
       or v_res.end_at + make_interval(mins => v_grace) >= now() then
      continue;
    end if;
    if exists (select 1 from inspections where reservation_id = c.id)
       or exists (select 1 from fm_gate_events where reservation_id = c.id)
       or exists (select 1 from fm_key_events where reservation_id = c.id) then
      v_skipped_activity := v_skipped_activity + 1;
      continue;
    end if;

    v_reason := case when v_res.status = 'confirmed' then 'no_show_auto' else 'expired_unapproved' end;
    update reservations
       set status = 'cancelled', cancelled_by = null, cancelled_at = now(), cancellation_reason = v_reason
     where id = c.id and status = v_res.status;

    v_restored := false;
    if v_res.status = 'confirmed' and v_vehicle_status in ('reserved', 'awaiting_pickup')
       and not exists (select 1 from reservations
                        where vehicle_id = c.vehicle_id and id <> c.id and status = 'confirmed') then
      update vehicles set status = 'available', updated_at = now()
       where id = c.vehicle_id and status = v_vehicle_status
         and not has_blocking_damage and documentation_valid and archived_at is null
         and coalesce(cardinality(missing_safety_equipment),0)=0
         and not exists(select 1 from fm_work_orders o where o.vehicle_id=c.vehicle_id and o.organization_id=c.organization_id and (o.status in ('in_progress','partial') or (o.status='scheduled' and o.scheduled_start<=now() and o.scheduled_end>now())));
      v_restored := found;
    end if;

    select requester_id into v_requester from trip_requests
     where id = v_res.trip_request_id and organization_id = c.organization_id;
    if v_requester is not null then
      insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
      values (
        c.organization_id, v_requester,
        case when v_reason = 'no_show_auto' then 'Reserva não retirada' else 'Solicitação de reserva expirada' end,
        case when v_reason = 'no_show_auto'
          then 'O período da sua reserva terminou sem a retirada do veículo; ela foi cancelada automaticamente. A disponibilidade do veículo foi reavaliada conforme suas condições.'
          else 'O período da sua solicitação de reserva terminou sem aprovação; ela foi cancelada automaticamente.'
        end,
        'reservation', c.id
      );
    end if;

    insert into audit_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, before, after)
    values (
      c.organization_id, null, null, 'reservation.no_show_released', 'reservation', c.id,
      jsonb_build_object('status', v_res.status, 'vehicle_id', c.vehicle_id, 'vehicle_status', v_vehicle_status, 'end_at', v_res.end_at),
      jsonb_build_object('status', 'cancelled', 'reason', v_reason, 'grace_minutes', v_grace,
                         'vehicle_status', case when v_restored then 'available' else v_vehicle_status::text end)
    );

    v_released := v_released + 1;
    if v_restored then v_restored_count := v_restored_count + 1; end if;
  end loop;

  return jsonb_build_object(
    'released', v_released,
    'vehicles_released', v_restored_count,
    'skipped_with_activity', v_skipped_activity,
    'skipped_locked', v_skipped_locked
  );
end;
$function$;

-- fm_key_command
CREATE OR REPLACE FUNCTION public.fm_key_command(p_reservation_id uuid, p_kind text, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_res reservations%rowtype;v_vehicle vehicles%rowtype;
 v_unit uuid;v_version integer;v_requester uuid;v_grace integer;v_created uuid;v_receipt fm_command_receipts%rowtype;v_result jsonb;v_id uuid;
 v_payload jsonb:=jsonb_build_object('reservation_id',p_reservation_id,'kind',p_kind,'reason',p_reason);
begin
 if v_org is null or v_actor is null then raise exception 'NOT_AUTHORIZED';end if;
 if to_regclass('public.fm_reservation_operations') is null then raise exception 'OFFICE_WORKFLOW_UNAVAILABLE';end if;
 if p_request_id is null or p_kind is null or p_kind not in ('delivered','received','exception')
 or (p_reason is not null and length(trim(p_reason)) not between 3 and 1000) or (p_kind='exception' and p_reason is null) then raise exception 'INVALID_INPUT';end if;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org;
 if not found then raise exception 'NOT_FOUND';end if;
 -- Organization lock shares ordering with administrative revocation, so a
 -- custodian cannot use a stale assignment during a concurrent revocation.
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or not fm_account_enabled() then raise exception 'NOT_AUTHORIZED';end if;
 select * into v_vehicle from vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org for update;
 if v_res.vehicle_id is distinct from v_vehicle.id then raise exception 'CONCURRENT_UPDATE';end if;
 select m.unit_id,c.version into v_unit,v_version from fm_vehicle_units m join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id
 join fm_key_custodians c on c.unit_id=m.unit_id and c.organization_id=m.organization_id
 where m.vehicle_id=v_vehicle.id and m.organization_id=v_org and u.enabled and u.workflow='key_custody' and c.user_id=v_actor and c.enabled;
 if v_unit is null then raise exception 'KEY_CUSTODY_NOT_AUTHORIZED';end if;
 select requester_id into v_requester from trip_requests where id=v_res.trip_request_id and organization_id=v_org;
 if v_actor=v_requester then raise exception 'INDEPENDENT_CUSTODIAN_REQUIRED';end if;
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload)
 values(v_org,p_request_id,v_actor,'keys.record',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'keys.record' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;
 if p_kind<>'exception' and exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind=p_kind) then raise exception 'KEY_EVENT_ALREADY_RECORDED';end if;
 if p_kind='delivered' then
  perform fm_assert_can_drive(v_requester,v_org);
  if v_res.status<>'confirmed' then raise exception 'RESERVATION_NOT_CONFIRMED';end if;
  select early_pickup_grace_minutes into v_grace from organization_settings where organization_id=v_org;
  if now()<v_res.start_at-make_interval(mins=>coalesce(v_grace,15)) or now()>=v_res.end_at then raise exception 'PICKUP_WINDOW_INVALID';end if;
  if v_vehicle.status not in ('available','reserved','awaiting_pickup') or v_vehicle.has_blocking_damage or cardinality(v_vehicle.missing_safety_equipment)>0 then raise exception 'VEHICLE_NOT_READY';end if;
  if not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=v_requester and p.organization_id=v_org
   and p.driver_authorized and p.drivers_license_expiration>=(now() at time zone 'America/Sao_Paulo')::date and coalesce(a.enabled,true)) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
  if exists(select 1 from fm_key_events e where e.vehicle_id=v_vehicle.id and e.kind='delivered' and not exists(select 1 from fm_key_events r where r.reservation_id=e.reservation_id and r.kind='received')) then raise exception 'KEYS_OUTSTANDING';end if;
 elsif p_kind='received' then
  if not exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered') then raise exception 'KEY_DELIVERY_REQUIRED';end if;
 end if;
 insert into fm_key_events(organization_id,unit_id,reservation_id,vehicle_id,actor_id,actor_role,assignment_version,kind,reason)
 values(v_org,v_unit,p_reservation_id,v_vehicle.id,v_actor,current_user_role(),v_version,p_kind,trim(p_reason)) returning id into v_id;
 -- A key handover is not a vehicle inspection, physical gate movement or an
 -- authorization to release damage. Those workflows remain separate.
 perform log_audit_event(v_org,v_actor,'keys.'||p_kind,'reservation',p_reservation_id,null,jsonb_build_object('event_id',v_id,'unit_id',v_unit,'assignment_version',v_version,'reason',p_reason));
 v_result:=jsonb_build_object('id',v_id);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$function$;

-- record_pickup
CREATE OR REPLACE FUNCTION public.record_pickup(p_reservation_id uuid, p_odometer_km integer, p_fuel_level_percent numeric, p_battery_level_percent numeric, p_has_damage boolean, p_damage_notes text, p_missing_safety_equipment text[], p_is_dirty_exterior boolean, p_is_dirty_interior boolean, p_role inspection_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid:=current_organization_id();v_vehicle uuid;v_id uuid;
begin
 select vehicle_id into v_vehicle from reservations where id=p_reservation_id and organization_id=v_org;
 if fm_reservation_workflow(p_reservation_id)='key_custody' then
  if p_role is distinct from 'traveler' then raise exception 'OFFICE_DRIVER_CHECKLIST_ONLY';end if;
  perform 1 from organizations where id=v_org for no key update;
  perform 1 from vehicles where id=v_vehicle and organization_id=v_org for update;
  if not exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered') then raise exception 'KEY_DELIVERY_REQUIRED';end if;
  -- Exact retry after the trip started stays idempotent. A receipt without a
  -- pickup, however, ends the key handover and cannot start a new trip.
  if exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='received') and not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by=auth.uid() and actor_role_at_recording is not null) then raise exception 'KEYS_ALREADY_RECEIVED';end if;
  v_id:=fm_gate_record_pickup(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role);
  -- The driver's digital pickup starts the office trip. This is not an IRA
  -- physical gate event. Damage/missing equipment holds the car blocked.
  update vehicles set status=case when status='blocked' or has_blocking_damage or cardinality(missing_safety_equipment)>0 then 'blocked'::vehicle_status else 'in_use'::vehicle_status end,updated_at=now() where id=v_vehicle and status in ('awaiting_pickup','in_use','blocked');
  return v_id;
 end if;
 return fm_gate_record_pickup(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role);
end;$function$;

drop function if exists public.fm_vehicle_unsafe_status(uuid, uuid);
drop function if exists public.fm_vehicle_unsafe_reason(uuid, uuid);
