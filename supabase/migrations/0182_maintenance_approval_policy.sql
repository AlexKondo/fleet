-- Configurable local approval, independent identity segregation and append-only evidence.
create table public.fm_maintenance_approval_policies(
 unit_id uuid primary key,organization_id uuid not null,mode text not null check(mode in ('scoped_managers','designated')),
 approver_ids uuid[] not null default '{}',superior_ids uuid[] not null default '{}',version integer not null check(version>0),
 reason text not null,updated_by uuid not null references profiles(id),updated_at timestamptz not null default now(),
 foreign key(organization_id,unit_id) references fm_units(organization_id,id)
);
create table public.fm_budget_authors(
 work_order_id uuid not null references fm_work_orders(id),user_id uuid not null references profiles(id),
 author_role user_role not null,created_at timestamptz not null default now(),primary key(work_order_id,user_id,author_role)
);
insert into public.fm_budget_authors(work_order_id,user_id,author_role) select o.id,o.created_by,p.role from fm_work_orders o join profiles p on p.id=o.created_by;
-- Recover evidenced budget submissions; never invent historical approvals.
insert into public.fm_budget_authors(work_order_id,user_id,author_role)
 select distinct on (o.id,a.actor_id) o.id,a.actor_id,a.actor_role::user_role
 from audit_log a join fm_work_orders o on o.id=a.entity_id and o.organization_id=a.organization_id
 where a.entity_type='work_order' and a.action='work_order.budget' and a.actor_id is not null
 and a.actor_role in ('employee','fleet_manager','administrator','maintenance_operator','security')
 order by o.id,a.actor_id,a.created_at
 on conflict do nothing;
alter table public.fm_work_orders add column budget_pending boolean not null default true;
update public.fm_work_orders set budget_pending=false where approved_total is not null;
create table public.fm_budget_approvals(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id),
 work_order_id uuid not null references fm_work_orders(id),actor_id uuid not null references profiles(id),
 amount numeric(14,2) not null,policy_snapshot jsonb not null,created_at timestamptz not null default now()
);
alter table public.fm_maintenance_approval_policies enable row level security;
alter table public.fm_budget_authors enable row level security;
alter table public.fm_budget_approvals enable row level security;
revoke all on public.fm_maintenance_approval_policies,public.fm_budget_authors,public.fm_budget_approvals from public,anon,authenticated;
grant select on public.fm_budget_approvals to authenticated;
create policy fm_approval_read on public.fm_budget_approvals for select to authenticated using(organization_id=current_organization_id() and exists(select 1 from fm_work_orders o where o.id=work_order_id and (fm_can_manage_vehicle(o.vehicle_id) or current_user_role()='maintenance_operator')));
create trigger fm_budget_approval_immutable before update or delete on public.fm_budget_approvals for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_budget_approval_no_truncate before truncate on public.fm_budget_approvals for each statement execute function public.fm_preserve_inspection_evidence();
create trigger fm_budget_author_immutable before update or delete on public.fm_budget_authors for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_budget_author_no_truncate before truncate on public.fm_budget_authors for each statement execute function public.fm_preserve_inspection_evidence();

