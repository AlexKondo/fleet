-- Keep historical evidence unchanged. Only new inspections have a verified
-- actor-role snapshot; legacy declarations are not retroactively certified.
alter table public.inspections add column actor_role_at_recording public.user_role;
alter table public.inspections add column recorded_location_id uuid references public.vehicle_locations(id);
alter table public.inspections add column observation_kind text not null default 'legacy' check(observation_kind in ('legacy','driver_checklist','gate_visual'));
alter table public.inspections alter column odometer_km drop not null,alter column missing_safety_equipment drop not null,alter column is_dirty_exterior drop not null,alter column is_dirty_interior drop not null;
alter table public.inspections add constraint fm_observation_fields check(
 observation_kind='legacy' or
 (observation_kind='driver_checklist' and odometer_km is not null and missing_safety_equipment is not null and is_dirty_exterior is not null and is_dirty_interior is not null) or
 (observation_kind='gate_visual' and odometer_km is null and fuel_level_percent is null and battery_level_percent is null and missing_safety_equipment is null and is_dirty_exterior is null and is_dirty_interior is null and recorded_location_id is null)
);

create unique index fm_verified_inspection_once on public.inspections(reservation_id,type,performed_by_role)
 where actor_role_at_recording is not null;

create function public.fm_verify_inspection_actor() returns trigger
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_role public.user_role;v_requester uuid;v_vehicle uuid;v_status public.reservation_status;
begin
 if v_org is null or new.organization_id is distinct from v_org or new.performed_by is distinct from auth.uid() then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 select role into v_role from profiles where id=auth.uid() and organization_id=v_org;
 perform 1 from vehicles where id=new.vehicle_id and organization_id=v_org for update;
 select r.vehicle_id,r.status,t.requester_id into v_vehicle,v_status,v_requester
 from reservations r join trip_requests t on t.id=r.trip_request_id
 where r.id=new.reservation_id and r.organization_id=v_org and t.organization_id=v_org for update of r;
 if not found or v_vehicle is distinct from new.vehicle_id then raise exception 'RESERVATION_NOT_FOUND';end if;
 if v_status<>'confirmed' then raise exception 'RESERVATION_NOT_CONFIRMED';end if;
 if new.performed_by_role='traveler' then
  if auth.uid() is distinct from v_requester then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 elsif new.performed_by_role='security' then
  if v_role is distinct from 'security' or auth.uid()=v_requester then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 else raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 if new.type='pickup' and not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=v_requester and p.organization_id=v_org and coalesce(a.enabled,true)) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
 if new.performed_by_role='security' then
  new.observation_kind:='gate_visual';new.odometer_km:=null;new.fuel_level_percent:=null;new.battery_level_percent:=null;
  new.missing_safety_equipment:=null;new.is_dirty_exterior:=null;new.is_dirty_interior:=null;new.recorded_location_id:=null;
 else new.observation_kind:='driver_checklist';end if;
 new.actor_role_at_recording:=v_role;
 return new;
end;$$;
create trigger fm_verify_inspection before insert on public.inspections for each row execute function public.fm_verify_inspection_actor();
-- Existing writes are checked RPCs. A direct API insert must not bypass their
-- state transitions, odometer, license, window and idempotency checks.
revoke insert,update,delete,truncate on public.inspections from authenticated,anon;
revoke all on function public.fm_verify_inspection_actor() from public,anon,authenticated;

