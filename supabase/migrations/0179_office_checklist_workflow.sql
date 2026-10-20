-- SP office custody: driver checklist and local key handover are separate
-- evidence. No synthetic Security inspection or physical gate event is created.
-- Freeze the workflow for each reservation. Existing reservations keep the IRA
-- contract; assigning a unit later cannot rewrite completed trip history.
create table public.fm_reservation_operations (
 reservation_id uuid primary key references public.reservations(id),
 organization_id uuid not null references public.organizations(id),
 vehicle_id uuid not null references public.vehicles(id),
 unit_id uuid,
 unit_version integer,
 workflow text not null check(workflow in ('gate_visual','key_custody')),
 foreign key(organization_id,unit_id) references public.fm_units(organization_id,id)
);
alter table public.fm_reservation_operations enable row level security;
revoke all on public.fm_reservation_operations from public,anon,authenticated;
insert into public.fm_reservation_operations(reservation_id,organization_id,vehicle_id,workflow)
 select id,organization_id,vehicle_id,'gate_visual' from public.reservations;
create function public.fm_bind_reservation_operations() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
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
create trigger fm_bind_reservation_operations after insert or update of vehicle_id on public.reservations for each row execute function public.fm_bind_reservation_operations();
revoke all on function public.fm_bind_reservation_operations() from public,anon,authenticated;
create function public.fm_reservation_workflow(p_reservation_id uuid) returns text
language sql stable security definer set search_path=public, pg_temp as $$
 select coalesce((select workflow from fm_reservation_operations where reservation_id=p_reservation_id and organization_id=current_organization_id()),'gate_visual')
$$;
revoke all on function public.fm_reservation_workflow(uuid) from public,anon,authenticated;

create function public.fm_finish_office_return(p_reservation_id uuid) returns void
language plpgsql security definer set search_path=public, pg_temp as $$
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
end;$$;
revoke all on function public.fm_finish_office_return(uuid) from public,anon,authenticated;

create function public.fm_office_record_return(
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
end;$$;
revoke all on function public.fm_office_record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) from public,anon,authenticated;

alter function public.record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role) rename to fm_gate_record_pickup;
alter function public.record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) rename to fm_gate_record_return;
revoke all on function public.fm_gate_record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role),public.fm_gate_record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) from public,anon,authenticated;

create function public.record_pickup(
 p_reservation_id uuid,p_odometer_km integer,p_fuel_level_percent numeric,p_battery_level_percent numeric,
 p_has_damage boolean,p_damage_notes text,p_missing_safety_equipment text[],p_is_dirty_exterior boolean,p_is_dirty_interior boolean,p_role public.inspection_role
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_vehicle uuid;v_id uuid;
begin
 select vehicle_id into v_vehicle from reservations where id=p_reservation_id and organization_id=v_org;
 if fm_reservation_workflow(p_reservation_id)='key_custody' then
  if p_role is distinct from 'traveler' then raise exception 'OFFICE_DRIVER_CHECKLIST_ONLY';end if;
  perform 1 from organizations where id=v_org for no key update;
  perform 1 from vehicles where id=v_vehicle and organization_id=v_org for update;
  if not exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered') then raise exception 'KEY_DELIVERY_REQUIRED';end if;
  -- Exact retry after the trip started stays idempotent. A receipt without a
  -- pickup, however, ends the key handover and cannot start a new trip.
  if exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='received') and not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by=auth.uid() and actor_role_at_recording is not null) then raise exception 'KEYS_ALREADY_RECEIVED';end if;
  v_id:=fm_gate_record_pickup(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role);
  -- The driver's digital pickup starts the office trip. This is not an IRA
  -- physical gate event. Damage/missing equipment holds the car blocked.
  update vehicles set status=case when status='blocked' or has_blocking_damage or cardinality(missing_safety_equipment)>0 then 'blocked'::vehicle_status else 'in_use'::vehicle_status end,updated_at=now() where id=v_vehicle and status in ('awaiting_pickup','in_use','blocked');
  return v_id;
 end if;
 return fm_gate_record_pickup(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role);
end;$$;

create function public.record_return(
 p_reservation_id uuid,p_odometer_km integer,p_fuel_level_percent numeric,p_battery_level_percent numeric,
 p_has_new_damage boolean,p_damage_notes text,p_missing_safety_equipment text[],p_is_dirty_exterior boolean,p_is_dirty_interior boolean,
 p_role public.inspection_role,p_vehicle_event text,p_workflow_tasks public.workflow_task_type[],p_current_location_id uuid default null
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_vehicle uuid;
begin
 select vehicle_id into v_vehicle from reservations where id=p_reservation_id and organization_id=v_org;
 if fm_reservation_workflow(p_reservation_id)='key_custody' then
  perform 1 from organizations where id=v_org for no key update;
  return fm_office_record_return(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_new_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role,p_vehicle_event,p_workflow_tasks,p_current_location_id);
 end if;
 return fm_gate_record_return(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_new_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role,p_vehicle_event,p_workflow_tasks,p_current_location_id);
end;$$;
revoke all on function public.record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role),public.record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) from public,anon;
grant execute on function public.record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role),public.record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,public.inspection_role,text,public.workflow_task_type[],uuid) to authenticated;

