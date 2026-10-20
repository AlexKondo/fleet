-- Governance changes and privacy requests are versioned and audited. No request
-- automatically erases operational history or evidence subject to retention.
create table public.fm_ai_policy (
 organization_id uuid primary key references public.organizations(id),assistant_enabled boolean not null default true,
 version integer not null,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.fm_ai_policy_versions (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 version integer not null,assistant_enabled boolean not null,reason text not null,actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),unique(organization_id,version)
);
create table public.fm_privacy_requests (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 subject_id uuid not null references public.profiles(id),kind text not null check(kind in ('access','correction','export','deletion')),
 summary text not null check(length(summary) between 3 and 3000),status text not null default 'submitted' check(status in ('submitted','in_review','completed','rejected')),
 response text,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.fm_ai_policy enable row level security;
alter table public.fm_ai_policy_versions enable row level security;
alter table public.fm_privacy_requests enable row level security;
revoke all on public.fm_ai_policy,public.fm_ai_policy_versions,public.fm_privacy_requests from public,anon,authenticated;
grant select on public.fm_privacy_requests to authenticated;
create policy fm_privacy_select on public.fm_privacy_requests for select to authenticated using(organization_id=public.current_organization_id() and (subject_id=auth.uid() or exists(select 1 from public.profiles where id=auth.uid() and role='administrator')));

create function public.fm_ai_policy_read() returns jsonb language sql stable security definer set search_path=public, pg_temp as $$
 select case when auth.uid() is null or public.current_organization_id() is null then null else
 coalesce((select jsonb_build_object('enabled',assistant_enabled,'version',version,'confirmation_required',true) from public.fm_ai_policy where organization_id=public.current_organization_id()),jsonb_build_object('enabled',true,'version',0,'confirmation_required',true)) end
$$;
create function public.fm_admin_command(p_command text,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=public.current_organization_id();v_actor uuid:=auth.uid();v_id uuid;v_version integer;v_changed uuid;v_receipt public.fm_command_receipts%rowtype;v_request public.fm_privacy_requests%rowtype;v_result jsonb;
begin
 if not exists(select 1 from public.profiles where id=v_actor and organization_id=v_org and role='administrator') then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
 insert into public.fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,v_actor,p_command,p_payload) on conflict do nothing returning request_id into v_changed;
 if v_changed is null then select * into v_receipt from public.fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>p_command or v_receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;end if;
 if p_command='ai.policy' then
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';end if;
  perform 1 from public.organizations where id=v_org for no key update;
  select version into v_version from public.fm_ai_policy where organization_id=v_org;
  if coalesce(v_version,0) is distinct from (p_payload->>'version')::integer then raise exception 'CONCURRENT_UPDATE';end if;
  v_version:=coalesce(v_version,0)+1;
  insert into public.fm_ai_policy(organization_id,assistant_enabled,version,updated_by) values(v_org,(p_payload->>'enabled')::boolean,v_version,v_actor)
  on conflict(organization_id) do update set assistant_enabled=excluded.assistant_enabled,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
  insert into public.fm_ai_policy_versions(organization_id,version,assistant_enabled,reason,actor_id) values(v_org,v_version,(p_payload->>'enabled')::boolean,left(p_payload->>'reason',1000),v_actor) returning id into v_id;
 elsif p_command='privacy.respond' then
  select * into v_request from public.fm_privacy_requests where id=(p_payload->>'id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if v_request.version is distinct from (p_payload->>'version')::integer then raise exception 'CONCURRENT_UPDATE';end if;
  if v_request.status in ('completed','rejected') or p_payload->>'status' not in ('in_review','completed','rejected') then raise exception 'INVALID_STATE_TRANSITION';end if;
  if length(trim(coalesce(p_payload->>'response','')))<3 then raise exception 'INVALID_INPUT';end if;
  update public.fm_privacy_requests set status=p_payload->>'status',response=left(p_payload->>'response',5000),version=version+1,updated_at=now() where id=v_request.id;
  v_id:=v_request.id;
 else raise exception 'UNKNOWN_COMMAND';end if;
 v_result:=jsonb_build_object('id',v_id,'ok',true);
 perform public.log_audit_event(v_org,v_actor,p_command,'governance',v_id,null,jsonb_build_object('version',v_version,'status',p_payload->>'status'));
 update public.fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$$;

create function public.fm_privacy_submit(p_kind text,p_summary text,p_request_id uuid) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=public.current_organization_id();v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_org is null or v_actor is null then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null then raise exception 'INVALID_INPUT';end if;
 -- Stable request id also makes retried form submissions idempotent.
 select id into v_id from public.fm_privacy_requests where id=p_request_id and subject_id=v_actor and organization_id=v_org;
 if v_id is not null then
  if not exists(select 1 from public.fm_privacy_requests where id=v_id and kind=p_kind and summary=left(trim(p_summary),3000)) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_id;end if;
 insert into public.fm_privacy_requests(id,organization_id,subject_id,kind,summary) values(p_request_id,v_org,v_actor,p_kind,left(trim(p_summary),3000)) returning id into v_id;
 perform public.log_audit_event(v_org,v_actor,'privacy.submitted','privacy_request',v_id,null,jsonb_build_object('kind',p_kind));return v_id;
end;$$;

create function public.fm_admin_snapshot() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=public.current_organization_id();
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and organization_id=v_org and role='administrator') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('policy',public.fm_ai_policy_read(),
 'policy_versions',coalesce((select jsonb_agg(to_jsonb(v) order by version desc) from public.fm_ai_policy_versions v where organization_id=v_org),'[]'::jsonb),
 'privacy_requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from public.fm_privacy_requests r where organization_id=v_org),'[]'::jsonb));
end;$$;
revoke all on function public.fm_ai_policy_read(),public.fm_admin_snapshot(),public.fm_admin_command(text,jsonb,uuid),public.fm_privacy_submit(text,text,uuid) from public,anon;
grant execute on function public.fm_ai_policy_read(),public.fm_admin_snapshot(),public.fm_admin_command(text,jsonb,uuid),public.fm_privacy_submit(text,text,uuid) to authenticated;

create function public.fm_my_privacy_requests() returns jsonb language sql stable security definer set search_path=public, pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'summary',summary,'status',status,'response',response,'created_at',created_at) order by created_at desc),'[]'::jsonb)
 from public.fm_privacy_requests where organization_id=public.current_organization_id() and subject_id=auth.uid()
$$;
revoke all on function public.fm_my_privacy_requests() from public,anon;
grant execute on function public.fm_my_privacy_requests() to authenticated;