create or replace function public.record_pickup(
 p_reservation_id uuid,p_odometer_km integer,p_fuel_level_percent numeric,p_battery_level_percent numeric,
 p_has_damage boolean,p_damage_notes text,p_missing_safety_equipment text[],p_is_dirty_exterior boolean,p_is_dirty_interior boolean,p_role public.inspection_role
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_role public.user_role;v_res public.reservations%rowtype;
 v_vehicle public.vehicles%rowtype;v_requester uuid;v_driver public.profiles%rowtype;v_prior public.inspections%rowtype;v_id uuid;v_grace integer;
begin
 if v_org is null or v_actor is null then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org;
 if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
 select * into v_vehicle from vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
 if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org for update;
 if v_res.vehicle_id<>v_vehicle.id then raise exception 'CONCURRENT_UPDATE';end if;
 if v_res.status<>'confirmed' then raise exception 'RESERVATION_NOT_CONFIRMED';end if;
 select requester_id into v_requester from trip_requests where id=v_res.trip_request_id and organization_id=v_org;
 select role into v_role from profiles where id=v_actor and organization_id=v_org;
 if p_role is null or (p_role='traveler' and v_actor is distinct from v_requester)
 or (p_role='security' and (v_role is distinct from 'security' or v_actor=v_requester)) then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 if p_role='security' then p_odometer_km:=null;p_fuel_level_percent:=null;p_battery_level_percent:=null;p_missing_safety_equipment:=null;p_is_dirty_exterior:=null;p_is_dirty_interior:=null;end if;
 select * into v_prior from inspections where reservation_id=p_reservation_id and type='pickup'
 and performed_by_role=p_role and actor_role_at_recording is not null;
 if found then
  if v_prior.performed_by=v_actor and
   jsonb_build_array(v_prior.odometer_km,v_prior.fuel_level_percent,v_prior.battery_level_percent,v_prior.has_new_damage,v_prior.damage_notes,v_prior.missing_safety_equipment,v_prior.is_dirty_exterior,v_prior.is_dirty_interior)
   =jsonb_build_array(p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior) then return v_prior.id;end if;
  raise exception 'INSPECTION_ALREADY_RECORDED';
 end if;
 select * into v_driver from profiles where id=v_requester and organization_id=v_org;
 perform fm_assert_can_drive(v_requester,v_org);
 if not coalesce(v_driver.driver_authorized,false) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
 if v_driver.drivers_license_expiration is null or v_driver.drivers_license_expiration<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'LICENSE_EXPIRED';end if;
 select early_pickup_grace_minutes into v_grace from organization_settings where organization_id=v_org;
 if now()<v_res.start_at-make_interval(mins=>coalesce(v_grace,15)) then raise exception 'EARLY_PICKUP_NOT_ALLOWED';end if;
 if now()>=v_res.end_at then raise exception 'PICKUP_WINDOW_ENDED';end if;
 if p_role='traveler' and (p_odometer_km is null or p_odometer_km<v_vehicle.odometer_km) then raise exception 'ODOMETER_CANNOT_GO_BACKWARDS';end if;
 if v_vehicle.status not in ('available','reserved','awaiting_pickup','in_use') then raise exception 'VEHICLE_NOT_READY';end if;
 if v_vehicle.status='in_use' and not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup') then raise exception 'VEHICLE_NOT_READY';end if;
 if exists(select 1 from inspections i join reservations r on r.id=i.reservation_id where i.vehicle_id=v_vehicle.id and i.reservation_id<>p_reservation_id and i.type='pickup' and r.status='confirmed'
 and not exists(select 1 from inspections x where x.reservation_id=r.id and x.type='return')) then raise exception 'VEHICLE_NOT_READY';end if;
 insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role,odometer_km,fuel_level_percent,battery_level_percent,has_new_damage,damage_notes,missing_safety_equipment,is_dirty_exterior,is_dirty_interior)
 values(v_org,p_reservation_id,v_vehicle.id,'pickup',v_actor,p_role,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior) returning id into v_id;
 -- New pickups remain awaiting_pickup until an explicit physical departure.
 -- Preserve the operational status of legacy trips already marked in_use. A second observer cannot clear
 -- damage or missing equipment reported by the first observer.
 update vehicles set status=case when v_vehicle.status='in_use' then 'in_use'::vehicle_status else 'awaiting_pickup'::vehicle_status end,has_blocking_damage=has_blocking_damage or p_has_damage,
 missing_safety_equipment=array(select distinct x from unnest(vehicles.missing_safety_equipment||p_missing_safety_equipment) x),updated_at=now() where id=v_vehicle.id;
 if p_has_damage and not exists(select 1 from workflow_tasks where vehicle_id=v_vehicle.id and organization_id=v_org and type='repair' and status in ('open','in_progress')) then
  insert into workflow_tasks(organization_id,vehicle_id,type,source_inspection_id,notes) values(v_org,v_vehicle.id,'repair',v_id,'Relato na retirada: analisar sem atribuição automática de responsabilidade.');
 end if;
 if cardinality(p_missing_safety_equipment)>0 and not exists(select 1 from workflow_tasks where vehicle_id=v_vehicle.id and organization_id=v_org and type='safety' and status in ('open','in_progress')) then
  insert into workflow_tasks(organization_id,vehicle_id,type,source_inspection_id) values(v_org,v_vehicle.id,'safety',v_id);
 end if;
 perform log_audit_event(v_org,v_actor,'pickup_inspection_recorded','inspection',v_id,null,jsonb_build_object('reservation_id',p_reservation_id,'inspection_role',p_role,'actor_role',v_role));
 return v_id;
end;$$;
revoke all on function public.record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role) from public,anon;
grant execute on function public.record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role) to authenticated;

