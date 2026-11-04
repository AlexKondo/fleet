-- back to 0198 (checklist functions) and 0179 (operations binding); the columns stay (harmless, default 'traveler')
drop function if exists public.fm_set_mobility_point_checklist_by(uuid,text);
drop function if exists public.fm_checklist_state(uuid);
alter function public.fm_checklist_state_base(uuid) rename to fm_checklist_state;
grant execute on function public.fm_checklist_state(uuid) to authenticated;
create or replace function public.fm_bind_reservation_operations() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare v_unit uuid;v_version integer;v_workflow text;v_enabled boolean;
begin
 if TG_OP='UPDATE' and old.vehicle_id is not distinct from new.vehicle_id then return new;end if;
 if TG_OP='UPDATE' and (exists(select 1 from inspections where reservation_id=new.id) or exists(select 1 from fm_key_events where reservation_id=new.id) or exists(select 1 from fm_gate_events where reservation_id=new.id)) then raise exception 'RESERVATION_HAS_OPERATIONS';end if;
 select u.id,u.version,u.workflow,u.enabled into v_unit,v_version,v_workflow,v_enabled from fm_vehicle_units m join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id where m.vehicle_id=new.vehicle_id and m.organization_id=new.organization_id;
 if v_unit is not null and not v_enabled then raise exception 'UNIT_DISABLED';end if;
 insert into fm_reservation_operations(reservation_id,organization_id,vehicle_id,unit_id,unit_version,workflow)
 values(new.id,new.organization_id,new.vehicle_id,v_unit,v_version,coalesce(v_workflow,'gate_visual'))
 on conflict(reservation_id) do update set vehicle_id=excluded.vehicle_id,unit_id=excluded.unit_id,unit_version=excluded.unit_version,workflow=excluded.workflow;
 return new;
end;$$;

create or replace function public.fm_checklist_on_behalf_allowed(p_reservation_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select auth.uid() is not null and public.fm_account_enabled() and public.current_user_role() in ('fleet_manager','administrator')
 and public.fm_can_manage_reservation(p_reservation_id)
 and not exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id where r.id=p_reservation_id and t.requester_id=auth.uid())
 and not exists(select 1 from public.fm_reservation_operations o join public.fm_key_custodians c on c.unit_id=o.unit_id and c.organization_id=o.organization_id
  where o.reservation_id=p_reservation_id and o.workflow='key_custody' and c.user_id=auth.uid() and c.enabled)
 and not exists(select 1 from public.fm_key_events e where e.reservation_id=p_reservation_id and e.actor_id=auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.fm_verified_departure_checks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_traveler uuid;v_security uuid;v_requester uuid;v_authorized boolean;v_expiry date;v_enabled boolean;
begin
 -- 0197 (DEF-01): defence in depth at table level, also for writers other than fm_v3_command.
 if not exists(select 1 from profiles where id=new.created_by and organization_id=new.organization_id and role='security') then raise exception 'NOT_AUTHORIZED';end if;
 if exists(select 1 from reservations r join trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id where r.id=new.reservation_id and r.organization_id=new.organization_id and t.requester_id=new.created_by) then raise exception 'GATE_SELF_RELEASE_NOT_AUTHORIZED';end if;
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
 -- 0198 (D1-05): the requester's checklist may have been recorded on the driver's behalf by a scoped manager/administrator.
 if v_requester is distinct from v_traveler and not exists(select 1 from inspections where reservation_id=new.reservation_id and organization_id=new.organization_id and type='pickup' and performed_by_role='traveler' and performed_by=v_traveler and actor_role_at_recording in ('fleet_manager','administrator')) then raise exception 'CHECKLIST_REQUIRED';end if;
 perform fm_assert_can_drive(v_requester,new.organization_id);
 if not coalesce(v_authorized,false) or not coalesce(v_enabled,false) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
 if v_expiry is null or v_expiry<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'LICENSE_EXPIRED';end if;
 if exists(select 1 from inspections i where i.reservation_id=new.reservation_id and i.type='pickup' and i.actor_role_at_recording is not null and i.has_new_damage
 and not exists(select 1 from inspection_photos p where p.inspection_id=i.id and p.angle='damage' and p.organization_id=i.organization_id)) then raise exception 'DAMAGE_EVIDENCE_REQUIRED';end if;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION public.fm_gate_record_pickup(p_reservation_id uuid, p_odometer_km integer, p_fuel_level_percent numeric, p_battery_level_percent numeric, p_has_damage boolean, p_damage_notes text, p_missing_safety_equipment text[], p_is_dirty_exterior boolean, p_is_dirty_interior boolean, p_role inspection_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 if p_role is null or (p_role='traveler' and v_actor is distinct from v_requester and not public.fm_checklist_on_behalf_allowed(p_reservation_id))
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
 perform log_audit_event(v_org,v_actor,'pickup_inspection_recorded','inspection',v_id,null,jsonb_build_object('reservation_id',p_reservation_id,'inspection_role',p_role,'actor_role',v_role,'on_behalf_of',case when v_actor is distinct from v_requester and p_role='traveler' then v_requester end));
 return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.fm_gate_record_return(p_reservation_id uuid, p_odometer_km integer, p_fuel_level_percent numeric, p_battery_level_percent numeric, p_has_new_damage boolean, p_damage_notes text, p_missing_safety_equipment text[], p_is_dirty_exterior boolean, p_is_dirty_interior boolean, p_role inspection_role, p_vehicle_event text, p_workflow_tasks workflow_task_type[], p_current_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 if p_role is null or (p_role='traveler' and v_actor is distinct from v_requester and not public.fm_checklist_on_behalf_allowed(p_reservation_id))
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
 perform log_audit_event(v_org,v_actor,'return_inspection_recorded','inspection',v_id,null,jsonb_build_object('reservation_id',p_reservation_id,'inspection_role',p_role,'actor_role',v_role,'on_behalf_of',case when v_actor is distinct from v_requester and p_role='traveler' then v_requester end));
 return v_id;
end;$function$;
