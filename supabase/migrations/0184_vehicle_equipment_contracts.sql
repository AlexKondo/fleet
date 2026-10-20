-- Configured physical inventory/requirements, never inferred from a powertrain.
alter table public.safety_equipment_items add column enabled boolean not null default true;
create policy fm_equipment_catalog_update on public.safety_equipment_items for update to authenticated using(organization_id=current_organization_id() and current_user_role() in ('fleet_manager','administrator') and not coalesce(fm_is_limited_manager(),false)) with check(organization_id=current_organization_id() and current_user_role() in ('fleet_manager','administrator') and not coalesce(fm_is_limited_manager(),false));
create function public.fm_equipment_catalog_preserve() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if TG_OP='DELETE' then raise exception 'PRESERVE_EQUIPMENT_HISTORY';end if;
 if new.name is distinct from old.name or new.organization_id is distinct from old.organization_id or new.id is distinct from old.id then raise exception 'PRESERVE_EQUIPMENT_HISTORY';end if;
 perform log_audit_event(new.organization_id,auth.uid(),'equipment.catalog_status','equipment',new.id,jsonb_build_object('enabled',old.enabled),jsonb_build_object('enabled',new.enabled));return new;
end;$$;
create trigger fm_equipment_catalog_preserve before update or delete on public.safety_equipment_items for each row execute function public.fm_equipment_catalog_preserve();
create table public.fm_equipment_profiles(
 target_kind text not null check(target_kind in ('vehicle','category')),target_id uuid not null,organization_id uuid not null references organizations(id),
 enabled boolean not null,required_ids uuid[] not null,optional_ids uuid[] not null,version integer not null check(version>0),
 updated_by uuid not null references profiles(id),updated_at timestamptz not null default now(),primary key(target_kind,target_id)
);
alter table public.fm_equipment_profiles enable row level security;
revoke all on public.fm_equipment_profiles from public,anon,authenticated;
create function public.fm_equipment_effective(p_vehicle_id uuid) returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_category uuid;v_profile fm_equipment_profiles%rowtype;
begin
 select category_id into v_category from vehicles where id=p_vehicle_id and organization_id=current_organization_id();
 if v_category is null then raise exception 'NOT_AUTHORIZED';end if;
 select * into v_profile from fm_equipment_profiles where organization_id=current_organization_id() and enabled and ((target_kind='vehicle' and target_id=p_vehicle_id) or (target_kind='category' and target_id=v_category)) order by (target_kind='vehicle') desc limit 1;
 if not found then return jsonb_build_object('configured',false);end if;
 return jsonb_build_object('configured',true,'source',v_profile.target_kind,'version',v_profile.version,'required',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.name,e.id) from safety_equipment_items e where e.id=any(v_profile.required_ids) and e.organization_id=current_organization_id()),'[]'::jsonb),'optional',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.name,e.id) from safety_equipment_items e where e.id=any(v_profile.optional_ids) and e.organization_id=current_organization_id()),'[]'::jsonb));
