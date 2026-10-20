-- FleetMind v3: additive operational records. No existing record is backfilled
-- as a physical movement, cost or completed service without evidence.
alter table public.vehicles add column vin text;
alter table public.vehicles add column next_service_date date;
alter table public.vehicles add constraint fm_vin_format check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$');
create unique index fm_vehicle_vin_unique on public.vehicles(organization_id,vin) where vin is not null;

create table public.fm_work_orders (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 vehicle_id uuid not null references public.vehicles(id), number bigint generated always as identity,
 kind text not null check(kind in ('preventive','corrective','inspection')),
 status text not null default 'draft' check(status in ('draft','budgeted','approved','scheduled','in_progress','partial','completed','cancelled')),
 description text not null check(length(description) between 3 and 3000), supplier text not null default '',
 quote_total numeric(14,2) not null default 0 check(quote_total>=0), approved_total numeric(14,2) check(approved_total>=0),
 scheduled_start timestamptz, scheduled_end timestamptz, workflow_task_id uuid references public.workflow_tasks(id),
 version integer not null default 1, created_by uuid not null references public.profiles(id), approved_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), completed_at timestamptz,
 check((scheduled_start is null and scheduled_end is null) or scheduled_end>scheduled_start)
);
create index fm_work_orders_scope on public.fm_work_orders(organization_id,vehicle_id,created_at desc);
create table public.fm_work_order_lines (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 work_order_id uuid not null references public.fm_work_orders(id),description text not null check(length(description) between 2 and 500),
 stage text not null default 'planned' check(stage in ('planned','actual')),
 category text not null check(category in ('parts','labor','service','other')), quantity numeric(12,3) not null check(quantity>0),
 unit_price numeric(14,2) not null check(unit_price>=0), warranty boolean not null default false,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,void_reason text
);
create index fm_work_order_lines_scope on public.fm_work_order_lines(organization_id,work_order_id);
create table public.fm_energy_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),vehicle_id uuid not null references public.vehicles(id),
 kind text not null check(kind in ('fuel','charge')), quantity numeric(12,3) not null check(quantity>0),
 fuel_type text check(fuel_type in ('gasoline','ethanol','diesel')), total_cost numeric(14,2) not null check(total_cost>=0),
 odometer_km integer not null check(odometer_km>=0),event_at timestamptz not null, supplier text not null default '',
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),voided_at timestamptz,void_reason text,
 check((kind='fuel' and fuel_type is not null) or (kind='charge' and fuel_type is null))
);
create index fm_energy_events_scope on public.fm_energy_events(organization_id,event_at desc);
create table public.fm_gate_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 reservation_id uuid not null references public.reservations(id),vehicle_id uuid not null references public.vehicles(id),
 kind text not null check(kind in ('departure','arrival','denied')),reason text not null default '',
 legacy_arrival boolean not null default false,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create unique index fm_gate_once on public.fm_gate_events(reservation_id,kind) where kind in ('departure','arrival');
create index fm_gate_scope on public.fm_gate_events(organization_id,created_at desc);
create table public.fm_incident_acknowledgements (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 inspection_id uuid not null references public.inspections(id),actor_id uuid not null references public.profiles(id),
 notes text not null default '',created_at timestamptz not null default now(),unique(inspection_id,actor_id)
);
alter table public.fm_incident_acknowledgements enable row level security;
revoke all on public.fm_incident_acknowledgements from public,anon,authenticated;
grant select on public.fm_incident_acknowledgements to authenticated;
create policy fm_ack_read on public.fm_incident_acknowledgements for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.profiles where id=auth.uid() and role in ('fleet_manager','administrator','security')));
create table public.fm_command_receipts (
 organization_id uuid not null references public.organizations(id),request_id uuid not null,actor_id uuid not null references public.profiles(id),
 command text not null,payload jsonb not null,result jsonb,created_at timestamptz not null default now(),primary key(organization_id,request_id)
);

-- PostgreSQL numeric accepts NaN; reject it at the boundary even for direct RPC clients.
alter table public.fm_work_orders add constraint fm_quote_finite check(quote_total<>'NaN'::numeric and (approved_total is null or approved_total<>'NaN'::numeric));
alter table public.fm_work_order_lines add constraint fm_lines_finite check(quantity<>'NaN'::numeric and unit_price<>'NaN'::numeric);
alter table public.fm_energy_events add constraint fm_energy_finite check(quantity<>'NaN'::numeric and total_cost<>'NaN'::numeric);

-- All writes go through the checked, transactional command below. Even an
-- administrator's session cannot directly update/delete financial/movement rows.
alter table public.fm_work_orders enable row level security;
alter table public.fm_work_order_lines enable row level security;
alter table public.fm_energy_events enable row level security;
alter table public.fm_gate_events enable row level security;
alter table public.fm_command_receipts enable row level security;
revoke all on public.fm_work_orders,public.fm_work_order_lines,public.fm_energy_events,public.fm_gate_events,public.fm_command_receipts from public,anon,authenticated;
grant select on public.fm_work_orders,public.fm_work_order_lines,public.fm_energy_events,public.fm_gate_events to authenticated;
create policy fm_orders_read on public.fm_work_orders for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.profiles where id=auth.uid() and role in ('fleet_manager','administrator','maintenance_operator')));
create policy fm_lines_read on public.fm_work_order_lines for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.profiles where id=auth.uid() and role in ('fleet_manager','administrator','maintenance_operator')));
create policy fm_energy_read on public.fm_energy_events for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.profiles where id=auth.uid() and role in ('fleet_manager','administrator')));
create policy fm_gate_read on public.fm_gate_events for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.profiles where id=auth.uid() and role in ('fleet_manager','administrator','security')));