create function public.fm_maintenance_policy_save(p_unit_id uuid,p_mode text,p_approver_ids uuid[],p_superior_ids uuid[],p_version integer,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_version integer;v_payload jsonb;v_result jsonb;v_created uuid;v_receipt fm_command_receipts%rowtype;v_a uuid[];v_s uuid[];
begin
 if v_org is null or current_user_role() is distinct from 'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 if p_mode is null or p_mode not in ('scoped_managers','designated') or p_approver_ids is null or p_superior_ids is null or cardinality(p_approver_ids)>1000 or cardinality(p_superior_ids)>1000 or array_position(p_approver_ids,null) is not null or array_position(p_superior_ids,null) is not null or p_version is null or p_version<0 or p_request_id is null or p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'INVALID_INPUT';end if;
 v_a:=array(select distinct x from unnest(p_approver_ids) x order by x);v_s:=array(select distinct x from unnest(p_superior_ids) x order by x);
 if (p_mode='designated' and cardinality(v_a)=0) or (p_mode='scoped_managers' and cardinality(v_a)>0) then raise exception 'INVALID_INPUT';end if;
 perform 1 from organizations where id=v_org for no key update;
 perform 1 from fm_units where id=p_unit_id and organization_id=v_org for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if current_organization_id() is distinct from v_org or current_user_role() is distinct from 'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 if exists(select 1 from unnest(v_a) u where not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=u and p.organization_id=v_org and p.role in ('fleet_manager','administrator') and coalesce(a.enabled,true) and (p.role='administrator' or exists(select 1 from fm_manager_scopes s where s.user_id=p.id and s.organization_id=v_org and (s.mode='all_units' or exists(select 1 from fm_manager_scope_units m where m.user_id=p.id and m.unit_id=p_unit_id and m.organization_id=v_org and m.enabled)))))) then raise exception 'APPROVER_NOT_AUTHORIZED';end if;
 if exists(select 1 from unnest(v_s) u where not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=u and p.organization_id=v_org and coalesce(a.enabled,true))) then raise exception 'APPROVER_NOT_AUTHORIZED';end if;
 v_payload:=jsonb_build_object('unit_id',p_unit_id,'mode',p_mode,'approver_ids',v_a,'superior_ids',v_s,'version',p_version,'reason',trim(p_reason));
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,v_actor,'maintenance.policy',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
 select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
 if v_receipt.actor_id<>v_actor or v_receipt.command<>'maintenance.policy' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;
 end if;
 select version into v_version from fm_maintenance_approval_policies where unit_id=p_unit_id;
 if coalesce(v_version,0)<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
 insert into fm_maintenance_approval_policies(unit_id,organization_id,mode,approver_ids,superior_ids,version,reason,updated_by)
 values(p_unit_id,v_org,p_mode,v_a,v_s,p_version+1,trim(p_reason),v_actor)
 on conflict(unit_id) do update set mode=excluded.mode,approver_ids=excluded.approver_ids,superior_ids=excluded.superior_ids,version=excluded.version,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
 v_result:=v_payload||jsonb_build_object('version',p_version+1);
 perform log_audit_event(v_org,v_actor,'maintenance.policy','unit',p_unit_id,to_jsonb(v_version),v_result);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$$;
create function public.fm_maintenance_policy_snapshot() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
begin
 if current_organization_id() is null or current_user_role() is distinct from 'administrator' then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('policies',coalesce((select jsonb_agg(to_jsonb(p)) from fm_maintenance_approval_policies p where organization_id=current_organization_id()),'[]'::jsonb));
end;$$;
revoke all on function public.fm_maintenance_policy_save(uuid,text,uuid[],uuid[],integer,text,uuid),public.fm_maintenance_policy_snapshot() from public,anon;
grant execute on function public.fm_maintenance_policy_save(uuid,text,uuid[],uuid[],integer,text,uuid),public.fm_maintenance_policy_snapshot() to authenticated;

