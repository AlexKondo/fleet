-- Local key custody is an explicit administrative assignment, independent of
-- profiles.role and of fleet management. No unit or grant is inferred from a
-- parking location, a display name or demonstration data.
create table public.fm_units (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120),
 enabled boolean not null default true,
 workflow text not null check(workflow in ('gate_visual','key_custody')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 unique(organization_id,id)
);
create unique index fm_units_name on public.fm_units(organization_id,lower(trim(name)));
create table public.fm_vehicle_units (
 vehicle_id uuid primary key references public.vehicles(id),
 organization_id uuid not null references public.organizations(id),
 unit_id uuid not null,
 version integer not null default 1 check(version>0),
 foreign key(organization_id,unit_id) references public.fm_units(organization_id,id)
);
create table public.fm_key_custodians (
 organization_id uuid not null references public.organizations(id),
 unit_id uuid not null,
 user_id uuid not null references public.profiles(id),
 enabled boolean not null,
 version integer not null default 1 check(version>0),
 assigned_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now(),
 primary key(unit_id,user_id),
 foreign key(organization_id,unit_id) references public.fm_units(organization_id,id)
);
create table public.fm_key_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 unit_id uuid not null,
 reservation_id uuid not null references public.reservations(id),
 vehicle_id uuid not null references public.vehicles(id),
 actor_id uuid not null references public.profiles(id),
 actor_role public.user_role not null,
 assignment_version integer not null,
 kind text not null check(kind in ('delivered','received','exception')),
 reason text check(reason is null or length(trim(reason)) between 3 and 1000),
 created_at timestamptz not null default now(),
 foreign key(organization_id,unit_id) references public.fm_units(organization_id,id),
 check(kind<>'exception' or reason is not null)
);
create unique index fm_key_once on public.fm_key_events(reservation_id,kind) where kind in ('delivered','received');
create index fm_key_vehicle on public.fm_key_events(vehicle_id,reservation_id,kind);
create index fm_key_unit on public.fm_key_events(organization_id,unit_id,created_at);

-- Access is through purpose-specific RPCs: a custodian receives no general
-- profile, reservation, inspection, vehicle-management or administrator grant.
alter table public.fm_units enable row level security;
alter table public.fm_vehicle_units enable row level security;
alter table public.fm_key_custodians enable row level security;
alter table public.fm_key_events enable row level security;
revoke all on public.fm_units,public.fm_vehicle_units,public.fm_key_custodians,public.fm_key_events from public,anon,authenticated;
create trigger fm_keys_append_only before update or delete on public.fm_key_events for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_keys_no_truncate before truncate on public.fm_key_events for each statement execute function public.fm_preserve_inspection_evidence();