create function public.fm_immutable_vin() returns trigger language plpgsql set search_path=public as $$
begin
 if old.vin is not null and new.vin is distinct from old.vin then raise exception 'IMMUTABLE_VIN';end if;
 return new;
end;$$;
create trigger fm_vehicle_vin_immutable before update of vin on public.vehicles for each row execute function public.fm_immutable_vin();

-- Both booking and maintenance take the same vehicle row lock before checking
-- intervals, so two concurrent transactions cannot reserve the same window.
create function public.fm_reservation_maintenance_guard() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if new.status in ('confirmed','pending_approval') then
  perform 1 from public.vehicles where id=new.vehicle_id and organization_id=new.organization_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if exists(select 1 from public.fm_work_orders where vehicle_id=new.vehicle_id and organization_id=new.organization_id
    and status in ('scheduled','in_progress','partial') and tstzrange(scheduled_start,scheduled_end,'[)') && tstzrange(new.start_at,new.end_at,'[)')) then
   raise exception 'MAINTENANCE_CONFLICT';
  end if;
 end if;return new;
end;$$;
create trigger fm_reservation_maintenance before insert or update of start_at,end_at,vehicle_id,status on public.reservations for each row execute function public.fm_reservation_maintenance_guard();

create function public.fm_v3_command(p_command text,p_payload jsonb,p_request_id uuid) returns jsonb
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
  if (v_kind='fuel' and v_energy='BEV') or (v_kind='charge' and v_energy='ICE') then raise exception 'POWERTRAIN_MISMATCH';end if;
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
   if v_res.status<>'confirmed' or v_vehicle.status<>'in_use' or v_vehicle.has_blocking_damage or not v_vehicle.documentation_valid or cardinality(v_vehicle.missing_safety_equipment)>0 then raise exception 'DEPARTURE_BLOCKED';end if;
   if not exists(select 1 from public.inspections where reservation_id=v_res.id and organization_id=v_org and type='pickup' and performed_by_role='traveler')
    or not exists(select 1 from public.inspections where reservation_id=v_res.id and organization_id=v_org and type='pickup' and performed_by_role='security') then raise exception 'CHECKLIST_REQUIRED';end if;
   if now()<v_res.start_at or now()>v_res.end_at then raise exception 'OUTSIDE_RESERVATION_WINDOW';end if;
  elsif v_kind='denied' and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';
  elsif v_kind='arrival' and not exists(select 1 from public.fm_gate_events where reservation_id=v_res.id and kind='departure') and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'LEGACY_ARRIVAL_REASON_REQUIRED';end if;
  insert into public.fm_gate_events(organization_id,reservation_id,vehicle_id,kind,reason,legacy_arrival,created_by)
  values(v_org,v_res.id,v_vehicle.id,v_kind,left(coalesce(p_payload->>'reason',''),1000),v_kind='arrival' and not exists(select 1 from public.fm_gate_events where reservation_id=v_res.id and kind='departure'),v_actor) returning id into v_id;

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

-- Anonymous/security sessions cannot obtain costs through this definer function.
create function public.fm_v3_snapshot() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=public.current_organization_id();v_role public.user_role;v_result jsonb:='{}';
begin
 select role into v_role from public.profiles where id=auth.uid() and organization_id=v_org;
 if v_role is null or v_role='employee' then raise exception 'NOT_AUTHORIZED';end if;
 if v_role in ('fleet_manager','administrator','maintenance_operator') then
  v_result:=v_result||jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.fm_work_orders o where organization_id=v_org),'[]'::jsonb),
  'lines',coalesce((select jsonb_agg(to_jsonb(l)) from public.fm_work_order_lines l where organization_id=v_org),'[]'::jsonb));
 end if;
 if v_role in ('fleet_manager','administrator') then v_result:=v_result||jsonb_build_object('energy',coalesce((select jsonb_agg(to_jsonb(e) order by event_at desc) from public.fm_energy_events e where organization_id=v_org),'[]'::jsonb));end if;
 if v_role in ('fleet_manager','administrator','security') then v_result:=v_result||jsonb_build_object('gate',coalesce((select jsonb_agg(to_jsonb(g) order by created_at desc) from public.fm_gate_events g where organization_id=v_org),'[]'::jsonb));end if;
 if v_role in ('fleet_manager','administrator','security') then v_result:=v_result||jsonb_build_object('acknowledgements',coalesce((select jsonb_agg(to_jsonb(a)) from public.fm_incident_acknowledgements a where organization_id=v_org),'[]'::jsonb));end if;
 return v_result;
end;$$;
revoke all on function public.fm_v3_snapshot() from public,anon;
grant execute on function public.fm_v3_snapshot() to authenticated;

-- Existing availability consumers receive maintenance windows without personal data.
create or replace function public.get_vehicle_busy_windows(p_from timestamptz default now())
returns table(vehicle_id uuid,start_at timestamptz,end_at timestamptz,status public.reservation_status)
language sql stable security definer set search_path=public, pg_temp as $$
 select r.vehicle_id,r.start_at,r.end_at,r.status from public.reservations r where r.organization_id=public.current_organization_id() and r.status in ('pending_approval','confirmed') and r.end_at>p_from
 union all select o.vehicle_id,o.scheduled_start,o.scheduled_end,'confirmed'::public.reservation_status from public.fm_work_orders o where o.organization_id=public.current_organization_id() and o.status in ('scheduled','in_progress','partial') and o.scheduled_end>p_from
$$;
