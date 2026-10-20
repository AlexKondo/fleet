-- Independent incident lifecycle; inspection evidence remains immutable and separate.
create table public.fm_incidents (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 vehicle_id uuid not null references public.vehicles(id),inspection_id uuid references public.inspections(id),
 reservation_id uuid references public.reservations(id),work_order_id uuid references public.fm_work_orders(id),
 kind text not null check(kind in ('damage','equipment','cleaning','document','mechanical','other')),
 severity text not null check(severity in ('low','medium','high','critical')),
 title text not null check(length(title) between 3 and 160),description text not null check(length(description) between 3 and 3000),
 status text not null default 'open' check(status in ('open','analyzing','referred','resolved','closed')),
 assignee_id uuid references public.profiles(id),resolution text,version integer not null default 1,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index fm_incident_inspection_case on public.fm_incidents(inspection_id,kind) where inspection_id is not null;
create index fm_incident_scope on public.fm_incidents(organization_id,vehicle_id,status,created_at desc);
create table public.fm_incident_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 incident_id uuid not null references public.fm_incidents(id),actor_id uuid not null references public.profiles(id),
 command text not null,previous_status text,status text not null,notes text not null,
 assignee_id uuid references public.profiles(id),work_order_id uuid references public.fm_work_orders(id),created_at timestamptz not null default now()
);
alter table public.fm_incidents enable row level security;
alter table public.fm_incident_events enable row level security;
revoke all on public.fm_incidents,public.fm_incident_events from public,anon,authenticated;
grant select on public.fm_incidents,public.fm_incident_events to authenticated;
create policy fm_incidents_read on public.fm_incidents for select to authenticated using(organization_id=current_organization_id() and fm_can_manage_vehicle(vehicle_id));
create policy fm_incident_events_read on public.fm_incident_events for select to authenticated using(organization_id=current_organization_id() and exists(select 1 from fm_incidents i where i.id=incident_id and fm_can_manage_vehicle(i.vehicle_id)));
create trigger fm_incident_events_preserve before update or delete on public.fm_incident_events for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_incident_events_no_truncate before truncate on public.fm_incident_events for each statement execute function public.fm_preserve_inspection_evidence();