create function public.fm_unit_admin_command(p_command text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_id uuid;v_unit uuid;v_user uuid;v_vehicle uuid;
 v_version integer;v_enabled boolean;v_name text;v_workflow text;v_reason text;v_receipt fm_command_receipts%rowtype;v_created uuid;v_result jsonb;
begin
 if v_org is null or current_user_role()<>'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
 or p_command is null or p_command not in ('unit.save','unit.vehicle','unit.custodian') then raise exception 'INVALID_INPUT';end if;
 v_reason:=trim(p_payload->>'reason');
 if v_reason is null or length(v_reason) not between 3 and 1000 then raise exception 'REASON_REQUIRED';end if;
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or current_user_role() is distinct from 'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload)
 values(v_org,p_request_id,v_actor,p_command,p_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>p_command or v_receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;
 v_version:=(p_payload->>'version')::integer;
 if v_version is null or v_version<0 then raise exception 'INVALID_INPUT';end if;
 if p_command='unit.save' then
  v_id:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());v_name:=trim(p_payload->>'name');v_enabled:=(p_payload->>'enabled')::boolean;v_workflow:=p_payload->>'workflow';
  if v_name is null or length(v_name) not between 1 and 120 or v_enabled is null or v_workflow is null or v_workflow not in ('gate_visual','key_custody') then raise exception 'INVALID_INPUT';end if;
  if exists(select 1 from fm_units where id=v_id and organization_id<>v_org) then raise exception 'NOT_FOUND';end if;
  if coalesce((select version from fm_units where id=v_id and organization_id=v_org),0)<>v_version then raise exception 'CONCURRENT_UPDATE';end if;
  perform 1 from vehicles v join fm_vehicle_units m on m.vehicle_id=v.id where m.unit_id=v_id and m.organization_id=v_org order by v.id for update of v;
  if (not v_enabled or exists(select 1 from fm_units where id=v_id and workflow<>v_workflow)) and exists(select 1 from fm_key_events e where e.unit_id=v_id and e.kind='delivered' and not exists(select 1 from fm_key_events r where r.reservation_id=e.reservation_id and r.kind='received')) then raise exception 'KEYS_OUTSTANDING';end if;
  if exists(select 1 from fm_units where id=v_id and (workflow<>v_workflow or (enabled and not v_enabled))) and exists(select 1 from fm_vehicle_units m join reservations r on r.vehicle_id=m.vehicle_id where m.unit_id=v_id and r.status in ('pending_approval','confirmed')) then raise exception 'ACTIVE_RESERVATION';end if;
  insert into fm_units(id,organization_id,name,enabled,workflow,version) values(v_id,v_org,v_name,v_enabled,v_workflow,v_version+1)
   on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,workflow=excluded.workflow,version=excluded.version;
 elsif p_command='unit.vehicle' then
  v_vehicle:=(p_payload->>'vehicle_id')::uuid;v_unit:=(p_payload->>'unit_id')::uuid;v_id:=v_vehicle;
  perform 1 from vehicles where id=v_vehicle and organization_id=v_org for update;
  if not found or not exists(select 1 from fm_units where id=v_unit and organization_id=v_org and enabled) then raise exception 'NOT_FOUND';end if;
  if coalesce((select version from fm_vehicle_units where vehicle_id=v_vehicle),0)<>v_version then raise exception 'CONCURRENT_UPDATE';end if;
  if exists(select 1 from reservations where vehicle_id=v_vehicle and status in ('pending_approval','confirmed')) then raise exception 'ACTIVE_RESERVATION';end if;
  if exists(select 1 from fm_key_events e where e.vehicle_id=v_vehicle and e.kind='delivered' and not exists(select 1 from fm_key_events r where r.reservation_id=e.reservation_id and r.kind='received')) then raise exception 'KEYS_OUTSTANDING';end if;
  insert into fm_vehicle_units(vehicle_id,organization_id,unit_id,version) values(v_vehicle,v_org,v_unit,v_version+1)
   on conflict(vehicle_id) do update set unit_id=excluded.unit_id,version=excluded.version;
 else
  v_unit:=(p_payload->>'unit_id')::uuid;v_user:=(p_payload->>'user_id')::uuid;v_id:=v_user;v_enabled:=(p_payload->>'enabled')::boolean;
  if v_enabled is null or not exists(select 1 from profiles where id=v_user and organization_id=v_org)
  or not exists(select 1 from fm_units where id=v_unit and organization_id=v_org and (enabled or not v_enabled)) then raise exception 'NOT_FOUND';end if;
  if v_enabled and exists(select 1 from fm_member_access where user_id=v_user and not enabled) then raise exception 'ACCOUNT_DISABLED';end if;
  if coalesce((select version from fm_key_custodians where unit_id=v_unit and user_id=v_user),0)<>v_version then raise exception 'CONCURRENT_UPDATE';end if;
  insert into fm_key_custodians(organization_id,unit_id,user_id,enabled,version,assigned_by) values(v_org,v_unit,v_user,v_enabled,v_version+1,v_actor)
   on conflict(unit_id,user_id) do update set enabled=excluded.enabled,version=excluded.version,assigned_by=excluded.assigned_by,updated_at=now();
 end if;
 v_result:=jsonb_build_object('id',v_id,'version',v_version+1);
 perform log_audit_event(v_org,v_actor,p_command,'unit',coalesce(v_unit,v_id),null,p_payload);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$$;

create function public.fm_key_command(p_reservation_id uuid,p_kind text,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_res reservations%rowtype;v_vehicle vehicles%rowtype;
 v_unit uuid;v_version integer;v_requester uuid;v_grace integer;v_created uuid;v_receipt fm_command_receipts%rowtype;v_result jsonb;v_id uuid;
 v_payload jsonb:=jsonb_build_object('reservation_id',p_reservation_id,'kind',p_kind,'reason',p_reason);
begin
 if v_org is null or v_actor is null then raise exception 'NOT_AUTHORIZED';end if;
 if to_regclass('public.fm_reservation_operations') is null then raise exception 'OFFICE_WORKFLOW_UNAVAILABLE';end if;
 if p_request_id is null or p_kind is null or p_kind not in ('delivered','received','exception')
 or (p_reason is not null and length(trim(p_reason)) not between 3 and 1000) or (p_kind='exception' and p_reason is null) then raise exception 'INVALID_INPUT';end if;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org;
 if not found then raise exception 'NOT_FOUND';end if;
 -- Organization lock shares ordering with administrative revocation, so a
 -- custodian cannot use a stale assignment during a concurrent revocation.
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or not fm_account_enabled() then raise exception 'NOT_AUTHORIZED';end if;
 select * into v_vehicle from vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
 select * into v_res from reservations where id=p_reservation_id and organization_id=v_org for update;
 if v_res.vehicle_id is distinct from v_vehicle.id then raise exception 'CONCURRENT_UPDATE';end if;
 select m.unit_id,c.version into v_unit,v_version from fm_vehicle_units m join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id
 join fm_key_custodians c on c.unit_id=m.unit_id and c.organization_id=m.organization_id
 where m.vehicle_id=v_vehicle.id and m.organization_id=v_org and u.enabled and u.workflow='key_custody' and c.user_id=v_actor and c.enabled;
 if v_unit is null then raise exception 'KEY_CUSTODY_NOT_AUTHORIZED';end if;
 select requester_id into v_requester from trip_requests where id=v_res.trip_request_id and organization_id=v_org;
 if v_actor=v_requester then raise exception 'INDEPENDENT_CUSTODIAN_REQUIRED';end if;
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload)
 values(v_org,p_request_id,v_actor,'keys.record',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'keys.record' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;
 if p_kind<>'exception' and exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind=p_kind) then raise exception 'KEY_EVENT_ALREADY_RECORDED';end if;
 if p_kind='delivered' then
  perform fm_assert_can_drive(v_requester,v_org);
  if v_res.status<>'confirmed' then raise exception 'RESERVATION_NOT_CONFIRMED';end if;
  select early_pickup_grace_minutes into v_grace from organization_settings where organization_id=v_org;
  if now()<v_res.start_at-make_interval(mins=>coalesce(v_grace,15)) or now()>=v_res.end_at then raise exception 'PICKUP_WINDOW_INVALID';end if;
  if v_vehicle.status not in ('available','reserved','awaiting_pickup') or v_vehicle.has_blocking_damage or cardinality(v_vehicle.missing_safety_equipment)>0 then raise exception 'VEHICLE_NOT_READY';end if;
  if not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=v_requester and p.organization_id=v_org
   and p.driver_authorized and p.drivers_license_expiration>=(now() at time zone 'America/Sao_Paulo')::date and coalesce(a.enabled,true)) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
  if exists(select 1 from fm_key_events e where e.vehicle_id=v_vehicle.id and e.kind='delivered' and not exists(select 1 from fm_key_events r where r.reservation_id=e.reservation_id and r.kind='received')) then raise exception 'KEYS_OUTSTANDING';end if;
 elsif p_kind='received' then
  if not exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered') then raise exception 'KEY_DELIVERY_REQUIRED';end if;
 end if;
 insert into fm_key_events(organization_id,unit_id,reservation_id,vehicle_id,actor_id,actor_role,assignment_version,kind,reason)
 values(v_org,v_unit,p_reservation_id,v_vehicle.id,v_actor,current_user_role(),v_version,p_kind,trim(p_reason)) returning id into v_id;
 -- A key handover is not a vehicle inspection, physical gate movement or an
 -- authorization to release damage. Those workflows remain separate.
 perform log_audit_event(v_org,v_actor,'keys.'||p_kind,'reservation',p_reservation_id,null,jsonb_build_object('event_id',v_id,'unit_id',v_unit,'assignment_version',v_version,'reason',p_reason));
 v_result:=jsonb_build_object('id',v_id);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$$;

