-- Rollback of 0198: driver checklist again exclusive to the requester (state after 0197).
CREATE OR REPLACE FUNCTION public.fm_verify_inspection_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end;$function$;
revoke all on function public.fm_verify_inspection_actor() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.fm_prepare_equipment_checklist(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid:=current_organization_id();v_vehicle uuid;v_contract fm_equipment_contracts%rowtype;v_effective jsonb;v_required text[];v_optional text[];v_source text;v_version integer;
begin
 select r.vehicle_id into v_vehicle from reservations r join trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=v_org and t.requester_id=auth.uid() and r.status='confirmed';
 if v_vehicle is null then raise exception 'NOT_AUTHORIZED';end if;
 perform 1 from vehicles where id=v_vehicle and organization_id=v_org for update;
 -- Check the reservation again after locking; reassignment uses the same vehicle lock.
 if not exists(select 1 from reservations r join trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=current_organization_id() and r.vehicle_id=v_vehicle and t.requester_id=auth.uid() and r.status='confirmed') then raise exception 'CONCURRENT_UPDATE';end if;
 select * into v_contract from fm_equipment_contracts where reservation_id=p_reservation_id and vehicle_id=v_vehicle;
 if found then return to_jsonb(v_contract);end if;
 v_effective:=fm_equipment_effective(v_vehicle);
 if (v_effective->>'configured')::boolean then
 v_source:=v_effective->>'source';v_version:=(v_effective->>'version')::integer;
 v_required:=array(select x->>'name' from jsonb_array_elements(v_effective->'required') x);
 v_optional:=array(select x->>'name' from jsonb_array_elements(v_effective->'optional') x);
 elsif exists(select 1 from inspections where reservation_id=p_reservation_id and vehicle_id=v_vehicle and performed_by_role='traveler' and type='pickup') then
 -- Do not strand a vehicle already out under the legacy process. These are
 -- observation prompts, explicitly not verified vehicle requirements.
 v_source:='legacy_return_observation';v_version:=0;
 v_required:=array(select name from safety_equipment_items where organization_id=v_org and enabled order by name,id);v_optional:='{}';
 else raise exception 'EQUIPMENT_CONFIGURATION_REQUIRED';end if;
 insert into fm_equipment_contracts(organization_id,reservation_id,vehicle_id,source,configuration_version,required_names,optional_names,created_by) values(v_org,p_reservation_id,v_vehicle,v_source,v_version,v_required,v_optional,auth.uid()) returning * into v_contract;
 perform log_audit_event(v_org,auth.uid(),'equipment.checklist_contract','reservation',p_reservation_id,null,to_jsonb(v_contract));return to_jsonb(v_contract);
end;$function$;
revoke all on function public.fm_prepare_equipment_checklist(uuid) from public,anon;
grant execute on function public.fm_prepare_equipment_checklist(uuid) to authenticated;
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
end;$function$;
revoke all on function public.fm_gate_record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role) from public,anon,authenticated;
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
end;$function$;
revoke all on function public.fm_gate_record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.fm_office_record_return(p_reservation_id uuid, p_odometer_km integer, p_fuel_level_percent numeric, p_battery_level_percent numeric, p_has_new_damage boolean, p_damage_notes text, p_missing_safety_equipment text[], p_is_dirty_exterior boolean, p_is_dirty_interior boolean, p_role inspection_role, p_vehicle_event text, p_workflow_tasks workflow_task_type[], p_current_location_id uuid DEFAULT NULL::uuid)
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
 if p_role is distinct from 'traveler' or v_actor is distinct from v_requester then raise exception 'INSPECTION_NOT_AUTHORIZED';end if;
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
 if not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by=v_requester and performed_by_role='traveler' and actor_role_at_recording is not null) then raise exception 'PICKUP_CHECKLIST_REQUIRED';end if;
 if not exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered') then raise exception 'KEY_DELIVERY_REQUIRED';end if;
 if p_role='traveler' and (p_odometer_km is null or p_odometer_km<greatest(v_vehicle.odometer_km,coalesce((select max(odometer_km) from inspections where reservation_id=p_reservation_id and type='pickup' and actor_role_at_recording is not null),v_vehicle.odometer_km))) then raise exception 'ODOMETER_CANNOT_GO_BACKWARDS';end if;
 insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role,odometer_km,fuel_level_percent,battery_level_percent,has_new_damage,damage_notes,missing_safety_equipment,is_dirty_exterior,is_dirty_interior,recorded_location_id)
 values(v_org,p_reservation_id,v_vehicle.id,'return',v_actor,p_role,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_new_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_current_location_id) returning id into v_id;
 update vehicles set status=case when v_vehicle.status='blocked' then 'blocked'::vehicle_status else 'returning'::vehicle_status end,updated_at=now() where id=v_vehicle.id;
 perform public.fm_finish_office_return(p_reservation_id);
 perform log_audit_event(v_org,v_actor,'return_inspection_recorded','inspection',v_id,null,jsonb_build_object('reservation_id',p_reservation_id,'inspection_role',p_role,'actor_role',v_role));
 return v_id;
end;$function$;
revoke all on function public.fm_office_record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) from public,anon,authenticated;
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
 if v_requester is distinct from v_traveler then raise exception 'CHECKLIST_REQUIRED';end if;
 perform fm_assert_can_drive(v_requester,new.organization_id);
 if not coalesce(v_authorized,false) or not coalesce(v_enabled,false) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
 if v_expiry is null or v_expiry<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'LICENSE_EXPIRED';end if;
 if exists(select 1 from inspections i where i.reservation_id=new.reservation_id and i.type='pickup' and i.actor_role_at_recording is not null and i.has_new_damage
 and not exists(select 1 from inspection_photos p where p.inspection_id=i.id and p.angle='damage' and p.organization_id=i.organization_id)) then raise exception 'DAMAGE_EVIDENCE_REQUIRED';end if;
 return new;
end;$function$;
revoke all on function public.fm_verified_departure_checks() from public,anon,authenticated;
drop function if exists public.fm_checklist_on_behalf_allowed(uuid);
