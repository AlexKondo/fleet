CREATE OR REPLACE FUNCTION public.fm_fleet_lifecycle(p_kind text, p_id uuid, p_enabled boolean, p_version integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid:=current_organization_id();v_role user_role:=current_user_role();v_vehicle vehicles%rowtype;v_version integer;v_payload jsonb;v_result jsonb;v_created uuid;v_receipt fm_command_receipts%rowtype;v_status vehicle_status;
begin
 if v_org is null or v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 if p_kind is null or p_kind not in ('vehicle','category','location') or p_enabled is null or p_version is null or p_version<1 or p_reason is null or length(trim(p_reason)) not between 3 and 1000 or p_request_id is null then raise exception 'INVALID_INPUT';end if;
 if p_kind='vehicle' and not fm_can_manage_vehicle(p_id) then raise exception 'NOT_AUTHORIZED';end if;
 if p_kind<>'vehicle' and coalesce(fm_is_limited_manager(),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or current_user_role() not in ('fleet_manager','administrator') or (p_kind='vehicle' and not fm_can_manage_vehicle(p_id)) or (p_kind<>'vehicle' and coalesce(fm_is_limited_manager(),false)) then raise exception 'NOT_AUTHORIZED';end if;
 v_payload:=jsonb_build_object('kind',p_kind,'id',p_id,'enabled',p_enabled,'version',p_version,'reason',trim(p_reason));
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,auth.uid(),'fleet.lifecycle',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
 select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
 if v_receipt.actor_id<>auth.uid() or v_receipt.command<>'fleet.lifecycle' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;
 end if;
 if p_kind='vehicle' then
  select * into v_vehicle from vehicles where id=p_id and organization_id=v_org for update;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
  if v_vehicle.lifecycle_version<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
  if not p_enabled then
   if v_vehicle.archived_at is not null then raise exception 'INVALID_STATE_TRANSITION';end if;
   if v_vehicle.status in ('in_use','returning','maintenance') or exists(select 1 from reservations where vehicle_id=p_id and status in ('pending_approval','confirmed')) or exists(select 1 from fm_work_orders where vehicle_id=p_id and status in ('scheduled','in_progress','partial')) or exists(select 1 from fm_key_events e where e.vehicle_id=p_id and e.kind='delivered' and not exists(select 1 from fm_key_events r where r.reservation_id=e.reservation_id and r.kind='received')) then raise exception 'ACTIVE_OPERATION';end if;
   update vehicles set archived_at=now(),archived_by=auth.uid(),archive_reason=trim(p_reason),pre_archive_status=status,status='blocked',lifecycle_version=lifecycle_version+1,updated_at=now() where id=p_id;
  else
   if v_vehicle.archived_at is null then raise exception 'INVALID_STATE_TRANSITION';end if;
   if exists(select 1 from fm_vehicle_units m join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id where m.vehicle_id=p_id and m.organization_id=v_org and not u.enabled) then raise exception 'INVALID_REFERENCE';end if;
   if not exists(select 1 from vehicle_categories where id=v_vehicle.category_id and organization_id=v_org and enabled) or (v_vehicle.home_location_id is not null and not exists(select 1 from vehicle_locations where id=v_vehicle.home_location_id and organization_id=v_org and enabled)) or (v_vehicle.current_location_id is not null and not exists(select 1 from vehicle_locations where id=v_vehicle.current_location_id and organization_id=v_org and enabled)) then raise exception 'INVALID_REFERENCE';end if;
   v_status:=case when v_vehicle.pre_archive_status='blocked' or v_vehicle.has_blocking_damage or not v_vehicle.documentation_valid or cardinality(v_vehicle.missing_safety_equipment)>0 then 'blocked'::vehicle_status else 'available'::vehicle_status end;
   update vehicles set archived_at=null,archived_by=null,archive_reason=null,pre_archive_status=null,status=v_status,lifecycle_version=lifecycle_version+1,updated_at=now() where id=p_id;
  end if;
 elsif p_kind='category' then
  select lifecycle_version into v_version from vehicle_categories where id=p_id and organization_id=v_org for update;
  if v_version is null then raise exception 'NOT_AUTHORIZED';end if;
  if v_version<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
  if not p_enabled and exists(select 1 from vehicles where category_id=p_id and archived_at is null) then raise exception 'ACTIVE_REFERENCE';end if;
  update vehicle_categories set enabled=p_enabled,lifecycle_version=lifecycle_version+1 where id=p_id;
 else
  select lifecycle_version into v_version from vehicle_locations where id=p_id and organization_id=v_org for update;
  if v_version is null then raise exception 'NOT_AUTHORIZED';end if;
  if v_version<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
  if not p_enabled and exists(select 1 from vehicles where (home_location_id=p_id or current_location_id=p_id) and archived_at is null) then raise exception 'ACTIVE_REFERENCE';end if;
  update vehicle_locations set enabled=p_enabled,lifecycle_version=lifecycle_version+1 where id=p_id;
 end if;
 v_result:=v_payload||jsonb_build_object('version',p_version+1);
 perform log_audit_event(v_org,auth.uid(),'fleet.lifecycle',p_kind,p_id,jsonb_build_object('version',p_version),v_result);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$function$