create function public.fm_unit_admin_snapshot() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();
begin
 if v_org is null or current_user_role()<>'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object(
 'units',coalesce((select jsonb_agg(to_jsonb(u) order by u.name,u.id) from fm_units u where u.organization_id=v_org),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(to_jsonb(c)) from fm_key_custodians c where c.organization_id=v_org),'[]'::jsonb),
 'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'plate',v.plate,'unit_id',m.unit_id,'version',coalesce(m.version,0)) order by v.plate,v.id) from vehicles v left join fm_vehicle_units m on m.vehicle_id=v.id where v.organization_id=v_org),'[]'::jsonb),
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'role',p.role,'enabled',coalesce(a.enabled,true)) order by p.full_name,p.id) from profiles p left join fm_member_access a on a.user_id=p.id where p.organization_id=v_org),'[]'::jsonb));
end;$$;

create function public.fm_key_workspace() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
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
 where r.organization_id=v_org and u.enabled and u.workflow='key_custody' and ((r.status='confirmed' and r.end_at>=now()-interval '1 day' and r.start_at<now()+interval '7 days')
 or exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='delivered' and not exists(select 1 from fm_key_events x where x.reservation_id=r.id and x.kind='received')))),'[]'::jsonb));
end;$$;
revoke all on function public.fm_unit_admin_command(text,jsonb,uuid),public.fm_key_command(uuid,text,text,uuid),public.fm_unit_admin_snapshot(),public.fm_key_workspace() from public,anon;
grant execute on function public.fm_unit_admin_command(text,jsonb,uuid),public.fm_key_command(uuid,text,text,uuid),public.fm_unit_admin_snapshot(),public.fm_key_workspace() to authenticated;
