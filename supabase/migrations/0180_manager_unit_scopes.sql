-- Fleet management scopes are independent of primary role and local key custody.
-- Preserve existing managers' organizational access explicitly; newly promoted
-- managers require an administrative scope assignment (no implicit global grant).
create table public.fm_manager_scopes (
 user_id uuid primary key references public.profiles(id),organization_id uuid not null references public.organizations(id),
 mode text not null check(mode in ('all_units','selected_units')),version integer not null check(version>0),
 updated_by uuid references public.profiles(id),updated_at timestamptz not null default now(),
 unique(organization_id,user_id)
);
create table public.fm_manager_scope_units (
 user_id uuid not null,organization_id uuid not null,unit_id uuid not null,enabled boolean not null,
 primary key(user_id,unit_id),foreign key(organization_id,user_id) references public.fm_manager_scopes(organization_id,user_id),
 foreign key(organization_id,unit_id) references public.fm_units(organization_id,id)
);
create table public.fm_manager_scope_history (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),organization_id uuid not null references public.organizations(id),
 mode text not null check(mode in ('all_units','selected_units')),unit_ids uuid[] not null,version integer not null,
 actor_id uuid references public.profiles(id),source text not null check(source in ('legacy_baseline','administrative')),
 reason text not null,created_at timestamptz not null default now(),unique(user_id,version),
 check((source='legacy_baseline' and actor_id is null) or (source='administrative' and actor_id is not null))
);
insert into public.fm_manager_scopes(user_id,organization_id,mode,version)
 select id,organization_id,'all_units',1 from public.profiles where role='fleet_manager';
insert into public.fm_manager_scope_history(user_id,organization_id,mode,unit_ids,version,source,reason)
 select user_id,organization_id,mode,'{}',version,'legacy_baseline','Preservação explícita do acesso organizacional anterior à configuração de escopos.' from public.fm_manager_scopes;
alter table public.fm_manager_scopes enable row level security;
alter table public.fm_manager_scope_units enable row level security;
alter table public.fm_manager_scope_history enable row level security;
revoke all on public.fm_manager_scopes,public.fm_manager_scope_units,public.fm_manager_scope_history from public,anon,authenticated;
create trigger fm_manager_history_append_only before update or delete on public.fm_manager_scope_history for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_manager_history_no_truncate before truncate on public.fm_manager_scope_history for each statement execute function public.fm_preserve_inspection_evidence();

create function public.fm_is_limited_manager() returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select current_user_role()='fleet_manager' and not exists(select 1 from fm_manager_scopes s where s.user_id=auth.uid() and s.organization_id=current_organization_id() and s.mode='all_units')
$$;
create function public.fm_can_manage_unit(p_unit_id uuid) returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from fm_units u where u.id=p_unit_id and u.organization_id=current_organization_id() and
 (current_user_role()='administrator' or (current_user_role()='fleet_manager' and exists(select 1 from fm_manager_scopes s where s.user_id=auth.uid() and s.organization_id=u.organization_id
 and (s.mode='all_units' or exists(select 1 from fm_manager_scope_units m where m.user_id=s.user_id and m.organization_id=s.organization_id and m.unit_id=u.id and m.enabled))))))
$$;
create function public.fm_can_manage_vehicle(p_vehicle_id uuid) returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from vehicles v where v.id=p_vehicle_id and v.organization_id=current_organization_id() and
 (current_user_role()='administrator' or (current_user_role()='fleet_manager' and exists(select 1 from fm_manager_scopes s where s.user_id=auth.uid() and s.organization_id=v.organization_id
 and (s.mode='all_units' or exists(select 1 from fm_vehicle_units m join fm_manager_scope_units g on g.unit_id=m.unit_id and g.organization_id=m.organization_id where m.vehicle_id=v.id and m.organization_id=s.organization_id and g.user_id=s.user_id and g.enabled))))))
