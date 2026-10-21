-- 0205 (FIX-SQL-2 / SQL-3): damage reported at pickup kept the vehicle blocked forever.
-- fm_gate_record_pickup sets has_blocking_damage and opens a 'repair' workflow task; the gate then refuses the departure
-- (DEPARTURE_BLOCKED) and the office flow keeps the car 'blocked'. Nothing ever cleared the flag: complete_workflow_task (0023) only
-- clears it when the vehicle is in maintenance/cleaning/charging (here it is awaiting_pickup / blocked) and closing the incident
-- (fm_incident_command) never touched the vehicle.
--
-- Release path (existing states only, audited, no new user-callable RPC):
--   * trigger after a 'repair' workflow task goes open/in_progress -> done (complete_workflow_task, also via work_order.completed);
--   * trigger after an incident that represents the damage (kind damage/mechanical, or linked to an inspection that reported damage)
--     goes to resolved/closed (fm_incident_command resolve; close/reopen keep their meaning).
--   Who: whoever may perform those transitions today (RLS of workflow_tasks: fleet_manager/administrator/maintenance_operator, scoped;
--   fm_incident_command: scoped fleet_manager/administrator). Plus independence: the requester of the trip whose pickup/return
--   reported the damage, or the person who recorded that inspection, cannot release it (DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED) -
--   a user never clears their own damage report.
--   When: only if no other damage item is still pending for the vehicle: no open/in_progress 'repair' task and no open
--   (open/analyzing/referred) damage incident. Vehicles in maintenance/cleaning/charging are left to the 0023 rules (unchanged).
--   Effect: has_blocking_damage=false. Status: awaiting_pickup/available/reserved stay as they are (departure is then decided by the
--   usual DEPARTURE_BLOCKED rule, which still checks documentation and safety equipment). An office trip that record_pickup held in
--   'blocked' because of the damage (pre_block_status null, confirmed key_custody reservation with keys delivered and a pickup
--   checklist) gets back the status record_pickup / fm_office_record_return would have produced (in_use, or returning when the return
--   checklist exists) provided no missing safety equipment remains. A manual block (pre_block_status set) stays 'blocked' until
--   "Desbloquear" (0204), which now validates the conditions.
--   Audit: vehicle.damage_hold_released (before/after, source, source_id).
-- Lock order: complete_workflow_task already holds the vehicle row; fm_incident_command holds organization -> incident, the trigger
-- then locks the vehicle (nothing locks vehicle -> incident). Helpers are internal (no EXECUTE for anon/authenticated).
-- Classification: EXPAND for the release itself; the independence refusal narrows complete_workflow_task / incident resolve for the
-- reporter only (contract part, documented).

create or replace function public.fm_incident_holds_damage(p_kind text, p_inspection_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $function$
 select coalesce(p_kind in ('damage','mechanical'), false)
     or exists(select 1 from inspections i where i.id = p_inspection_id and i.has_new_damage);
$function$;

create or replace function public.fm_release_damage_hold(p_vehicle_id uuid, p_source text, p_source_id uuid, p_inspection_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
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

create or replace function public.fm_task_damage_release_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
begin
  perform fm_release_damage_hold(new.vehicle_id, 'workflow_task', new.id, new.source_inspection_id);
  return null;
end;
$function$;

create or replace function public.fm_incident_damage_release_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
begin
  if fm_incident_holds_damage(new.kind, new.inspection_id) then
    perform fm_release_damage_hold(new.vehicle_id, 'incident', new.id, new.inspection_id);
  end if;
  return null;
end;
$function$;

drop trigger if exists fm_task_damage_release on public.workflow_tasks;
create trigger fm_task_damage_release
  after update of status on public.workflow_tasks
  for each row
  when (new.type = 'repair' and new.status = 'done' and old.status in ('open','in_progress'))
  execute function public.fm_task_damage_release_trg();

drop trigger if exists fm_incident_damage_release on public.fm_incidents;
create trigger fm_incident_damage_release
  after update of status on public.fm_incidents
  for each row
  when (new.status in ('resolved','closed') and old.status not in ('resolved','closed'))
  execute function public.fm_incident_damage_release_trg();

revoke all on function public.fm_incident_holds_damage(text,uuid) from public, anon, authenticated;
revoke all on function public.fm_release_damage_hold(uuid,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.fm_task_damage_release_trg() from public, anon, authenticated;
revoke all on function public.fm_incident_damage_release_trg() from public, anon, authenticated;
