alter table public.vehicles add column archived_at timestamptz;
alter table public.vehicles add column archived_by uuid references profiles(id);
alter table public.vehicles add column archive_reason text;
alter table public.vehicles add column pre_archive_status vehicle_status;
alter table public.vehicles add column lifecycle_version integer not null default 1;
alter table public.vehicle_categories add column enabled boolean not null default true;
alter table public.vehicle_categories add column lifecycle_version integer not null default 1;
alter table public.vehicle_locations add column enabled boolean not null default true;
alter table public.vehicle_locations add column lifecycle_version integer not null default 1;
-- Archive metadata can only be written by the checked RPC; a direct status edit
-- cannot restore an archived vehicle or fabricate an archive actor/reason.
revoke update,insert,delete on public.vehicles from authenticated;
grant update(plate,category_id,status,odometer_km,fuel_level_percent,battery_level_percent,estimated_range_km,next_service_odometer_km,home_location_id,current_location_id,has_blocking_damage,missing_safety_equipment,documentation_valid,is_clean_exterior,is_clean_interior,updated_at,name,color,photo_storage_path,pre_block_status,vin,next_service_date) on public.vehicles to authenticated;
revoke delete on public.vehicle_categories,public.vehicle_locations from authenticated;
create function public.fm_vehicle_archive_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' then raise exception 'PRESERVE_VEHICLE_HISTORY';end if;
 if new.archived_at is not null and new.status<>'blocked' then raise exception 'VEHICLE_ARCHIVED';end if;return new;
end;$$;
create trigger fm_vehicle_archive_guard before update or delete on public.vehicles for each row execute function public.fm_vehicle_archive_guard();
create function public.fm_reference_preserve() returns trigger language plpgsql set search_path=public as $$begin raise exception 'PRESERVE_REFERENCE_HISTORY';end;$$;
create trigger fm_category_preserve before delete on public.vehicle_categories for each row execute function public.fm_reference_preserve();
create trigger fm_location_preserve before delete on public.vehicle_locations for each row execute function public.fm_reference_preserve();
create function public.fm_vehicle_archived_reservation() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if new.status in ('pending_approval','confirmed') and exists(select 1 from vehicles where id=new.vehicle_id and archived_at is not null) then raise exception 'VEHICLE_ARCHIVED';end if;return new;
end;$$;
create trigger fm_vehicle_archived_reservation before insert or update of vehicle_id,status on public.reservations for each row execute function public.fm_vehicle_archived_reservation();
create function public.fm_archived_operational_record() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if exists(select 1 from vehicles where id=new.vehicle_id and archived_at is not null) then
  if TG_TABLE_NAME='fm_energy_events' then raise exception 'VEHICLE_ARCHIVED';end if;
  if TG_TABLE_NAME='fm_work_orders' and new.status not in ('completed','cancelled') then raise exception 'VEHICLE_ARCHIVED';end if;
 end if;return new;
end;$$;
create trigger fm_archived_work_order before insert or update on public.fm_work_orders for each row execute function public.fm_archived_operational_record();
create trigger fm_archived_energy before insert on public.fm_energy_events for each row execute function public.fm_archived_operational_record();
create function public.fm_reference_enabled_guard() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if (TG_OP='INSERT' or new.category_id is distinct from old.category_id) and not exists(select 1 from vehicle_categories where id=new.category_id and organization_id=new.organization_id and enabled) then raise exception 'INVALID_REFERENCE';end if;
 if (TG_OP='INSERT' or new.home_location_id is distinct from old.home_location_id) and new.home_location_id is not null and not exists(select 1 from vehicle_locations where id=new.home_location_id and organization_id=new.organization_id and enabled) then raise exception 'INVALID_REFERENCE';end if;
 if (TG_OP='INSERT' or new.current_location_id is distinct from old.current_location_id) and new.current_location_id is not null and not exists(select 1 from vehicle_locations where id=new.current_location_id and organization_id=new.organization_id and enabled) then raise exception 'INVALID_REFERENCE';end if;return new;
end;$$;
create trigger fm_reference_enabled_guard before insert or update of category_id,home_location_id,current_location_id on public.vehicles for each row execute function public.fm_reference_enabled_guard();
create function public.fm_fleet_lifecycle(p_kind text,p_id uuid,p_enabled boolean,p_version integer,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
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
end;$$;
create function public.fm_fleet_archive_workspace() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();
begin
 if v_org is null or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'plate',v.plate,'name',v.name,'archived_at',v.archived_at,'reason',v.archive_reason,'version',v.lifecycle_version) order by archived_at desc,v.id) from vehicles v where v.organization_id=v_org and v.archived_at is not null and fm_can_manage_vehicle(v.id)),'[]'::jsonb),
 'categories',case when coalesce(fm_is_limited_manager(),false) then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'version',lifecycle_version) order by name,id) from vehicle_categories where organization_id=v_org and not enabled),'[]'::jsonb) end,
 'locations',case when coalesce(fm_is_limited_manager(),false) then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'version',lifecycle_version) order by name,id) from vehicle_locations where organization_id=v_org and not enabled),'[]'::jsonb) end);