$$;
create function public.fm_can_manage_trip(p_trip_id uuid) returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from reservations r where r.trip_request_id=p_trip_id and r.organization_id=current_organization_id() and fm_can_manage_vehicle(r.vehicle_id))
$$;
create function public.fm_can_manage_reservation(p_reservation_id uuid) returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from reservations r where r.id=p_reservation_id and r.organization_id=current_organization_id() and fm_can_manage_vehicle(r.vehicle_id))
$$;
create function public.fm_scope_command_guard(p_command text,p_payload jsonb) returns void language plpgsql security definer set search_path=public, pg_temp as $$
declare v_vehicle uuid;
begin
 if not coalesce(fm_is_limited_manager(),false) then return;end if;
 if p_command in ('work_order.create','energy.record','vehicle.identity') then v_vehicle:=(p_payload->>'vehicle_id')::uuid;
 elsif p_command in ('work_order.transition','work_order.line','work_order.void_line','work_order.budget') then select vehicle_id into v_vehicle from fm_work_orders where id=(p_payload->>'id')::uuid and organization_id=current_organization_id();
 elsif p_command='energy.void' then select vehicle_id into v_vehicle from fm_energy_events where id=(p_payload->>'id')::uuid and organization_id=current_organization_id();
 elsif p_command='gate.record' then select vehicle_id into v_vehicle from reservations where id=(p_payload->>'reservation_id')::uuid and organization_id=current_organization_id();
 elsif p_command='incident.ack' then select vehicle_id into v_vehicle from inspections where id=(p_payload->>'inspection_id')::uuid and organization_id=current_organization_id();
 else raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 if not fm_can_manage_vehicle(v_vehicle) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
end;$$;
revoke all on function public.fm_scope_command_guard(text,jsonb) from public,anon,authenticated;
revoke all on function public.fm_is_limited_manager(),public.fm_can_manage_unit(uuid),public.fm_can_manage_vehicle(uuid),public.fm_can_manage_trip(uuid),public.fm_can_manage_reservation(uuid) from public,anon;
grant execute on function public.fm_is_limited_manager(),public.fm_can_manage_unit(uuid),public.fm_can_manage_vehicle(uuid),public.fm_can_manage_trip(uuid),public.fm_can_manage_reservation(uuid) to authenticated;

create function public.fm_manager_scope_command(p_user_id uuid,p_mode text,p_unit_ids uuid[],p_version integer,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_units uuid[];v_before jsonb;v_payload jsonb;v_receipt fm_command_receipts%rowtype;v_created uuid;v_result jsonb;v_version integer;
begin
 if v_org is null or current_user_role() is distinct from 'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 if p_mode is null or p_mode not in ('all_units','selected_units') or p_unit_ids is null or array_length(p_unit_ids,1)>1000 or array_position(p_unit_ids,null) is not null or p_version is null or p_version<0 or p_request_id is null
 or p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'INVALID_INPUT';end if;
 v_units:=array(select distinct u from unnest(p_unit_ids) u order by u);
 if p_mode='all_units' and cardinality(v_units)>0 then raise exception 'INVALID_INPUT';end if;
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or current_user_role() is distinct from 'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 if not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=p_user_id and p.organization_id=v_org and p.role='fleet_manager' and coalesce(a.enabled,true)) then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from unnest(v_units) u where not exists(select 1 from fm_units t where t.id=u and t.organization_id=v_org)) then raise exception 'NOT_FOUND';end if;
 v_payload:=jsonb_build_object('user_id',p_user_id,'mode',p_mode,'unit_ids',v_units,'version',p_version,'reason',trim(p_reason));
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,v_actor,'manager.scope',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'manager.scope' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;
 select version into v_version from fm_manager_scopes where user_id=p_user_id;
 if coalesce(v_version,0)<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
 v_before:=jsonb_build_object('mode',(select mode from fm_manager_scopes where user_id=p_user_id),'unit_ids',coalesce((select jsonb_agg(unit_id order by unit_id) from fm_manager_scope_units where user_id=p_user_id and enabled),'[]'::jsonb),'version',coalesce(v_version,0));
 insert into fm_manager_scopes(user_id,organization_id,mode,version,updated_by) values(p_user_id,v_org,p_mode,p_version+1,v_actor)
 on conflict(user_id) do update set mode=excluded.mode,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
 -- Membership records are disabled/reactivated, never deleted to rewrite access history.
 update fm_manager_scope_units set enabled=false where user_id=p_user_id;
 insert into fm_manager_scope_units(user_id,organization_id,unit_id,enabled) select p_user_id,v_org,u,true from unnest(v_units) u
 on conflict(user_id,unit_id) do update set enabled=true;
 insert into fm_manager_scope_history(user_id,organization_id,mode,unit_ids,version,actor_id,source,reason) values(p_user_id,v_org,p_mode,v_units,p_version+1,v_actor,'administrative',trim(p_reason));
 v_result:=v_payload||jsonb_build_object('version',p_version+1);
 perform log_audit_event(v_org,v_actor,'manager.scope','profile',p_user_id,v_before,v_result);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$$;

create function public.fm_manager_scope_admin_snapshot() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();
begin
 if v_org is null or current_user_role() is distinct from 'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('units',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'enabled',enabled) order by name,id) from fm_units where organization_id=v_org),'[]'::jsonb),
 'managers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'enabled',coalesce(a.enabled,true),'mode',coalesce(s.mode,'selected_units'),'version',coalesce(s.version,0),'unit_ids',coalesce((select jsonb_agg(unit_id order by unit_id) from fm_manager_scope_units m where m.user_id=p.id and m.organization_id=v_org and m.enabled),'[]'::jsonb)) order by p.full_name,p.id) from profiles p left join fm_manager_scopes s on s.user_id=p.id left join fm_member_access a on a.user_id=p.id where p.organization_id=v_org and p.role='fleet_manager'),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (select * from fm_manager_scope_history where organization_id=v_org order by created_at desc,id desc limit 100) h),'[]'::jsonb));
end;$$;
create function public.fm_my_management_scope() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_mode text;v_units jsonb;
begin
 if v_org is null or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 v_mode:=case when current_user_role()='administrator' then 'all_units' else coalesce((select mode from fm_manager_scopes where user_id=auth.uid() and organization_id=v_org),'selected_units') end;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'enabled',u.enabled) order by u.name,u.id),'[]') into v_units from fm_units u where u.organization_id=v_org and fm_can_manage_unit(u.id);
 return jsonb_build_object('mode',v_mode,'units',v_units,'vehicle_ids',coalesce((select jsonb_agg(id order by id) from vehicles where organization_id=v_org and fm_can_manage_vehicle(id)),'[]'::jsonb));