create function public.fm_office_keys_after_event() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if new.kind='received' then perform fm_finish_office_return(new.reservation_id);end if;
 return new;
end;$$;
create trigger fm_office_key_received after insert on public.fm_key_events for each row execute function public.fm_office_keys_after_event();
revoke all on function public.fm_office_keys_after_event() from public,anon,authenticated;

create function public.fm_key_reservation_contract() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if not exists(select 1 from fm_reservation_operations where reservation_id=new.reservation_id and organization_id=new.organization_id and vehicle_id=new.vehicle_id and unit_id=new.unit_id and workflow='key_custody') then raise exception 'RESERVATION_WORKFLOW_MISMATCH';end if;
 return new;
end;$$;
create trigger fm_key_reservation_contract before insert on public.fm_key_events for each row execute function public.fm_key_reservation_contract();
revoke all on function public.fm_key_reservation_contract() from public,anon,authenticated;

create function public.fm_has_key_custody() returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from fm_key_custodians c join fm_units u on u.id=c.unit_id and u.organization_id=c.organization_id where c.organization_id=current_organization_id() and c.user_id=auth.uid() and c.enabled and u.enabled and u.workflow='key_custody')
$$;
revoke all on function public.fm_has_key_custody() from public,anon;
grant execute on function public.fm_has_key_custody() to authenticated;

create function public.fm_gate_unit_only() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if fm_reservation_workflow(new.reservation_id)='key_custody' then raise exception 'OFFICE_HAS_NO_GATE';end if;
 return new;
end;$$;
create trigger fm_gate_unit_only before insert on public.fm_gate_events for each row execute function public.fm_gate_unit_only();
revoke all on function public.fm_gate_unit_only() from public,anon,authenticated;

alter function public.fm_checklist_state(uuid) rename to fm_gate_checklist_state;
revoke all on function public.fm_gate_checklist_state(uuid) from public,anon,authenticated;
create function public.fm_checklist_state(p_reservation_id uuid) returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_state jsonb;v_vehicle uuid;v_status vehicle_status;v_res_status reservation_status;v_office boolean;v_delivered boolean;v_received boolean;
begin
 v_state:=fm_gate_checklist_state(p_reservation_id);
 select r.vehicle_id,v.status,r.status into v_vehicle,v_status,v_res_status from reservations r join vehicles v on v.id=r.vehicle_id and v.organization_id=r.organization_id where r.id=p_reservation_id and r.organization_id=current_organization_id();
 v_office:=fm_reservation_workflow(p_reservation_id)='key_custody';
 if not v_office then return v_state||jsonb_build_object('workflow','gate_visual','keys_delivered',false,'keys_received',false);end if;
 select exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered'),exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='received') into v_delivered,v_received;
 return v_state||jsonb_build_object('workflow','key_custody','keys_delivered',v_delivered,'keys_received',v_received,
  'inspection_role',case when v_state->>'inspection_role'='traveler' then 'traveler' else null end,
  'can_pickup',coalesce(v_state->>'inspection_role'='traveler',false) and v_res_status='confirmed' and v_delivered and not v_received and not (v_state->>'own_pickup')::boolean and v_status in ('available','reserved','awaiting_pickup'),
  'can_return',coalesce(v_state->>'inspection_role'='traveler',false) and v_res_status='confirmed' and v_delivered and (v_state->>'pickup_traveler')::boolean and not (v_state->>'own_return')::boolean and v_status in ('in_use','returning','blocked'));
end;$$;
revoke all on function public.fm_checklist_state(uuid) from public,anon;
grant execute on function public.fm_checklist_state(uuid) to authenticated;

create or replace function public.fm_key_workspace() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();
begin
 if v_org is null then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object(
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name)) from fm_units u join fm_key_custodians c on c.unit_id=u.id and c.organization_id=u.organization_id where u.organization_id=v_org and u.enabled and u.workflow='key_custody' and c.user_id=v_actor and c.enabled),'[]'::jsonb),
 'reservations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'unit_id',u.id,'unit',u.name,'plate',v.plate,'requester',p.full_name,'self',p.id=v_actor,'start_at',r.start_at,'end_at',r.end_at,'status',r.status,
 'delivered',exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='delivered'),
 'received',exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='received')) order by r.start_at,r.id)
 from reservations r join vehicles v on v.id=r.vehicle_id and v.organization_id=r.organization_id
 join fm_vehicle_units m on m.vehicle_id=v.id and m.organization_id=r.organization_id join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id
 join fm_key_custodians c on c.unit_id=u.id and c.organization_id=u.organization_id and c.user_id=v_actor and c.enabled
 join trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id join profiles p on p.id=t.requester_id and p.organization_id=r.organization_id
 where r.organization_id=v_org and u.enabled and u.workflow='key_custody' and exists(select 1 from fm_reservation_operations o where o.reservation_id=r.id and o.organization_id=r.organization_id and o.unit_id=u.id and o.workflow='key_custody') and ((r.status='confirmed' and r.end_at>=now()-interval '1 day' and r.start_at<now()+interval '7 days')
 or exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='delivered' and not exists(select 1 from fm_key_events x where x.reservation_id=r.id and x.kind='received')))),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
 select e.id,e.unit_id,u.name as unit,v.plate,e.reservation_id,e.kind,e.reason,e.created_at,p.full_name as actor
 from fm_key_events e join fm_units u on u.id=e.unit_id and u.organization_id=e.organization_id
 join vehicles v on v.id=e.vehicle_id and v.organization_id=e.organization_id
 join profiles p on p.id=e.actor_id and p.organization_id=e.organization_id
 where e.organization_id=v_org and exists(select 1 from fm_key_custodians c where c.unit_id=e.unit_id and c.organization_id=e.organization_id and c.user_id=v_actor and c.enabled and u.enabled)
 order by e.created_at desc,e.id desc limit 100) h),'[]'::jsonb));