-- Keep the public signature; client-suggested event/tasks are never authoritative.
create or replace function public.record_return(
 p_reservation_id uuid,p_odometer_km integer,p_fuel_level_percent numeric,p_battery_level_percent numeric,
 p_has_new_damage boolean,p_damage_notes text,p_missing_safety_equipment text[],p_is_dirty_exterior boolean,p_is_dirty_interior boolean,
 p_role public.inspection_role,p_vehicle_event text,p_workflow_tasks public.workflow_task_type[],p_current_location_id uuid default null
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_role public.user_role;v_res public.reservations%rowtype;v_vehicle public.vehicles%rowtype;
 v_requester uuid;v_prior public.inspections%rowtype;v_id uuid;v_energy public.energy_type;v_damage boolean;v_dirty_out boolean;v_dirty_in boolean;
 v_missing text[];v_odometer integer;v_fuel numeric;v_battery numeric;v_tasks public.workflow_task_type[]:='{}';v_task public.workflow_task_type;v_status public.vehicle_status;
begin
 if v_org is null or v_actor is null then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org;
 if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
 select * into v_vehicle from vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
 if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org for update;
 if v_res.vehicle_id<>v_vehicle.id then raise exception 'CONCURRENT_UPDATE';end if;
 if v_res.status not in ('confirmed','completed') then raise exception 'RESERVATION_NOT_CONFIRMED';end if;
 select requester_id into v_requester from trip_requests where id=v_res.trip_request_id and organization_id=v_org;
 select role into v_role from profiles where id=v_actor and organization_id=v_org;
 if p_role is null or (p_role='traveler' and v_actor is distinct from v_requester)
 or (p_role='security' and (v_role is distinct from 'security' or v_actor=v_requester)) then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 if p_role='security' then p_odometer_km:=null;p_fuel_level_percent:=null;p_battery_level_percent:=null;p_missing_safety_equipment:=null;p_is_dirty_exterior:=null;p_is_dirty_interior:=null;p_current_location_id:=null;end if;
 if p_role='traveler' and (p_current_location_id is null or not exists(select 1 from vehicle_locations where id=p_current_location_id and organization_id=v_org)) then raise exception 'INVALID_CURRENT_LOCATION';end if;
 select * into v_prior from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role=p_role and actor_role_at_recording is not null;
 if found then
  if v_prior.performed_by=v_actor and (v_prior.recorded_location_id is not distinct from p_current_location_id) and
   jsonb_build_array(v_prior.odometer_km,v_prior.fuel_level_percent,v_prior.battery_level_percent,v_prior.has_new_damage,v_prior.damage_notes,v_prior.missing_safety_equipment,v_prior.is_dirty_exterior,v_prior.is_dirty_interior)
   =jsonb_build_array(p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_new_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior) then return v_prior.id;end if;
  raise exception 'INSPECTION_ALREADY_RECORDED';end if;
 if v_res.status<>'confirmed' then raise exception 'RESERVATION_NOT_CONFIRMED';end if;
 if v_vehicle.status not in ('in_use','returning','blocked') then raise exception 'VEHICLE_NOT_ON_TRIP';end if;
 if not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup') then raise exception 'PICKUP_CHECKLIST_REQUIRED';end if;
 if exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and actor_role_at_recording is not null) then
  if not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by_role='traveler' and actor_role_at_recording is not null)
  or not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by_role='security' and actor_role_at_recording='security') then raise exception 'PICKUP_CHECKLIST_REQUIRED';end if;
  if not exists(select 1 from fm_gate_events where reservation_id=p_reservation_id and kind='departure') then raise exception 'PHYSICAL_DEPARTURE_REQUIRED';end if;
  if not exists(select 1 from fm_gate_events where reservation_id=p_reservation_id and kind='arrival') then raise exception 'PHYSICAL_ARRIVAL_REQUIRED';end if;
 end if;
 if p_role='traveler' and (p_odometer_km is null or p_odometer_km<greatest(v_vehicle.odometer_km,coalesce((select max(odometer_km) from inspections where reservation_id=p_reservation_id and type='pickup' and actor_role_at_recording is not null),v_vehicle.odometer_km))) then raise exception 'ODOMETER_CANNOT_GO_BACKWARDS';end if;
 insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role,odometer_km,fuel_level_percent,battery_level_percent,has_new_damage,damage_notes,missing_safety_equipment,is_dirty_exterior,is_dirty_interior,recorded_location_id)
 values(v_org,p_reservation_id,v_vehicle.id,'return',v_actor,p_role,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_new_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_current_location_id) returning id into v_id;
 update vehicles set status=case when v_vehicle.status='blocked' then 'blocked'::vehicle_status else 'returning'::vehicle_status end,updated_at=now() where id=v_vehicle.id;
 if exists(select 1 from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role='traveler' and actor_role_at_recording is not null)
 and exists(select 1 from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role='security' and actor_role_at_recording='security') then
  select bool_or(has_new_damage),bool_or(is_dirty_exterior),bool_or(is_dirty_interior),max(odometer_km),min(fuel_level_percent),min(battery_level_percent)
  into v_damage,v_dirty_out,v_dirty_in,v_odometer,v_fuel,v_battery from inspections where reservation_id=p_reservation_id and type='return' and actor_role_at_recording is not null;
  select coalesce(array_agg(distinct x),'{}') into v_missing from inspections i cross join lateral unnest(i.missing_safety_equipment) x where i.reservation_id=p_reservation_id and i.type='return' and i.actor_role_at_recording is not null;
  select energy_type into v_energy from vehicle_categories where id=v_vehicle.category_id;
  if v_damage then v_tasks:=array_append(v_tasks,'repair');end if;
  if cardinality(v_missing)>0 then v_tasks:=array_append(v_tasks,'safety');end if;
  if v_vehicle.next_service_odometer_km is not null and v_vehicle.next_service_odometer_km-v_odometer<=500 then v_tasks:=array_append(v_tasks,'preventive_maintenance');end if;
  if v_dirty_out or v_dirty_in then v_tasks:=array_append(v_tasks,'cleaning');end if;
  if v_energy='BEV' and v_battery<=20 then v_tasks:=array_append(v_tasks,'charging');
  elsif v_energy<>'BEV' and v_fuel<=20 then v_tasks:=array_append(v_tasks,'fuel');end if;
  v_status:=case when v_vehicle.status='blocked' then 'blocked'::vehicle_status
   when v_vehicle.has_blocking_damage or v_damage or cardinality(v_missing)>0 or 'preventive_maintenance'=any(v_tasks) then 'maintenance'::vehicle_status
   when v_dirty_out or v_dirty_in then 'cleaning'::vehicle_status when 'charging'=any(v_tasks) then 'charging'::vehicle_status else 'available'::vehicle_status end;
  update reservations set status='completed' where id=p_reservation_id;
  update vehicles set status=v_status,odometer_km=v_odometer,fuel_level_percent=coalesce(v_fuel,fuel_level_percent),battery_level_percent=coalesce(v_battery,battery_level_percent),
   has_blocking_damage=has_blocking_damage or v_damage,missing_safety_equipment=v_missing,is_clean_exterior=not v_dirty_out,is_clean_interior=not v_dirty_in,
   current_location_id=(select recorded_location_id from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role='traveler' and actor_role_at_recording is not null),updated_at=now() where id=v_vehicle.id;
  foreach v_task in array v_tasks loop
   if not exists(select 1 from workflow_tasks where vehicle_id=v_vehicle.id and organization_id=v_org and type=v_task and status in ('open','in_progress')) then
    insert into workflow_tasks(organization_id,vehicle_id,type,source_inspection_id) values(v_org,v_vehicle.id,v_task,v_id);
   end if;
  end loop;
  if cardinality(v_tasks)>0 then insert into notifications(organization_id,user_id,title,body)
   select v_org,id,'Novas tarefas operacionais','Uma devolução de veículo gerou novas tarefas operacionais.' from profiles where organization_id=v_org and role in ('fleet_manager','administrator');end if;
 end if;
 perform log_audit_event(v_org,v_actor,'return_inspection_recorded','inspection',v_id,null,jsonb_build_object('reservation_id',p_reservation_id,'inspection_role',p_role,'actor_role',v_role));
 return v_id;