create function public.fm_budget_approval_guard() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare v_actor uuid:=auth.uid();v_unit uuid;v_policy fm_maintenance_approval_policies%rowtype;v_manager_author boolean;v_snapshot jsonb;
begin
 if new.quote_total is distinct from old.quote_total then
  if v_actor is null then raise exception 'NOT_AUTHORIZED';end if;
  insert into fm_budget_authors(work_order_id,user_id,author_role) values(new.id,v_actor,current_user_role()) on conflict do nothing;
  new.budget_pending:=true;
 end if;
 if (new.approved_total is distinct from old.approved_total or new.approved_by is distinct from old.approved_by or (old.budget_pending and not new.budget_pending)) then
  if new.approved_by is distinct from v_actor or new.approved_total is distinct from new.quote_total then raise exception 'INVALID_INPUT';end if;
  select unit_id into v_unit from fm_vehicle_units where vehicle_id=new.vehicle_id and organization_id=new.organization_id;
  -- Lock the unit consistently with policy configuration. No change of policy can
  -- interleave with this approval for the same unit.
  perform 1 from fm_units where id=v_unit and organization_id=new.organization_id for share;
  select * into v_policy from fm_maintenance_approval_policies where unit_id=v_unit and organization_id=new.organization_id;
  if v_actor is null or current_organization_id() is distinct from new.organization_id or not ((current_user_role() in ('fleet_manager','administrator') and fm_can_manage_vehicle(new.vehicle_id)) or v_actor=any(coalesce(v_policy.superior_ids,'{}'::uuid[]))) then raise exception 'NOT_AUTHORIZED';end if;
  if exists(select 1 from fm_budget_authors where work_order_id=new.id and user_id=v_actor) then raise exception 'SELF_APPROVAL_DENIED';end if;
  select exists(select 1 from fm_budget_authors a where a.work_order_id=new.id and a.author_role in ('fleet_manager','administrator')) into v_manager_author;
  if v_manager_author and not(v_actor=any(coalesce(v_policy.superior_ids,'{}'::uuid[]))) then raise exception 'SUPERIOR_APPROVAL_REQUIRED';end if;
  if not v_manager_author and v_policy.mode='designated' and not(v_actor=any(v_policy.approver_ids) or v_actor=any(v_policy.superior_ids)) then raise exception 'APPROVER_NOT_AUTHORIZED';end if;
  new.budget_pending:=false;
  v_snapshot:=jsonb_build_object('unit_id',v_unit,'policy_version',coalesce(v_policy.version,0),'mode',coalesce(v_policy.mode,'scoped_managers'),'approver_ids',coalesce(v_policy.approver_ids,'{}'::uuid[]),'superior_ids',coalesce(v_policy.superior_ids,'{}'::uuid[]),'superior_required',v_manager_author,'author_ids',array(select distinct user_id from fm_budget_authors where work_order_id=new.id order by user_id));
  insert into fm_budget_approvals(organization_id,work_order_id,actor_id,amount,policy_snapshot) values(new.organization_id,new.id,v_actor,new.approved_total,v_snapshot);
 end if;
 if new.status='completed' and new.budget_pending then raise exception 'BUDGET_APPROVAL_PENDING';end if;
 return new;
end;$$;
create trigger fm_budget_approval_guard before update on public.fm_work_orders for each row execute function public.fm_budget_approval_guard();
create function public.fm_budget_register_author() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 insert into fm_budget_authors(work_order_id,user_id,author_role) values(new.id,new.created_by,(select role from profiles where id=new.created_by)) on conflict do nothing;return new;
end;$$;
create trigger fm_budget_register_author after insert on public.fm_work_orders for each row execute function public.fm_budget_register_author();
revoke all on function public.fm_budget_approval_guard(),public.fm_budget_register_author() from public,anon,authenticated;

create or replace function public.fm_scope_command_guard(p_command text,p_payload jsonb) returns void language plpgsql security definer set search_path=public, pg_temp as $$
declare v_vehicle uuid;
begin
 if not coalesce(fm_is_limited_manager(),false) then return;end if;
 if p_command in ('work_order.create','energy.record','vehicle.identity') then v_vehicle:=(p_payload->>'vehicle_id')::uuid;
 elsif p_command in ('work_order.transition','work_order.line','work_order.void_line','work_order.budget','work_order.approve_budget') then select vehicle_id into v_vehicle from fm_work_orders where id=(p_payload->>'id')::uuid and organization_id=current_organization_id();
 elsif p_command='energy.void' then select vehicle_id into v_vehicle from fm_energy_events where id=(p_payload->>'id')::uuid and organization_id=current_organization_id();
 elsif p_command='gate.record' then select vehicle_id into v_vehicle from reservations where id=(p_payload->>'reservation_id')::uuid and organization_id=current_organization_id();
 elsif p_command='incident.ack' then select vehicle_id into v_vehicle from inspections where id=(p_payload->>'inspection_id')::uuid and organization_id=current_organization_id();
 else raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 if not fm_can_manage_vehicle(v_vehicle) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
end;$$;