end;$$;
revoke all on function public.fm_vehicle_archive_guard(),public.fm_reference_preserve(),public.fm_vehicle_archived_reservation(),public.fm_archived_operational_record(),public.fm_reference_enabled_guard() from public,anon,authenticated;
revoke all on function public.fm_fleet_lifecycle(text,uuid,boolean,integer,text,uuid),public.fm_fleet_archive_workspace() from public,anon;
grant execute on function public.fm_fleet_lifecycle(text,uuid,boolean,integer,text,uuid),public.fm_fleet_archive_workspace() to authenticated;
-- Catalog lifecycle fields also require the audited command, not a direct update.
revoke update on public.vehicle_categories,public.vehicle_locations from authenticated;
grant update(name,passenger_capacity,supports_cargo,energy_type) on public.vehicle_categories to authenticated;
grant update(name) on public.vehicle_locations to authenticated;
-- Leaving a legacy participation changes state; the row remains as evidence.
alter table public.trip_participants add column left_at timestamptz;
alter table public.trip_participants add column left_by uuid references profiles(id);
revoke delete on public.trip_participants from authenticated;
create function public.leave_legacy_participation(p_id uuid) returns void language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_before text;
begin
 select status into v_before from trip_participants where id=p_id and organization_id=v_org and passenger_id=auth.uid() for update;
 if not found then raise exception 'NOT_AUTHORIZED';end if;
 if exists(select 1 from trip_participants where id=p_id and left_at is not null) then return;end if;
 if v_before not in ('pending','accepted') then raise exception 'INVALID_STATE_TRANSITION';end if;
 update trip_participants set status='rejected',left_at=now(),left_by=auth.uid() where id=p_id;
 perform log_audit_event(v_org,auth.uid(),'carpool.legacy_left','trip_participant',p_id,jsonb_build_object('status',v_before),jsonb_build_object('status','rejected','reason','passenger_left'));
end;$$;
revoke all on function public.leave_legacy_participation(uuid) from public,anon;
grant execute on function public.leave_legacy_participation(uuid) to authenticated;

create or replace function public.fm_vehicle_dossier(p_vehicle_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_role user_role:=current_user_role();v_result jsonb;
begin
 if v_org is null or not exists(select 1 from vehicles where id=p_vehicle_id and organization_id=v_org) or not (fm_can_manage_vehicle(p_vehicle_id) or v_role='maintenance_operator') then raise exception 'NOT_AUTHORIZED';end if;
 select jsonb_build_object('generated_at',now(),'vehicle',jsonb_build_object('id',v.id,'plate',v.plate,'name',v.name,'vin',v.vin,'status',v.status,'odometer_km',v.odometer_km,'next_service_date',v.next_service_date,'next_service_odometer_km',v.next_service_odometer_km,'archived_at',v.archived_at,'archive_reason',v.archive_reason),
 'unit',(select u.name from fm_vehicle_units m join fm_units u on u.id=m.unit_id where m.vehicle_id=v.id and m.organization_id=v_org),
 'orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at,o.id) from fm_work_orders o where o.vehicle_id=v.id and o.organization_id=v_org),'[]'::jsonb),
 'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from fm_work_order_lines l join fm_work_orders o on o.id=l.work_order_id where o.vehicle_id=v.id and l.organization_id=v_org),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from fm_budget_approvals a join fm_work_orders o on o.id=a.work_order_id where o.vehicle_id=v.id and a.organization_id=v_org),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'target_kind',d.target_kind,'target_id',d.target_id,'category',d.category,'filename',d.filename,'state',d.state,'sha256',d.sha256,'created_at',d.created_at,'invalidation_reason',d.invalidation_reason) order by d.created_at,d.id) from fm_documents d where d.vehicle_id=v.id and d.organization_id=v_org and d.state<>'pending'),'[]'::jsonb),
 'equipment_contracts',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from fm_equipment_contracts c where c.vehicle_id=v.id and c.organization_id=v_org),'[]'::jsonb),
 'energy',case when v_role in ('fleet_manager','administrator') then coalesce((select jsonb_agg(to_jsonb(e) order by e.event_at,e.id) from fm_energy_events e where e.vehicle_id=v.id and e.organization_id=v_org),'[]'::jsonb) else null end)
 into v_result from vehicles v where v.id=p_vehicle_id and v.organization_id=v_org;
 perform log_audit_event(v_org,auth.uid(),'vehicle.dossier_export','vehicle',p_vehicle_id,null,jsonb_build_object('scope','maintenance_history'));
 return v_result;
end;$$;