end;$$;
revoke all on function public.record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) from public,anon;
grant execute on function public.record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) to authenticated;

create function public.fm_verified_departure_checks() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare v_traveler uuid;v_security uuid;v_requester uuid;v_authorized boolean;v_expiry date;v_enabled boolean;
begin
 if new.kind='arrival' and exists(select 1 from inspections where reservation_id=new.reservation_id and type='pickup' and actor_role_at_recording is not null)
 and not exists(select 1 from fm_gate_events where reservation_id=new.reservation_id and kind='departure') then raise exception 'PHYSICAL_DEPARTURE_REQUIRED';end if;
 if new.kind<>'departure' then return new;end if;
 if exists(select 1 from fm_gate_events where reservation_id=new.reservation_id and kind='arrival') then raise exception 'MOVEMENT_SEQUENCE_INVALID';end if;
 select performed_by into v_traveler from inspections where reservation_id=new.reservation_id and organization_id=new.organization_id and type='pickup' and performed_by_role='traveler' and actor_role_at_recording is not null;
 select performed_by into v_security from inspections where reservation_id=new.reservation_id and organization_id=new.organization_id and type='pickup' and performed_by_role='security' and actor_role_at_recording='security';
 if v_traveler is null or v_security is null or v_traveler=v_security then raise exception 'CHECKLIST_REQUIRED';end if;
 select p.id,p.driver_authorized,p.drivers_license_expiration,coalesce(a.enabled,true) into v_requester,v_authorized,v_expiry,v_enabled
 from reservations r join trip_requests t on t.id=r.trip_request_id join profiles p on p.id=t.requester_id left join fm_member_access a on a.user_id=p.id
 where r.id=new.reservation_id and r.organization_id=new.organization_id and t.organization_id=new.organization_id and p.organization_id=new.organization_id;
 if v_requester is distinct from v_traveler then raise exception 'CHECKLIST_REQUIRED';end if;
 perform fm_assert_can_drive(v_requester,new.organization_id);
 if not coalesce(v_authorized,false) or not coalesce(v_enabled,false) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
 if v_expiry is null or v_expiry<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'LICENSE_EXPIRED';end if;
 if exists(select 1 from inspections i where i.reservation_id=new.reservation_id and i.type='pickup' and i.actor_role_at_recording is not null and i.has_new_damage
 and not exists(select 1 from inspection_photos p where p.inspection_id=i.id and p.angle='damage' and p.organization_id=i.organization_id)) then raise exception 'DAMAGE_EVIDENCE_REQUIRED';end if;
 return new;
end;$$;
create trigger fm_departure_verified before insert on public.fm_gate_events for each row execute function public.fm_verified_departure_checks();
revoke all on function public.fm_verified_departure_checks() from public,anon,authenticated;

create function public.fm_preserve_inspection_evidence() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'PRESERVE_INSPECTION_HISTORY';end;$$;
create trigger fm_inspections_append_only before update or delete on public.inspections for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_inspections_no_truncate before truncate on public.inspections for each statement execute function public.fm_preserve_inspection_evidence();
create trigger fm_photos_append_only before update or delete on public.inspection_photos for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_photos_no_truncate before truncate on public.inspection_photos for each statement execute function public.fm_preserve_inspection_evidence();
revoke all on function public.fm_preserve_inspection_evidence() from public,anon,authenticated;