CREATE OR REPLACE FUNCTION public.fm_v3_command(p_command text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
 v_org uuid:=public.current_organization_id();v_actor uuid:=auth.uid();v_role public.user_role;
 v_id uuid;v_vehicle public.vehicles%rowtype;v_order public.fm_work_orders%rowtype;v_res public.reservations%rowtype;
 v_receipt public.fm_command_receipts%rowtype;v_target text;v_start timestamptz;v_end timestamptz;v_task uuid;v_result jsonb;v_before jsonb;
 v_energy public.energy_type;v_kind text;v_changed uuid;v_line public.fm_work_order_lines%rowtype;v_cost numeric;
begin
 perform public.fm_scope_command_guard(p_command,p_payload);
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

 elsif p_command in ('work_order.transition','work_order.line','work_order.void_line','work_order.budget','work_order.approve_budget') then
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
   insert into fm_budget_authors(work_order_id,user_id,author_role) values(v_id,v_actor,v_role) on conflict do nothing;
   update public.fm_work_orders set quote_total=(p_payload->>'quote_total')::numeric,budget_pending=true where id=v_id;
   v_before:=v_before||jsonb_build_object('previous_quote',v_order.quote_total,'previous_approved',v_order.approved_total,'reason',left(p_payload->>'reason',500));
  elsif p_command='work_order.approve_budget' then
   if v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
   if not v_order.budget_pending or v_order.status in ('draft','budgeted','completed','cancelled') then raise exception 'INVALID_STATE_TRANSITION';end if;
   update public.fm_work_orders set approved_by=v_actor,approved_total=quote_total,budget_pending=false where id=v_id;
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
    update public.fm_work_orders set approved_by=v_actor,approved_total=quote_total,budget_pending=false where id=v_id;
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
end;$function$
;

create function public.fm_budget_line_author() returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if new.stage='planned' then
  insert into fm_budget_authors(work_order_id,user_id,author_role) values(new.work_order_id,auth.uid(),current_user_role()) on conflict do nothing;
  update fm_work_orders set budget_pending=true where id=new.work_order_id;
 end if;
 return new;
end;$$;
create trigger fm_budget_line_author after insert or update of voided_at on public.fm_work_order_lines for each row execute function public.fm_budget_line_author();
revoke all on function public.fm_budget_line_author() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.fm_v3_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare v_org uuid:=public.current_organization_id();v_role public.user_role;v_result jsonb:='{}';
begin
 select role into v_role from public.profiles where id=auth.uid() and organization_id=v_org;
 if v_role is null or v_role='employee' then raise exception 'NOT_AUTHORIZED';end if;
 if v_role in ('fleet_manager','administrator','maintenance_operator') then
  v_result:=v_result||jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.fm_work_orders o where organization_id=v_org and (v_role<>'fleet_manager' or public.fm_can_manage_vehicle(o.vehicle_id))),'[]'::jsonb),
  'lines',coalesce((select jsonb_agg(to_jsonb(l)) from public.fm_work_order_lines l where organization_id=v_org and (v_role<>'fleet_manager' or exists(select 1 from public.fm_work_orders w where w.id=l.work_order_id and public.fm_can_manage_vehicle(w.vehicle_id)))),'[]'::jsonb));
 end if;
 if v_role in ('fleet_manager','administrator') then v_result:=v_result||jsonb_build_object('energy',coalesce((select jsonb_agg(to_jsonb(e) order by event_at desc) from public.fm_energy_events e where organization_id=v_org and (v_role<>'fleet_manager' or public.fm_can_manage_vehicle(e.vehicle_id))),'[]'::jsonb));end if;
 if v_role in ('fleet_manager','administrator','security') then v_result:=v_result||jsonb_build_object('gate',coalesce((select jsonb_agg(to_jsonb(g) order by created_at desc) from public.fm_gate_events g where organization_id=v_org and (v_role<>'fleet_manager' or public.fm_can_manage_vehicle(g.vehicle_id))),'[]'::jsonb));end if;
 if v_role in ('fleet_manager','administrator','security') then v_result:=v_result||jsonb_build_object('acknowledgements',coalesce((select jsonb_agg(to_jsonb(a)) from public.fm_incident_acknowledgements a where organization_id=v_org and (v_role<>'fleet_manager' or exists(select 1 from public.inspections i where i.id=a.inspection_id and public.fm_can_manage_vehicle(i.vehicle_id)))),'[]'::jsonb));end if;
 if v_role in ('fleet_manager','administrator','maintenance_operator') then
 v_result:=v_result||jsonb_build_object('approvals',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_name',p.full_name) order by a.created_at desc,a.id desc) from fm_budget_approvals a join profiles p on p.id=a.actor_id join fm_work_orders o on o.id=a.work_order_id where a.organization_id=v_org and (v_role<>'fleet_manager' or fm_can_manage_vehicle(o.vehicle_id))),'[]'::jsonb));
 end if;
 return v_result;
end;$function$
;

-- A designated superior gets this budget-only capability, without any implicit
-- vehicle, inspection, user, gate or key-custody management permission.
create function public.fm_budget_approval_queue() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();
begin
 if v_org is null then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'version',o.version,'number',o.number,'description',o.description,'quote_total',o.quote_total,'approved_total',o.approved_total,'plate',v.plate,'unit',u.name,'status',o.status) order by o.created_at,o.id)
 from fm_work_orders o join vehicles v on v.id=o.vehicle_id join fm_vehicle_units m on m.vehicle_id=v.id and m.organization_id=v_org join fm_units u on u.id=m.unit_id
 left join fm_maintenance_approval_policies p on p.unit_id=u.id and p.organization_id=v_org
 where o.organization_id=v_org and o.budget_pending and o.status not in ('draft','completed','cancelled')
 and not exists(select 1 from fm_budget_authors a where a.work_order_id=o.id and a.user_id=v_actor)
 and (v_actor=any(coalesce(p.superior_ids,'{}'::uuid[])) or (
 fm_can_manage_vehicle(v.id) and (p.mode is null or p.mode='scoped_managers' or v_actor=any(p.approver_ids))
 and not exists(select 1 from fm_budget_authors a where a.work_order_id=o.id and a.author_role in ('fleet_manager','administrator'))))),'[]'::jsonb));
