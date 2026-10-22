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
$function$

