CREATE OR REPLACE FUNCTION public.fm_finish_office_return(p_reservation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid:=current_organization_id();v_res reservations%rowtype;v_vehicle vehicles%rowtype;v_id uuid;v_energy energy_type;
 v_damage boolean;v_dirty_out boolean;v_dirty_in boolean;v_odometer integer;v_fuel numeric;v_battery numeric;v_missing text[];
 v_tasks workflow_task_type[]:='{}';v_task workflow_task_type;v_status vehicle_status;
begin
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org;
 if not found or v_res.status<>'confirmed' or fm_reservation_workflow(p_reservation_id)<>'key_custody' then return;end if;
 select * into v_vehicle from vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org for update;
 if v_res.status<>'confirmed' then return;end if;
 select id into v_id from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role='traveler' and actor_role_at_recording is not null;
 if exists(select 1 from inspections where reservation_id=p_reservation_id and type='return' and performed_by_role='traveler' and actor_role_at_recording is not null)
 and exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='received') then
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
end;$function$

