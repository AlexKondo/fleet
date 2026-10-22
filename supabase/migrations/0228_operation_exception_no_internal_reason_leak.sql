-- T1-D01 (P2) - EXPAND (CREATE OR REPLACE; signature, grants and search_path unchanged).
-- The internal reason typed by the manager/security was copied into reservations.cancellation_reason (readable by the requester) and into the
-- requester's notification text. The reason stays ONLY in fm_operation_exceptions / audit (authorized readers). The reservation now carries a fixed
-- code 'operation_exception:<outcome>' and the notification a fixed text.
CREATE OR REPLACE FUNCTION public.fm_operation_exception(p_reservation_id uuid, p_outcome text, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_role user_role;v_res reservations%rowtype;v_vehicle vehicles%rowtype;
 v_requester uuid;v_workflow text;v_unit uuid;v_custodian boolean;v_manager boolean;v_created uuid;v_receipt fm_command_receipts%rowtype;
 v_payload jsonb:=jsonb_build_object('reservation_id',p_reservation_id,'outcome',p_outcome,'reason',p_reason);
 v_gate uuid;v_after vehicle_status;v_id uuid;v_result jsonb;
begin
 if v_org is null or v_actor is null then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_reservation_id is null or p_outcome is null or p_outcome not in ('not_departed','departed_unrecorded')
  or p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'INVALID_INPUT';end if;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org;
 if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or not fm_account_enabled() then raise exception 'NOT_AUTHORIZED';end if;
 select * into v_vehicle from vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org for update;
 if v_res.vehicle_id is distinct from v_vehicle.id then raise exception 'CONCURRENT_UPDATE';end if;
 select role into v_role from profiles where id=v_actor and organization_id=v_org;
 select requester_id into v_requester from trip_requests where id=v_res.trip_request_id and organization_id=v_org;
 v_workflow:=fm_reservation_workflow(p_reservation_id);
 select m.unit_id into v_unit from fm_vehicle_units m where m.vehicle_id=v_vehicle.id and m.organization_id=v_org;
 v_custodian:=v_workflow='key_custody' and exists(select 1 from fm_key_custodians c join fm_units u on u.id=c.unit_id and u.organization_id=c.organization_id
  where c.unit_id=v_unit and c.organization_id=v_org and c.user_id=v_actor and c.enabled and u.enabled and u.workflow='key_custody');
 v_manager:=v_role in ('fleet_manager','administrator') and fm_can_manage_reservation(p_reservation_id);
 if p_outcome='departed_unrecorded' then
  if v_workflow='key_custody' then raise exception 'OFFICE_HAS_NO_GATE';end if;
  if v_role is distinct from 'security' then raise exception 'NOT_AUTHORIZED';end if;
 elsif not ((v_workflow='gate_visual' and v_role='security') or v_custodian or v_manager) then raise exception 'NOT_AUTHORIZED';end if;
 if v_actor=v_requester then raise exception 'INDEPENDENT_ACTOR_REQUIRED';end if;
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload)
 values(v_org,p_request_id,v_actor,'operation.exception',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'operation.exception' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;
 if v_res.status<>'confirmed' then raise exception 'RESERVATION_NOT_CONFIRMED';end if;
 if exists(select 1 from fm_gate_events where reservation_id=p_reservation_id and kind='departure') then raise exception 'PHYSICAL_DEPARTURE_ALREADY_RECORDED';end if;
 if p_outcome='departed_unrecorded' then
  if now()<=v_res.end_at then raise exception 'EXCEPTION_NOT_REQUIRED';end if;
  insert into fm_gate_events(organization_id,reservation_id,vehicle_id,kind,reason,created_by)
  values(v_org,p_reservation_id,v_vehicle.id,'departure','EXCEPTION: '||left(trim(p_reason),980),v_actor) returning id into v_gate;
  v_after:=case when v_vehicle.status in ('available','reserved','awaiting_pickup') then 'in_use'::vehicle_status else v_vehicle.status end;
 else
  if v_vehicle.status in ('in_use','returning') or (v_workflow='key_custody' and exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup')) then raise exception 'VEHICLE_ON_TRIP';end if;
  if exists(select 1 from fm_key_events e where e.reservation_id=p_reservation_id and e.kind='delivered')
   and not exists(select 1 from fm_key_events e where e.reservation_id=p_reservation_id and e.kind='received') then raise exception 'KEYS_OUTSTANDING';end if;
  update reservations set status='cancelled',cancelled_by=v_actor,cancelled_at=now(),cancellation_reason='operation_exception:'||p_outcome where id=p_reservation_id;
  v_after:=case
   when v_vehicle.status not in ('reserved','awaiting_pickup') then v_vehicle.status
   when exists(select 1 from reservations r where r.vehicle_id=v_vehicle.id and r.id<>p_reservation_id and r.status='confirmed'
    and exists(select 1 from inspections i where i.reservation_id=r.id and i.type='pickup') and not exists(select 1 from inspections i where i.reservation_id=r.id and i.type='return')) then v_vehicle.status
   when not v_vehicle.documentation_valid then 'blocked'::vehicle_status
   when exists(select 1 from fm_work_orders o where o.vehicle_id=v_vehicle.id and o.organization_id=v_org and o.status in ('in_progress','partial')) then 'maintenance'::vehicle_status
   when v_vehicle.has_blocking_damage or coalesce(cardinality(v_vehicle.missing_safety_equipment),0)>0 then 'maintenance'::vehicle_status
   when exists(select 1 from reservations r where r.vehicle_id=v_vehicle.id and r.id<>p_reservation_id and r.status='confirmed') then 'reserved'::vehicle_status
   else 'available'::vehicle_status end;
  insert into notifications(organization_id,user_id,title,body,entity_type,entity_id)
  values(v_org,v_requester,'Reserva encerrada por exceção','Sua reserva foi encerrada por exceção operacional. Para mais informações, procure a gestão da frota.','reservation',p_reservation_id);
 end if;
 if v_after is distinct from v_vehicle.status then update vehicles set status=v_after,updated_at=now() where id=v_vehicle.id;end if;
 insert into fm_operation_exceptions(organization_id,reservation_id,vehicle_id,unit_id,workflow,outcome,reason,actor_id,actor_role,gate_event_id,reservation_status_before,vehicle_status_before,vehicle_status_after)
 values(v_org,p_reservation_id,v_vehicle.id,v_unit,v_workflow,p_outcome,trim(p_reason),v_actor,v_role,v_gate,v_res.status,v_vehicle.status,v_after) returning id into v_id;
 perform log_audit_event(v_org,v_actor,'operation.exception','reservation',p_reservation_id,
  jsonb_build_object('status',v_res.status,'vehicle_status',v_vehicle.status),
  jsonb_build_object('outcome',p_outcome,'reason',trim(p_reason),'exception_id',v_id,'gate_event_id',v_gate,'vehicle_status',v_after,'workflow',v_workflow,'actor_role',v_role));
 v_result:=jsonb_build_object('id',v_id,'ok',true,'outcome',p_outcome,'vehicle_status',v_after);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$function$;