end;$$;
create function public.fm_equipment_profile_save(p_kind text,p_target_id uuid,p_required_ids uuid[],p_optional_ids uuid[],p_enabled boolean,p_version integer,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_role user_role:=current_user_role();v_required uuid[];v_optional uuid[];v_version integer;v_payload jsonb;v_result jsonb;v_receipt fm_command_receipts%rowtype;v_created uuid;
begin
 if v_org is null or p_kind is null or p_kind not in ('vehicle','category') then raise exception 'NOT_AUTHORIZED';end if;
 if p_kind='vehicle' and not fm_can_manage_vehicle(p_target_id) then raise exception 'NOT_AUTHORIZED';end if;
 if p_kind='category' and (v_role is distinct from 'administrator' or not exists(select 1 from vehicle_categories where id=p_target_id and organization_id=v_org)) then raise exception 'NOT_AUTHORIZED';end if;
 if p_required_ids is null or p_optional_ids is null or cardinality(p_required_ids)>1000 or cardinality(p_optional_ids)>1000 or array_position(p_required_ids,null) is not null or array_position(p_optional_ids,null) is not null or p_enabled is null or p_version is null or p_version<0 or p_request_id is null or p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'INVALID_INPUT';end if;
 v_required:=array(select distinct x from unnest(p_required_ids) x order by x);v_optional:=array(select distinct x from unnest(p_optional_ids) x order by x);
 if v_required&&v_optional or (not p_enabled and (cardinality(v_required)>0 or cardinality(v_optional)>0)) then raise exception 'INVALID_INPUT';end if;
 perform 1 from organizations where id=v_org for no key update;
 if p_kind='vehicle' then
 perform 1 from vehicles where id=p_target_id and organization_id=v_org for update;
 if not fm_can_manage_vehicle(p_target_id) then raise exception 'NOT_AUTHORIZED';end if;
 end if;
 if current_organization_id() is distinct from v_org or (p_kind='category' and current_user_role() is distinct from 'administrator') then raise exception 'NOT_AUTHORIZED';end if;
 if exists(select 1 from unnest(v_required||v_optional) x where not exists(select 1 from safety_equipment_items where id=x and organization_id=v_org and enabled)) then raise exception 'INVALID_REFERENCE';end if;
 if (select count(*) from safety_equipment_items where id=any(v_required||v_optional))<>(select count(distinct lower(trim(name))) from safety_equipment_items where id=any(v_required||v_optional)) then raise exception 'DUPLICATE_EQUIPMENT_NAME';end if;
 v_payload:=jsonb_build_object('kind',p_kind,'target_id',p_target_id,'required_ids',v_required,'optional_ids',v_optional,'enabled',p_enabled,'version',p_version,'reason',trim(p_reason));
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,auth.uid(),'equipment.profile',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
 select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
 if v_receipt.actor_id<>auth.uid() or v_receipt.command<>'equipment.profile' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;
 end if;
 select version into v_version from fm_equipment_profiles where target_kind=p_kind and target_id=p_target_id;
 if coalesce(v_version,0)<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
 insert into fm_equipment_profiles(target_kind,target_id,organization_id,enabled,required_ids,optional_ids,version,updated_by) values(p_kind,p_target_id,v_org,p_enabled,v_required,v_optional,p_version+1,auth.uid())
 on conflict(target_kind,target_id) do update set enabled=excluded.enabled,required_ids=excluded.required_ids,optional_ids=excluded.optional_ids,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
 v_result:=v_payload||jsonb_build_object('version',p_version+1);
 perform log_audit_event(v_org,auth.uid(),'equipment.profile','vehicle_equipment',p_target_id,to_jsonb(v_version),v_result);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$$;
create function public.fm_equipment_vehicle_snapshot(p_vehicle_id uuid) returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_vehicle vehicles%rowtype;
begin
 select * into v_vehicle from vehicles where id=p_vehicle_id and organization_id=v_org;
 if not found or not(fm_can_manage_vehicle(p_vehicle_id) or current_user_role()='maintenance_operator') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('vehicle',jsonb_build_object('id',v_vehicle.id,'plate',v_vehicle.plate,'category_id',v_vehicle.category_id),'can_edit',fm_can_manage_vehicle(v_vehicle.id),'can_edit_category',current_user_role()='administrator',
 'effective',fm_equipment_effective(v_vehicle.id),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p)) from fm_equipment_profiles p where organization_id=v_org and ((target_kind='vehicle' and target_id=v_vehicle.id) or (target_kind='category' and target_id=v_vehicle.category_id))),'[]'::jsonb),
 'catalog',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'enabled',enabled) order by name,id) from safety_equipment_items where organization_id=v_org),'[]'::jsonb));
end;$$;
create table public.fm_equipment_contracts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id),reservation_id uuid not null references reservations(id),vehicle_id uuid not null references vehicles(id),
 source text not null check(source in ('vehicle','category','legacy_return_observation')),configuration_version integer not null,
 required_names text[] not null,optional_names text[] not null,created_by uuid not null references profiles(id),created_at timestamptz not null default now(),
 unique(reservation_id,vehicle_id)
);
alter table public.fm_equipment_contracts enable row level security;
revoke all on public.fm_equipment_contracts from public,anon,authenticated;
create trigger fm_equipment_contract_immutable before update or delete on public.fm_equipment_contracts for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_equipment_contract_no_truncate before truncate on public.fm_equipment_contracts for each statement execute function public.fm_preserve_inspection_evidence();
alter table public.inspections add column equipment_contract_id uuid references fm_equipment_contracts(id);
create function public.fm_prepare_equipment_checklist(p_reservation_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
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
end;$$;
create function public.fm_inspection_equipment_contract() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare v_contract jsonb;v_names text[];
begin
 if new.performed_by_role='traveler' then
  v_contract:=fm_prepare_equipment_checklist(new.reservation_id);
  v_names:=array(select jsonb_array_elements_text(v_contract->'required_names'));
  if new.missing_safety_equipment is null or exists(select 1 from unnest(new.missing_safety_equipment) x where x is null or not(x=any(v_names))) then raise exception 'INVALID_EQUIPMENT_OBSERVATION';end if;
  new.equipment_contract_id:=(v_contract->>'id')::uuid;
 else new.equipment_contract_id:=null;end if;
 return new;
end;$$;
create trigger zz_fm_inspection_equipment_contract before insert on public.inspections for each row execute function public.fm_inspection_equipment_contract();
revoke all on function public.fm_equipment_catalog_preserve(),public.fm_equipment_effective(uuid),public.fm_inspection_equipment_contract() from public,anon,authenticated;
revoke all on function public.fm_equipment_profile_save(text,uuid,uuid[],uuid[],boolean,integer,text,uuid),public.fm_equipment_vehicle_snapshot(uuid),public.fm_prepare_equipment_checklist(uuid) from public,anon;
grant execute on function public.fm_equipment_profile_save(text,uuid,uuid[],uuid[],boolean,integer,text,uuid),public.fm_equipment_vehicle_snapshot(uuid),public.fm_prepare_equipment_checklist(uuid) to authenticated;
