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
end;$function$