-- Restrictive policies close the older organization-wide photo write/read grants.
create policy fm_photo_visible on public.inspection_photos as restrictive for select to authenticated using(
 exists(select 1 from public.inspections i where i.id=inspection_id and i.organization_id=inspection_photos.organization_id)
);
create policy fm_photo_own_insert on public.inspection_photos as restrictive for insert to authenticated with check(
 organization_id=current_organization_id() and exists(select 1 from public.inspections i where i.id=inspection_id and i.organization_id=inspection_photos.organization_id and i.performed_by=auth.uid())
 and left(storage_path,length(organization_id::text||'/'||inspection_id::text||'/'))=organization_id::text||'/'||inspection_id::text||'/'
 and exists(select 1 from storage.objects o where o.bucket_id='vehicle-photos' and o.name=inspection_photos.storage_path)
);
create policy fm_storage_active_insert on storage.objects as restrictive for insert to authenticated with check(public.fm_account_enabled());
create policy fm_storage_active_update on storage.objects as restrictive for update to authenticated using(public.fm_account_enabled()) with check(public.fm_account_enabled());
create policy fm_vehicle_evidence_read on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'vehicle-photos' or (
 (storage.foldername(name))[1]=current_organization_id()::text and (
 exists(select 1 from public.inspections i where i.id::text=(storage.foldername(name))[2] and i.organization_id=current_organization_id())
 or ((storage.foldername(name))[2]='vehicles' and exists(select 1 from public.vehicles v where v.id::text=split_part(split_part(split_part(name,'/',3),'_',1),'.',1) and v.organization_id=current_organization_id()))
 ))
);
create policy fm_vehicle_evidence_insert on storage.objects as restrictive for insert to authenticated with check(
 bucket_id<>'vehicle-photos' or (
 (storage.foldername(name))[1]=current_organization_id()::text and (
 exists(select 1 from public.inspections i where i.id::text=(storage.foldername(name))[2] and i.organization_id=current_organization_id() and i.performed_by=auth.uid())
 or ((storage.foldername(name))[2]='vehicles' and current_user_role() in ('fleet_manager','administrator') and exists(select 1 from public.vehicles v where v.id::text=split_part(split_part(split_part(name,'/',3),'_',1),'.',1) and v.organization_id=current_organization_id()))
 ))
);

create function public.fm_checklist_state(p_reservation_id uuid) returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_res public.reservations%rowtype;v_status public.vehicle_status;v_requester uuid;v_role public.user_role;v_inspection_role text;
 v_tp boolean;v_sp boolean;v_tr boolean;v_sr boolean;v_departed boolean;v_arrived boolean;v_own_pickup boolean;v_own_return boolean;v_legacy boolean;
begin
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org;
 if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
 select requester_id into v_requester from trip_requests where id=v_res.trip_request_id and organization_id=v_org;
 select role into v_role from profiles where id=v_actor and organization_id=v_org;
 if v_actor is distinct from v_requester and v_role not in ('security','fleet_manager','administrator') then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 v_inspection_role:=case when v_actor=v_requester then 'traveler' when v_role='security' then 'security' else null end;
 select status into v_status from vehicles where id=v_res.vehicle_id and organization_id=v_org;
 select exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by_role='traveler' and actor_role_at_recording is not null),
 exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by_role='security' and actor_role_at_recording='security'),
 exists(select 1 from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role='traveler' and actor_role_at_recording is not null),
 exists(select 1 from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role='security' and actor_role_at_recording='security'),
 exists(select 1 from fm_gate_events where reservation_id=p_reservation_id and kind='departure'),
 exists(select 1 from fm_gate_events where reservation_id=p_reservation_id and kind='arrival'),
 exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by=v_actor and performed_by_role::text=v_inspection_role and actor_role_at_recording is not null),
 exists(select 1 from inspections where reservation_id=p_reservation_id and type='return' and performed_by=v_actor and performed_by_role::text=v_inspection_role and actor_role_at_recording is not null),
 exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and actor_role_at_recording is null)
 and not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and actor_role_at_recording is not null)
 into v_tp,v_sp,v_tr,v_sr,v_departed,v_arrived,v_own_pickup,v_own_return,v_legacy;
 return jsonb_build_object('own_pickup_id',(select id from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by=v_actor and performed_by_role::text=v_inspection_role and actor_role_at_recording is not null limit 1),'own_return_id',(select id from inspections where reservation_id=p_reservation_id and type='return' and performed_by=v_actor and performed_by_role::text=v_inspection_role and actor_role_at_recording is not null limit 1),'inspection_role',v_inspection_role,'pickup_traveler',v_tp,'pickup_security',v_sp,'return_traveler',v_tr,'return_security',v_sr,'departed',v_departed,'arrived',v_arrived,'own_pickup',v_own_pickup,'own_return',v_own_return,'legacy_pickup',v_legacy,
 'can_pickup',v_inspection_role is not null and v_res.status='confirmed' and v_status in ('available','reserved','awaiting_pickup','in_use') and not v_departed and not v_own_pickup and (v_status<>'in_use' or not v_legacy),
 'can_return',v_inspection_role is not null and v_res.status='confirmed' and v_status in ('in_use','returning','blocked') and not v_own_return and (v_legacy or (v_tp and v_sp and v_departed and v_arrived)));
end;$$;
revoke all on function public.fm_checklist_state(uuid) from public,anon;
grant execute on function public.fm_checklist_state(uuid) to authenticated;