create function public.fm_incident_command(p_command text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_id uuid;v_vehicle uuid;v_assignee uuid;v_order uuid;v_inspection uuid;v_reservation uuid;v_notes text;v_next text;v_old text;v_case fm_incidents%rowtype;v_created uuid;v_receipt fm_command_receipts%rowtype;v_result jsonb;
begin
 if v_org is null or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 if p_command is null or p_command not in ('create','analyze','refer','resolve','close','reopen') or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_request_id is null then raise exception 'INVALID_INPUT';end if;
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 v_notes:=trim(coalesce(p_payload->>'notes',''));
 if length(v_notes) not between 3 and 3000 then raise exception 'INVALID_INPUT';end if;
 if p_command='create' then v_vehicle:=(p_payload->>'vehicle_id')::uuid;
 else
  v_id:=(p_payload->>'id')::uuid;
  select * into v_case from fm_incidents where id=v_id and organization_id=v_org for update;
  if not found then raise exception 'NOT_AUTHORIZED';end if;v_vehicle:=v_case.vehicle_id;
 end if;
 if not fm_can_manage_vehicle(v_vehicle) then raise exception 'NOT_AUTHORIZED';end if;
 -- Receipt is checked before version/state validation so an exact retry returns the original result.
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,v_actor,'incident.'||p_command,p_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'incident.'||p_command or v_receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;
 if p_command='create' then
  if not exists(select 1 from vehicles where id=v_vehicle and organization_id=v_org and archived_at is null) then raise exception 'INVALID_REFERENCE';end if;
  if length(trim(coalesce(p_payload->>'title',''))) not between 3 and 160 or coalesce(p_payload->>'kind','') not in ('damage','equipment','cleaning','document','mechanical','other') or coalesce(p_payload->>'severity','') not in ('low','medium','high','critical') then raise exception 'INVALID_INPUT';end if;
  v_inspection:=nullif(p_payload->>'inspection_id','')::uuid;v_reservation:=nullif(p_payload->>'reservation_id','')::uuid;
  if v_inspection is not null then
   select reservation_id into v_reservation from inspections where id=v_inspection and vehicle_id=v_vehicle and organization_id=v_org;
   if not found then raise exception 'INVALID_REFERENCE';end if;
   if nullif(p_payload->>'reservation_id','') is not null and (p_payload->>'reservation_id')::uuid<>v_reservation then raise exception 'INVALID_REFERENCE';end if;
  end if;
  if v_reservation is not null and not exists(select 1 from reservations where id=v_reservation and vehicle_id=v_vehicle and organization_id=v_org) then raise exception 'INVALID_REFERENCE';end if;
  insert into fm_incidents(organization_id,vehicle_id,inspection_id,reservation_id,kind,severity,title,description,created_by)
   values(v_org,v_vehicle,v_inspection,v_reservation,p_payload->>'kind',p_payload->>'severity',trim(p_payload->>'title'),v_notes,v_actor) returning * into v_case;
  v_id:=v_case.id;v_next:='open';v_old:=null;
 else
  if coalesce((p_payload->>'version')::integer,0)<>v_case.version then raise exception 'CONCURRENT_UPDATE';end if;
  v_old:=v_case.status;v_assignee:=v_case.assignee_id;v_order:=v_case.work_order_id;
  if p_command='analyze' and v_old in ('open','referred') then v_next:='analyzing';
  elsif p_command='refer' and v_old in ('open','analyzing','referred') then
   v_next:='referred';v_assignee:=nullif(p_payload->>'assignee_id','')::uuid;v_order:=nullif(p_payload->>'work_order_id','')::uuid;
   if v_assignee is null and v_order is null then raise exception 'INVALID_INPUT';end if;
   if v_assignee is not null and not exists(select 1 from profiles p where p.id=v_assignee and p.organization_id=v_org and p.role in ('fleet_manager','administrator','maintenance_operator') and not exists(select 1 from fm_member_access a where a.user_id=p.id and not a.enabled) and (p.role='maintenance_operator' or exists(select 1 from fm_manager_scopes s where s.user_id=p.id and s.organization_id=v_org and (s.mode='all_units' or exists(select 1 from fm_vehicle_units m join fm_manager_scope_units g on g.unit_id=m.unit_id and g.organization_id=m.organization_id where m.vehicle_id=v_vehicle and g.user_id=p.id and g.enabled))) or p.role='administrator')) then raise exception 'INVALID_REFERENCE';end if;
   if v_order is not null and not exists(select 1 from fm_work_orders where id=v_order and organization_id=v_org and vehicle_id=v_vehicle and status<>'cancelled') then raise exception 'INVALID_REFERENCE';end if;
  elsif p_command='resolve' and v_old in ('analyzing','referred') then
   if v_order is not null and not exists(select 1 from fm_work_orders where id=v_order and organization_id=v_org and status='completed') then raise exception 'LINKED_WORK_ORDER_PENDING';end if;
   v_next:='resolved';
  elsif p_command='close' and v_old='resolved' then v_next:='closed';
  elsif p_command='reopen' and v_old in ('resolved','closed') then v_next:='analyzing';
  else raise exception 'INVALID_STATE_TRANSITION';end if;
  update fm_incidents set status=v_next,assignee_id=v_assignee,work_order_id=v_order,resolution=case when p_command='resolve' then v_notes when p_command='reopen' then null else resolution end,version=version+1,updated_at=now() where id=v_id returning * into v_case;
 end if;
 insert into fm_incident_events(organization_id,incident_id,actor_id,command,previous_status,status,notes,assignee_id,work_order_id) values(v_org,v_id,v_actor,p_command,v_old,v_next,v_notes,v_case.assignee_id,v_case.work_order_id);
 v_result:=jsonb_build_object('id',v_id,'status',v_next,'version',v_case.version);
 perform log_audit_event(v_org,v_actor,'incident.'||p_command,'incident',v_id,jsonb_build_object('status',v_old),v_result);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$$;
create function public.fm_incident_workspace() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();begin
 if v_org is null or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('incidents',coalesce((select jsonb_agg(to_jsonb(i) order by i.updated_at desc,i.id) from fm_incidents i where i.organization_id=v_org and fm_can_manage_vehicle(i.vehicle_id)),'[]'::jsonb),
 'assignees',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name)) from fm_managed_people p where p.role in ('fleet_manager','administrator','maintenance_operator') and not exists(select 1 from fm_member_access a where a.user_id=p.id and not a.enabled)),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from fm_incident_events e join fm_incidents i on i.id=e.incident_id where i.organization_id=v_org and fm_can_manage_vehicle(i.vehicle_id)),'[]'::jsonb));
end;$$;
revoke all on function public.fm_incident_command(text,jsonb,uuid),public.fm_incident_workspace() from public,anon;
grant execute on function public.fm_incident_command(text,jsonb,uuid),public.fm_incident_workspace() to authenticated;