end;$$;
revoke all on function public.fm_manager_scope_command(uuid,text,uuid[],integer,text,uuid),public.fm_manager_scope_admin_snapshot(),public.fm_my_management_scope() from public,anon;
grant execute on function public.fm_manager_scope_command(uuid,text,uuid[],integer,text,uuid),public.fm_manager_scope_admin_snapshot(),public.fm_my_management_scope() to authenticated;

-- Restrictive policies narrow legacy staff ALL policies; they never grant a
-- right by themselves. Personal reads and purpose-checked driver RPCs stay valid.
create policy fm_scope_vehicle_insert on public.vehicles as restrictive for insert to authenticated with check(not coalesce(fm_is_limited_manager(),false));
create policy fm_scope_vehicle_update on public.vehicles as restrictive for update to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(id)) with check(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(id));
create policy fm_scope_vehicle_delete on public.vehicles as restrictive for delete to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(id));
create policy fm_scope_reservation_read on public.reservations as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id) or trip_request_id in (select rls_visible_trip_request_ids()));
create policy fm_scope_reservation_insert on public.reservations as restrictive for insert to authenticated with check(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id) or (status='pending_approval' and trip_request_id in (select rls_hosted_trip_request_ids())));
create policy fm_scope_reservation_update on public.reservations as restrictive for update to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id)) with check(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_reservation_delete on public.reservations as restrictive for delete to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_trip_read on public.trip_requests as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_trip(id) or id in (select rls_visible_trip_request_ids()));
create policy fm_scope_trip_insert on public.trip_requests as restrictive for insert to authenticated with check(not coalesce(fm_is_limited_manager(),false) or requester_id=auth.uid());
create policy fm_scope_trip_update on public.trip_requests as restrictive for update to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_trip(id)) with check(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_trip(id));
create policy fm_scope_trip_delete on public.trip_requests as restrictive for delete to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_trip(id));
create policy fm_scope_participant_read on public.trip_participants as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_trip(trip_request_id) or passenger_id=auth.uid() or trip_request_id in (select rls_hosted_trip_request_ids()));
create policy fm_scope_offer_read on public.carpool_offers as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_trip(trip_request_id) or host_id=auth.uid() or id in (select rls_requested_offer_ids()));
create policy fm_scope_ride_read on public.carpool_ride_requests as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or rider_id=auth.uid() or exists(select 1 from carpool_offers o where o.id=carpool_offer_id and (o.host_id=auth.uid() or fm_can_manage_trip(o.trip_request_id))));
create policy fm_scope_inspection_read on public.inspections as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or performed_by=auth.uid() or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_message_read on public.reservation_messages as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_reservation(reservation_id) or exists(select 1 from reservations r where r.id=reservation_id and r.trip_request_id in (select rls_hosted_trip_request_ids())));
create policy fm_scope_task_read on public.workflow_tasks as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_task_insert on public.workflow_tasks as restrictive for insert to authenticated with check(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_task_update on public.workflow_tasks as restrictive for update to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id)) with check(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_task_delete on public.workflow_tasks as restrictive for delete to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_order_read on public.fm_work_orders as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_line_read on public.fm_work_order_lines as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or exists(select 1 from fm_work_orders o where o.id=work_order_id and fm_can_manage_vehicle(o.vehicle_id)));
create policy fm_scope_energy_read on public.fm_energy_events as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_gate_read on public.fm_gate_events as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or fm_can_manage_vehicle(vehicle_id));
create policy fm_scope_ack_read on public.fm_incident_acknowledgements as restrictive for select to authenticated using(not coalesce(fm_is_limited_manager(),false) or exists(select 1 from inspections i where i.id=inspection_id and fm_can_manage_vehicle(i.vehicle_id)));
-- Shared organization catalogs/settings cannot be changed by a unit-limited
-- manager: doing so would mutate other units. Existing read/booking rights stay.
create policy fm_scope_global_insert on public.vehicle_categories as restrictive for insert to authenticated with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_update on public.vehicle_categories as restrictive for update to authenticated using(not coalesce(public.fm_is_limited_manager(),false)) with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_delete on public.vehicle_categories as restrictive for delete to authenticated using(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_insert on public.vehicle_locations as restrictive for insert to authenticated with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_update on public.vehicle_locations as restrictive for update to authenticated using(not coalesce(public.fm_is_limited_manager(),false)) with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_delete on public.vehicle_locations as restrictive for delete to authenticated using(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_insert on public.safety_equipment_items as restrictive for insert to authenticated with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_update on public.safety_equipment_items as restrictive for update to authenticated using(not coalesce(public.fm_is_limited_manager(),false)) with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_delete on public.safety_equipment_items as restrictive for delete to authenticated using(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_insert on public.organization_settings as restrictive for insert to authenticated with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_update on public.organization_settings as restrictive for update to authenticated using(not coalesce(public.fm_is_limited_manager(),false)) with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_delete on public.organization_settings as restrictive for delete to authenticated using(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_insert on public.carpool_policy_settings as restrictive for insert to authenticated with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_update on public.carpool_policy_settings as restrictive for update to authenticated using(not coalesce(public.fm_is_limited_manager(),false)) with check(not coalesce(public.fm_is_limited_manager(),false));
create policy fm_scope_global_delete on public.carpool_policy_settings as restrictive for delete to authenticated using(not coalesce(public.fm_is_limited_manager(),false));

create function public.fm_management_create_vehicle(p_unit_id uuid,p_values jsonb) returns uuid
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_id uuid:=gen_random_uuid();v_category uuid;v_location uuid;v_odometer integer;v_next integer;v_range numeric;v_fuel numeric;v_battery numeric;v_plate text;
begin
 if v_org is null or current_user_role() not in ('administrator','fleet_manager') then raise exception 'NOT_AUTHORIZED';end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('plate','category_id','odometer_km','next_service_odometer_km','estimated_range_km','fuel_level_percent','battery_level_percent','home_location_id','name','color')) then raise exception 'INVALID_INPUT';end if;
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or current_user_role() not in ('administrator','fleet_manager') then raise exception 'NOT_AUTHORIZED';end if;
 if p_unit_id is null and coalesce(fm_is_limited_manager(),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 if p_unit_id is not null and not exists(select 1 from fm_units where id=p_unit_id and organization_id=v_org and enabled and fm_can_manage_unit(id)) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 v_category:=(p_values->>'category_id')::uuid;v_location:=(p_values->>'home_location_id')::uuid;v_odometer:=(p_values->>'odometer_km')::integer;v_next:=(p_values->>'next_service_odometer_km')::integer;v_range:=(p_values->>'estimated_range_km')::numeric;
 v_fuel:=(p_values->>'fuel_level_percent')::numeric;v_battery:=(p_values->>'battery_level_percent')::numeric;v_plate:=upper(trim(p_values->>'plate'));
 if not exists(select 1 from vehicle_categories where id=v_category and organization_id=v_org) or not exists(select 1 from vehicle_locations where id=v_location and organization_id=v_org) then raise exception 'INVALID_REFERENCE';end if;
 if v_plate is null or length(v_plate) not between 1 and 20 or v_odometer is null or v_odometer<0 or (v_next is not null and v_next<v_odometer)
 or v_range is null or v_range<0 or v_range='NaN'::numeric or v_range='Infinity'::numeric
 or (v_fuel is not null and not (v_fuel>=0 and v_fuel<=100)) or (v_battery is not null and not (v_battery>=0 and v_battery<=100)) then raise exception 'INVALID_INPUT';end if;
 insert into vehicles(id,organization_id,plate,category_id,status,odometer_km,next_service_odometer_km,estimated_range_km,fuel_level_percent,battery_level_percent,home_location_id,current_location_id,name,color)
 values(v_id,v_org,v_plate,v_category,'available',v_odometer,v_next,v_range,v_fuel,v_battery,v_location,v_location,nullif(trim(p_values->>'name'),''),nullif(trim(p_values->>'color'),''));
 if p_unit_id is not null then insert into fm_vehicle_units(vehicle_id,organization_id,unit_id) values(v_id,v_org,p_unit_id);end if;
 perform log_audit_event(v_org,auth.uid(),'vehicle.created','vehicle',v_id,null,jsonb_build_object('unit_id',p_unit_id,'values',p_values));
 return v_id;
end;$$;
revoke all on function public.fm_management_create_vehicle(uuid,jsonb) from public,anon;
grant execute on function public.fm_management_create_vehicle(uuid,jsonb) to authenticated;

-- Management views exclude personal records outside the portfolio, while the
-- existing organizational booking catalog and own-trip reads stay available.
create view public.fm_managed_vehicles with(security_invoker=true) as select v.* from public.vehicles v where public.fm_can_manage_vehicle(v.id);
create view public.fm_managed_reservations with(security_invoker=true) as select r.* from public.reservations r where public.fm_can_manage_vehicle(r.vehicle_id);
create view public.fm_managed_trip_requests with(security_invoker=true) as select t.* from public.trip_requests t where public.fm_can_manage_trip(t.id);
create view public.fm_managed_inspections with(security_invoker=true) as select i.* from public.inspections i where public.fm_can_manage_vehicle(i.vehicle_id);
create view public.fm_managed_workflow_tasks with(security_invoker=true) as select w.* from public.workflow_tasks w where public.fm_can_manage_vehicle(w.vehicle_id);
create view public.fm_managed_carpool_offers with(security_invoker=true) as select o.* from public.carpool_offers o where public.fm_can_manage_trip(o.trip_request_id);
create view public.fm_managed_ride_requests with(security_invoker=true) as select q.id,q.organization_id,q.carpool_offer_id,q.rider_id,q.status,q.requested_seats,q.created_at from public.carpool_ride_requests q where exists(select 1 from public.carpool_offers o where o.id=q.carpool_offer_id and public.fm_can_manage_trip(o.trip_request_id));
create view public.fm_managed_people with(security_invoker=true) as select p.id,p.organization_id,p.full_name,p.role from public.profiles p where p.organization_id=public.current_organization_id() and public.current_user_role() in ('administrator','fleet_manager') and
 (not coalesce(public.fm_is_limited_manager(),false) or p.id=auth.uid() or exists(select 1 from public.trip_requests t join public.reservations r on r.trip_request_id=t.id where t.requester_id=p.id and public.fm_can_manage_vehicle(r.vehicle_id)));
revoke all on public.fm_managed_vehicles,public.fm_managed_reservations,public.fm_managed_trip_requests,public.fm_managed_inspections,public.fm_managed_workflow_tasks,public.fm_managed_carpool_offers,public.fm_managed_ride_requests,public.fm_managed_people from public,anon,authenticated;
grant select on public.fm_managed_vehicles,public.fm_managed_reservations,public.fm_managed_trip_requests,public.fm_managed_inspections,public.fm_managed_workflow_tasks,public.fm_managed_carpool_offers,public.fm_managed_ride_requests,public.fm_managed_people to authenticated;

create function public.fm_vehicle_reference_scope() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if (TG_OP='INSERT' or new.category_id is distinct from old.category_id) and not exists(select 1 from vehicle_categories where id=new.category_id and organization_id=new.organization_id) then raise exception 'INVALID_REFERENCE';end if;
 if (TG_OP='INSERT' or new.home_location_id is distinct from old.home_location_id) and new.home_location_id is not null and not exists(select 1 from vehicle_locations where id=new.home_location_id and organization_id=new.organization_id) then raise exception 'INVALID_REFERENCE';end if;
 if (TG_OP='INSERT' or new.current_location_id is distinct from old.current_location_id) and new.current_location_id is not null and not exists(select 1 from vehicle_locations where id=new.current_location_id and organization_id=new.organization_id) then raise exception 'INVALID_REFERENCE';end if;
 return new;
end;$$;
create trigger fm_vehicle_reference_scope before insert or update of category_id,home_location_id,current_location_id on public.vehicles for each row execute function public.fm_vehicle_reference_scope();
revoke all on function public.fm_vehicle_reference_scope() from public,anon,authenticated;