end;$$;

-- The actor who completed the key receipt may claim the same best-effort return
-- notice as the driver. This adds no read/management permission to the custodian.
create or replace function public.fm_claim_return_notice(p_reservation_id uuid) returns boolean language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_id uuid;
begin
 if not exists(select 1 from reservations r where r.id=p_reservation_id and r.organization_id=v_org and r.status='completed'
 and (exists(select 1 from inspections i where i.reservation_id=r.id and i.type='return' and i.performed_by=auth.uid() and i.actor_role_at_recording is not null)
 or exists(select 1 from fm_key_events e join fm_key_custodians c on c.unit_id=e.unit_id and c.organization_id=e.organization_id and c.user_id=auth.uid() and c.enabled where e.reservation_id=r.id and e.organization_id=v_org and e.kind='received' and e.actor_id=auth.uid()))
 and exists(select 1 from workflow_tasks w join inspections i on i.id=w.source_inspection_id where i.reservation_id=r.id and w.organization_id=v_org)) then return false;end if;
 insert into fm_return_notice_claims(reservation_id,organization_id,actor_id) values(p_reservation_id,v_org,auth.uid()) on conflict do nothing returning reservation_id into v_id;
 return v_id is not null;
end;$$;

create function public.fm_key_exception_notification() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if new.kind='exception' then
  insert into notifications(organization_id,user_id,title,body)
  select new.organization_id,p.id,'Exceção na custódia de chaves','Foi registrada uma exceção de chaves. Consulte a auditoria da unidade e da reserva.'
  from profiles p left join fm_member_access a on a.user_id=p.id where p.organization_id=new.organization_id and p.role in ('fleet_manager','administrator') and coalesce(a.enabled,true);
 end if;
 return new;
end;$$;
create trigger fm_key_exception_notification after insert on public.fm_key_events for each row execute function public.fm_key_exception_notification();
revoke all on function public.fm_key_exception_notification() from public,anon,authenticated;

create function public.fm_key_management_workspace() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();
begin
 if v_org is null or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object(
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name)) from fm_units u where u.organization_id=v_org and u.workflow='key_custody'),'[]'::jsonb),
 'reservations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'unit_id',u.id,'unit',u.name,'plate',v.plate,'requester',p.full_name,'self',p.id=v_actor,'start_at',r.start_at,'end_at',r.end_at,'status',r.status,
 'delivered',exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='delivered'),
 'received',exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='received')) order by r.start_at,r.id)
 from reservations r join vehicles v on v.id=r.vehicle_id and v.organization_id=r.organization_id
 join fm_vehicle_units m on m.vehicle_id=v.id and m.organization_id=r.organization_id join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id

 join trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id join profiles p on p.id=t.requester_id and p.organization_id=r.organization_id
 where r.organization_id=v_org and u.enabled and u.workflow='key_custody' and exists(select 1 from fm_reservation_operations o where o.reservation_id=r.id and o.organization_id=r.organization_id and o.unit_id=u.id and o.workflow='key_custody') and ((r.status='confirmed' and r.end_at>=now()-interval '1 day' and r.start_at<now()+interval '7 days')
 or exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='delivered' and not exists(select 1 from fm_key_events x where x.reservation_id=r.id and x.kind='received')))),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
 select e.id,e.unit_id,u.name as unit,v.plate,e.reservation_id,e.kind,e.reason,e.created_at,p.full_name as actor
 from fm_key_events e join fm_units u on u.id=e.unit_id and u.organization_id=e.organization_id
 join vehicles v on v.id=e.vehicle_id and v.organization_id=e.organization_id
 join profiles p on p.id=e.actor_id and p.organization_id=e.organization_id
 where e.organization_id=v_org
 order by e.created_at desc,e.id desc limit 100) h),'[]'::jsonb));
end;$$;
revoke all on function public.fm_key_management_workspace() from public,anon;
grant execute on function public.fm_key_management_workspace() to authenticated;
