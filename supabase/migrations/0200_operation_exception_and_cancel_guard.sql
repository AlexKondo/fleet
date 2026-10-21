-- Pacote 01 corrections DEF-03 (DEC-01 D1-08) and DEF-04.
-- DEF-03: a forgotten physical departure on a gate unit locked the trip after end_at (departure OUTSIDE_RESERVATION_WINDOW,
-- arrival PHYSICAL_DEPARTURE_REQUIRED, return VEHICLE_NOT_ON_TRIP) and the only way out, cancel_reservation, left the vehicle in
-- awaiting_pickup. New audited exception command fm_operation_exception(reservation, outcome, reason, request_id):
--  * outcome 'not_departed'  - the vehicle did not leave: closes the reservation (status cancelled, reason kept), normalises the
--    vehicle (awaiting_pickup/reserved -> available, reserved if other confirmed reservations, maintenance if the checklists
--    reported blocking damage / missing equipment). Actors: security (gate units), enabled key custodian of the vehicle's unit
--    (key-custody units, keys must be back: KEYS_OUTSTANDING otherwise), fleet_manager in scope or administrator.
--  * outcome 'departed_unrecorded' - the vehicle left but nobody registered it (only after end_at): records the departure as an
--    exception gate event (reason 'EXCEPTION: ...'), vehicle in_use; then the normal arrival + return checklists follow.
--    Actor: security only (it is a physical attestation; DEC-01 managers do not substitute the gate). The departure trigger
--    still requires both independent checklists, the requester's CNH and damage evidence.
--  * never the requester (INDEPENDENT_ACTOR_REQUIRED); idempotent by request_id (fm_command_receipts); evidence preserved
--    (inspections / key / gate events untouched, new append-only table fm_operation_exceptions + audit 'operation.exception').
-- DEF-04: cancel_reservation refuses (CANCEL_BLOCKED_OPERATION_STARTED) once a pickup checklist, a key delivery or a gate
-- movement exists. Lock order follows 0194: organization (no key update) -> vehicle -> reservation.
create table if not exists public.fm_operation_exceptions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 reservation_id uuid not null references public.reservations(id),
 vehicle_id uuid not null references public.vehicles(id),
 unit_id uuid,
 workflow text not null check(workflow in ('gate_visual','key_custody')),
 outcome text not null check(outcome in ('not_departed','departed_unrecorded')),
 reason text not null check(length(trim(reason)) between 3 and 1000),
 actor_id uuid not null references public.profiles(id),
 actor_role public.user_role not null,
 gate_event_id uuid references public.fm_gate_events(id),
 reservation_status_before public.reservation_status not null,
 vehicle_status_before public.vehicle_status not null,
 vehicle_status_after public.vehicle_status not null,
 created_at timestamptz not null default now(),
 unique(reservation_id,outcome)
);
create index if not exists fm_operation_exceptions_scope on public.fm_operation_exceptions(organization_id,created_at desc);
alter table public.fm_operation_exceptions enable row level security;
revoke all on public.fm_operation_exceptions from public,anon,authenticated;
grant select on public.fm_operation_exceptions to authenticated;
drop policy if exists fm_active_account on public.fm_operation_exceptions;
create policy fm_active_account on public.fm_operation_exceptions as restrictive to authenticated using ((select public.fm_account_enabled())) with check ((select public.fm_account_enabled()));
drop policy if exists fm_operation_exceptions_read on public.fm_operation_exceptions;
create policy fm_operation_exceptions_read on public.fm_operation_exceptions for select to authenticated
 using (organization_id=(select public.current_organization_id()) and (actor_id=(select auth.uid()) or (select public.current_user_role()) in ('fleet_manager','administrator','security')));
drop policy if exists fm_scope_operation_exceptions_read on public.fm_operation_exceptions;
create policy fm_scope_operation_exceptions_read on public.fm_operation_exceptions as restrictive for select to authenticated
 using ((not coalesce((select public.fm_is_limited_manager()),false)) or public.fm_can_manage_vehicle(vehicle_id));
drop trigger if exists fm_operation_exceptions_append_only on public.fm_operation_exceptions;
create trigger fm_operation_exceptions_append_only before update or delete on public.fm_operation_exceptions for each row execute function public.fm_preserve_inspection_evidence();
drop trigger if exists fm_operation_exceptions_no_truncate on public.fm_operation_exceptions;
create trigger fm_operation_exceptions_no_truncate before truncate on public.fm_operation_exceptions for each statement execute function public.fm_preserve_inspection_evidence();

create or replace function public.fm_operation_exception(p_reservation_id uuid,p_outcome text,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
  update reservations set status='cancelled',cancelled_by=v_actor,cancelled_at=now(),cancellation_reason=left(trim(p_reason),1000) where id=p_reservation_id;
  v_after:=case
   when v_vehicle.status not in ('reserved','awaiting_pickup') then v_vehicle.status
   when exists(select 1 from reservations r where r.vehicle_id=v_vehicle.id and r.id<>p_reservation_id and r.status='confirmed'
    and exists(select 1 from inspections i where i.reservation_id=r.id and i.type='pickup') and not exists(select 1 from inspections i where i.reservation_id=r.id and i.type='return')) then v_vehicle.status
   when v_vehicle.has_blocking_damage or coalesce(cardinality(v_vehicle.missing_safety_equipment),0)>0 then 'maintenance'::vehicle_status
   when exists(select 1 from reservations r where r.vehicle_id=v_vehicle.id and r.id<>p_reservation_id and r.status='confirmed') then 'reserved'::vehicle_status
   else 'available'::vehicle_status end;
  insert into notifications(organization_id,user_id,title,body,entity_type,entity_id)
  values(v_org,v_requester,'Reserva encerrada por exceção','Sua reserva foi encerrada por exceção operacional: '||left(trim(p_reason),300),'reservation',p_reservation_id);
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
end;$$;
revoke all on function public.fm_operation_exception(uuid,text,text,uuid) from public,anon;
grant execute on function public.fm_operation_exception(uuid,text,text,uuid) to authenticated;

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
revoke all on function public.cancel_reservation(uuid,text) from public,anon;
grant execute on function public.cancel_reservation(uuid,text) to authenticated;