end;$$;
create function public.fm_budget_approve(p_order_id uuid,p_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_order fm_work_orders%rowtype;v_vehicle uuid;v_unit uuid;v_policy fm_maintenance_approval_policies%rowtype;v_payload jsonb;v_result jsonb;v_created uuid;v_receipt fm_command_receipts%rowtype;
begin
 if v_org is null then raise exception 'NOT_AUTHORIZED';end if;
 if p_version is null or p_version<1 or p_request_id is null then raise exception 'INVALID_INPUT';end if;
 select vehicle_id into v_vehicle from fm_work_orders where id=p_order_id and organization_id=v_org;
 if v_vehicle is null then raise exception 'NOT_AUTHORIZED';end if;
 perform 1 from vehicles where id=v_vehicle and organization_id=v_org for update;
 select * into v_order from fm_work_orders where id=p_order_id and organization_id=v_org for update;
 select unit_id into v_unit from fm_vehicle_units where vehicle_id=v_vehicle and organization_id=v_org;
 perform 1 from fm_units where id=v_unit and organization_id=v_org for share;
 select * into v_policy from fm_maintenance_approval_policies where unit_id=v_unit and organization_id=v_org;
 if not (fm_can_manage_vehicle(v_vehicle) or v_actor=any(coalesce(v_policy.superior_ids,'{}'::uuid[]))) then raise exception 'NOT_AUTHORIZED';end if;
 v_payload:=jsonb_build_object('id',p_order_id,'version',p_version);
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,v_actor,'work_order.approval',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'work_order.approval' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;
 end if;
 if v_order.version<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
 if not v_order.budget_pending or v_order.status in ('draft','completed','cancelled') then raise exception 'INVALID_STATE_TRANSITION';end if;
 -- The approval trigger independently checks live policy, identity and provenance.
 update fm_work_orders set approved_by=v_actor,approved_total=quote_total,budget_pending=false,status=case when status='budgeted' then 'approved' else status end,version=version+1 where id=p_order_id;
 v_result:=jsonb_build_object('id',p_order_id,'version',p_version+1);
 perform log_audit_event(v_org,v_actor,'work_order.approval','work_order',p_order_id,jsonb_build_object('approved_total',v_order.approved_total),v_result||jsonb_build_object('approved_total',v_order.quote_total));
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$$;
create function public.fm_has_budget_approval_assignment() returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select current_organization_id() is not null and exists(select 1 from fm_maintenance_approval_policies p where p.organization_id=current_organization_id() and auth.uid()=any(p.superior_ids))
$$;
revoke all on function public.fm_budget_approval_queue(),public.fm_budget_approve(uuid,integer,uuid),public.fm_has_budget_approval_assignment() from public,anon;
grant execute on function public.fm_budget_approval_queue(),public.fm_budget_approve(uuid,integer,uuid),public.fm_has_budget_approval_assignment() to authenticated;
