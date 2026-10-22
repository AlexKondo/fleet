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
  if v_vehicle.status not in ('available','reserved','awaiting_pickup') or v_vehicle.has_blocking_damage or cardinality(v_vehicle.missing_safety_equipment)>0
   or public.fm_vehicle_unsafe_reason(v_vehicle.id) is not null then raise exception 'VEHICLE_NOT_READY';end if; -- 0215 (S1-05): single safety check (documentation, work order, archived)
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
end;$function$