create function public.fm_gate_checklist_states(p_reservation_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_role public.user_role;
begin
 v_role:=current_user_role();
 if v_org is null or v_role not in ('security','fleet_manager','administrator') then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 if p_reservation_ids is null or cardinality(p_reservation_ids)>100 then raise exception 'INVALID_INPUT';end if;
 return coalesce((select jsonb_object_agg(r.id::text,public.fm_checklist_state(r.id)) from public.reservations r where r.organization_id=v_org and r.id=any(p_reservation_ids)),'{}'::jsonb);
end;$$;
revoke all on function public.fm_gate_checklist_states(uuid[]) from public,anon;
grant execute on function public.fm_gate_checklist_states(uuid[]) to authenticated;

create function public.fm_my_checklist_states(p_reservation_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();begin
 if v_org is null or p_reservation_ids is null or cardinality(p_reservation_ids)>100 then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
 return coalesce((select jsonb_object_agg(r.id::text,public.fm_checklist_state(r.id)) from public.reservations r join public.trip_requests t on t.id=r.trip_request_id
 where r.organization_id=v_org and t.organization_id=v_org and t.requester_id=auth.uid() and r.id=any(p_reservation_ids)),'{}'::jsonb);
end;$$;
revoke all on function public.fm_my_checklist_states(uuid[]) from public,anon;
grant execute on function public.fm_my_checklist_states(uuid[]) to authenticated;

-- Best-effort email is claimed once after an actual completed return generated
-- tasks. This is not a delivery receipt; the in-app notification remains durable.
create table public.fm_return_notice_claims(
 reservation_id uuid primary key references public.reservations(id),organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.fm_return_notice_claims enable row level security;
revoke all on public.fm_return_notice_claims from public,anon,authenticated;
create function public.fm_claim_return_notice(p_reservation_id uuid) returns boolean language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_id uuid;
begin
 if not exists(select 1 from reservations r where r.id=p_reservation_id and r.organization_id=v_org and r.status='completed'
 and exists(select 1 from inspections i where i.reservation_id=r.id and i.type='return' and i.performed_by=auth.uid() and i.actor_role_at_recording is not null)
 and exists(select 1 from workflow_tasks w join inspections i on i.id=w.source_inspection_id where i.reservation_id=r.id and w.organization_id=v_org)) then return false;end if;
 insert into fm_return_notice_claims(reservation_id,organization_id,actor_id) values(p_reservation_id,v_org,auth.uid()) on conflict do nothing returning reservation_id into v_id;
 return v_id is not null;
end;$$;
revoke all on function public.fm_claim_return_notice(uuid) from public,anon;
grant execute on function public.fm_claim_return_notice(uuid) to authenticated;

-- Same operational command API; physical events now own the in_use/returning transitions.
create or replace function public.fm_v3_command(p_command text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public, pg_temp as $$
declare
 v_org uuid:=public.current_organization_id();v_actor uuid:=auth.uid();v_role public.user_role;
 v_id uuid;v_vehicle public.vehicles%rowtype;v_order public.fm_work_orders%rowtype;v_res public.reservations%rowtype;
 v_receipt public.fm_command_receipts%rowtype;v_target text;v_start timestamptz;v_end timestamptz;v_task uuid;v_result jsonb;v_before jsonb;
 v_energy public.energy_type;v_kind text;v_changed uuid;v_line public.fm_work_order_lines%rowtype;v_cost numeric;
begin
 select role into v_role from public.profiles where id=v_actor and organization_id=v_org;
 if v_actor is null or v_role is null then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
 if p_command like 'work_order.%' and v_role not in ('fleet_manager','administrator','maintenance_operator') then raise exception 'NOT_AUTHORIZED';end if;
 if p_command like 'energy.%' or p_command='vehicle.identity' then
  if v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 end if;
 if p_command in ('gate.record','incident.ack') and v_role not in ('fleet_manager','administrator','security') then raise exception 'NOT_AUTHORIZED';end if;
 insert into public.fm_command_receipts(organization_id,request_id,actor_id,command,payload)
 values(v_org,p_request_id,v_actor,p_command,p_payload) on conflict do nothing returning request_id into v_changed;
 if v_changed is null then
  select * into v_receipt from public.fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>p_command or v_receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;

 if p_command='work_order.create' then
  select * into v_vehicle from public.vehicles where id=(p_payload->>'vehicle_id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_FOUND';end if;
  insert into public.fm_work_orders(organization_id,vehicle_id,kind,description,supplier,quote_total,created_by)
  values(v_org,v_vehicle.id,p_payload->>'kind',trim(p_payload->>'description'),left(coalesce(p_payload->>'supplier',''),200),coalesce((p_payload->>'quote_total')::numeric,0),v_actor) returning id into v_id;

 elsif p_command in ('work_order.transition','work_order.line','work_order.void_line','work_order.budget') then
  -- Lock vehicle first everywhere; avoid reversed order with reservation triggers.
  select vehicle_id into v_id from public.fm_work_orders where id=(p_payload->>'id')::uuid and organization_id=v_org;
  if v_id is null then raise exception 'NOT_FOUND';end if;
  select * into v_vehicle from public.vehicles where id=v_id and organization_id=v_org for update;
  select * into v_order from public.fm_work_orders where id=(p_payload->>'id')::uuid and organization_id=v_org for update;
  if v_order.version is distinct from (p_payload->>'version')::integer then raise exception 'CONCURRENT_UPDATE';end if;
  v_id:=v_order.id;v_before:=jsonb_build_object('status',v_order.status,'version',v_order.version);
  if p_command='work_order.line' then
   if v_order.status in ('completed','cancelled') then raise exception 'INVALID_STATE_TRANSITION';end if;
   if p_payload->>'stage'='actual' and v_order.status not in ('in_progress','partial') then raise exception 'INVALID_STATE_TRANSITION';end if;
   insert into public.fm_work_order_lines(organization_id,work_order_id,description,stage,category,quantity,unit_price,warranty,created_by)
   values(v_org,v_id,trim(p_payload->>'description'),coalesce(p_payload->>'stage','planned'),p_payload->>'category',(p_payload->>'quantity')::numeric,(p_payload->>'unit_price')::numeric,coalesce((p_payload->>'warranty')::boolean,false),v_actor);
  elsif p_command='work_order.budget' then
   if v_order.status in ('completed','cancelled') or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';end if;
   if v_order.status not in ('draft','budgeted') and v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
   update public.fm_work_orders set quote_total=(p_payload->>'quote_total')::numeric,
    approved_total=case when status not in ('draft','budgeted') then (p_payload->>'quote_total')::numeric else approved_total end,
    approved_by=case when status not in ('draft','budgeted') then v_actor else approved_by end where id=v_id;
   v_before:=v_before||jsonb_build_object('previous_quote',v_order.quote_total,'previous_approved',v_order.approved_total,'reason',left(p_payload->>'reason',500));
  elsif p_command='work_order.void_line' then
   if v_order.status in ('completed','cancelled') or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';end if;
   update public.fm_work_order_lines set voided_at=now(),void_reason=left(p_payload->>'reason',500)
   where id=(p_payload->>'line_id')::uuid and work_order_id=v_id and organization_id=v_org and voided_at is null returning id into v_changed;
   if v_changed is null then raise exception 'NOT_FOUND';end if;
  else
   v_target:=p_payload->>'status';
   if not ((v_order.status='draft' and v_target in ('budgeted','cancelled'))
    or (v_order.status='budgeted' and v_target in ('approved','cancelled'))
    or (v_order.status='approved' and v_target in ('scheduled','cancelled'))
    or (v_order.status='scheduled' and v_target in ('scheduled','in_progress','cancelled'))
    or (v_order.status='in_progress' and v_target in ('partial','completed'))
    or (v_order.status='partial' and v_target in ('in_progress','completed'))) then raise exception 'INVALID_STATE_TRANSITION';end if;
   if v_target in ('approved','scheduled','cancelled') and v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
   if v_target='approved' then
    update public.fm_work_orders set approved_by=v_actor,approved_total=quote_total where id=v_id;
   end if;
   if v_target='scheduled' then
    v_start:=(p_payload->>'scheduled_start')::timestamptz;v_end:=(p_payload->>'scheduled_end')::timestamptz;
    if v_start is null or v_end is null or v_end<=v_start then raise exception 'INVALID_INPUT';end if;
    if exists(select 1 from public.reservations where vehicle_id=v_vehicle.id and organization_id=v_org and status in ('confirmed','pending_approval') and tstzrange(start_at,end_at,'[)')&&tstzrange(v_start,v_end,'[)')) then raise exception 'RESERVATION_CONFLICT';end if;
    if exists(select 1 from public.fm_work_orders where vehicle_id=v_vehicle.id and organization_id=v_org and id<>v_id and status in ('scheduled','in_progress','partial') and tstzrange(scheduled_start,scheduled_end,'[)')&&tstzrange(v_start,v_end,'[)')) then raise exception 'MAINTENANCE_CONFLICT';end if;
    update public.fm_work_orders set scheduled_start=v_start,scheduled_end=v_end where id=v_id;
   end if;
   if v_target='in_progress' and v_order.status='partial' then
    if v_vehicle.status<>'maintenance' or not exists(select 1 from public.workflow_tasks where id=v_order.workflow_task_id and organization_id=v_org and status in ('open','in_progress')) then raise exception 'INVALID_STATE_TRANSITION';end if;
   end if;
   if v_target='in_progress' and v_order.status='scheduled' then
    if now()<v_order.scheduled_start or now()>=v_order.scheduled_end then raise exception 'OUTSIDE_MAINTENANCE_WINDOW';end if;
    if v_vehicle.status in ('in_use','returning','blocked') then raise exception 'VEHICLE_NOT_READY';end if;
    insert into public.workflow_tasks(organization_id,vehicle_id,type,notes,status,assigned_to)
    values(v_org,v_vehicle.id,case when v_order.kind='corrective' then 'repair'::public.workflow_task_type else 'preventive_maintenance'::public.workflow_task_type end,'OS '||v_order.number,'in_progress',v_actor) returning id into v_task;
    update public.fm_work_orders set workflow_task_id=v_task where id=v_id;
    update public.vehicles set status='maintenance',updated_at=now() where id=v_vehicle.id;
   end if;
   if v_target='completed' then
    select coalesce(sum(round(quantity*unit_price,2)) filter(where not warranty),0) into v_cost from public.fm_work_order_lines where work_order_id=v_id and voided_at is null and stage='actual';
    if v_order.approved_total is null or v_cost>v_order.approved_total then raise exception 'APPROVED_BUDGET_EXCEEDED';end if;
    if v_order.workflow_task_id is not null then
     if exists(select 1 from public.workflow_tasks where id=v_order.workflow_task_id and status in ('open','in_progress')) then perform public.complete_workflow_task(v_order.workflow_task_id);
     elsif not exists(select 1 from public.workflow_tasks where id=v_order.workflow_task_id and status='done') then raise exception 'INVALID_STATE_TRANSITION';end if;
    end if;
    update public.fm_work_orders set completed_at=now() where id=v_id;
   end if;
   update public.fm_work_orders set status=v_target where id=v_id;
  end if;
  update public.fm_work_orders set version=version+1 where id=v_id;

 elsif p_command='energy.record' then
  select * into v_vehicle from public.vehicles where id=(p_payload->>'vehicle_id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_FOUND';end if;
  select energy_type into v_energy from public.vehicle_categories where id=v_vehicle.category_id;
  v_kind:=p_payload->>'kind';
  if (v_kind='fuel' and v_energy='BEV') or (v_kind='charge' and v_energy in ('ICE','HEV')) then raise exception 'POWERTRAIN_MISMATCH';end if;
  if (p_payload->>'event_at')::timestamptz>now() then raise exception 'INVALID_INPUT';end if;
  insert into public.fm_energy_events(organization_id,vehicle_id,kind,quantity,fuel_type,total_cost,odometer_km,event_at,supplier,created_by)
  values(v_org,v_vehicle.id,v_kind,(p_payload->>'quantity')::numeric,case when v_kind='fuel' then p_payload->>'fuel_type' else null end,(p_payload->>'total_cost')::numeric,(p_payload->>'odometer_km')::integer,(p_payload->>'event_at')::timestamptz,left(coalesce(p_payload->>'supplier',''),200),v_actor) returning id into v_id;
 elsif p_command='energy.void' then
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';end if;
  update public.fm_energy_events set voided_at=now(),void_reason=left(p_payload->>'reason',500) where id=(p_payload->>'id')::uuid and organization_id=v_org and voided_at is null returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND';end if;

 elsif p_command='gate.record' then
  select * into v_res from public.reservations where id=(p_payload->>'reservation_id')::uuid and organization_id=v_org;
  if not found then raise exception 'NOT_FOUND';end if;
  select * into v_vehicle from public.vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
  select * into v_res from public.reservations where id=v_res.id and organization_id=v_org for update;
  v_kind:=p_payload->>'kind';
  if v_kind='departure' then
   if v_res.status<>'confirmed' or v_vehicle.status not in ('awaiting_pickup','in_use') or v_vehicle.has_blocking_damage or not v_vehicle.documentation_valid or cardinality(v_vehicle.missing_safety_equipment)>0 then raise exception 'DEPARTURE_BLOCKED';end if;
   if not exists(select 1 from public.inspections where reservation_id=v_res.id and organization_id=v_org and type='pickup' and performed_by_role='traveler')
    or not exists(select 1 from public.inspections where reservation_id=v_res.id and organization_id=v_org and type='pickup' and performed_by_role='security') then raise exception 'CHECKLIST_REQUIRED';end if;
   if now()<v_res.start_at or now()>v_res.end_at then raise exception 'OUTSIDE_RESERVATION_WINDOW';end if;
  elsif v_kind='denied' and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';
  elsif v_kind='arrival' and not exists(select 1 from public.fm_gate_events where reservation_id=v_res.id and kind='departure') and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'LEGACY_ARRIVAL_REASON_REQUIRED';end if;
  insert into public.fm_gate_events(organization_id,reservation_id,vehicle_id,kind,reason,legacy_arrival,created_by)
  values(v_org,v_res.id,v_vehicle.id,v_kind,left(coalesce(p_payload->>'reason',''),1000),v_kind='arrival' and not exists(select 1 from public.fm_gate_events where reservation_id=v_res.id and kind='departure'),v_actor) returning id into v_id;
  if v_kind='departure' then update public.vehicles set status='in_use',updated_at=now() where id=v_vehicle.id;
  elsif v_kind='arrival' and v_res.status='confirmed' and v_vehicle.status in ('in_use','returning','blocked') then update public.vehicles set status=case when status='blocked' then 'blocked'::public.vehicle_status else 'returning'::public.vehicle_status end,updated_at=now() where id=v_vehicle.id;end if;

 elsif p_command='incident.ack' then
  if not exists(select 1 from public.inspections where id=(p_payload->>'inspection_id')::uuid and organization_id=v_org) then raise exception 'NOT_FOUND';end if;
  insert into public.fm_incident_acknowledgements(organization_id,inspection_id,actor_id,notes)
  values(v_org,(p_payload->>'inspection_id')::uuid,v_actor,left(coalesce(p_payload->>'notes',''),1000))
  on conflict(inspection_id,actor_id) do update set notes=public.fm_incident_acknowledgements.notes returning id into v_id;
 elsif p_command='vehicle.identity' then
  select * into v_vehicle from public.vehicles where id=(p_payload->>'vehicle_id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_FOUND';end if;
  update public.vehicles set vin=nullif(upper(trim(p_payload->>'vin')),''),next_service_date=nullif(p_payload->>'next_service_date','')::date where id=v_vehicle.id;
  v_id:=v_vehicle.id;
 else raise exception 'UNKNOWN_COMMAND';end if;
 v_result:=jsonb_build_object('id',v_id,'ok',true);
 if p_command like 'work_order.%' then select v_result||jsonb_build_object('status',status,'version',version,'quote_total',quote_total,'approved_total',approved_total,'line_id',p_payload->>'line_id') into v_result from public.fm_work_orders where id=v_id and organization_id=v_org;end if;
 perform public.log_audit_event(v_org,v_actor,p_command,case when p_command like 'work_order.%' then 'work_order' when p_command like 'energy.%' then 'energy_event' when p_command='gate.record' then 'gate_event' when p_command='incident.ack' then 'inspection_acknowledgement' else 'vehicle' end,v_id,v_before,v_result);
 update public.fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$$;

revoke all on function public.fm_v3_command(text,jsonb,uuid) from public,anon;
grant execute on function public.fm_v3_command(text,jsonb,uuid) to authenticated;
