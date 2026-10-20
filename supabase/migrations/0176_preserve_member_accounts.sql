-- Account access is revoked without deleting identities or operational history.
-- Absence of an access row preserves the existing member's active state.
create table public.fm_member_access (
 user_id uuid primary key references public.profiles(id),
 organization_id uuid not null references public.organizations(id),
 enabled boolean not null,version integer not null check(version>0),
 reason text not null check(length(trim(reason)) between 3 and 1000),
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.fm_member_access_history (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 organization_id uuid not null references public.organizations(id),enabled boolean not null,version integer not null,
 reason text not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(user_id,version)
);
alter table public.fm_member_access enable row level security;
alter table public.fm_member_access_history enable row level security;
revoke all on public.fm_member_access,public.fm_member_access_history from public,anon,authenticated;

create function public.fm_account_enabled() returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from public.profiles p left join public.fm_member_access a on a.user_id=p.id
 where p.id=auth.uid() and coalesce(a.enabled,true))
$$;
-- These helpers are the common RLS/command tenant boundary: a still-valid JWT
-- cannot recover tenant access after deactivation. Auth identity remains intact.
create or replace function public.current_organization_id() returns uuid language sql stable security definer set search_path=public, pg_temp as $$
 select p.organization_id from public.profiles p left join public.fm_member_access a on a.user_id=p.id
 where p.id=auth.uid() and coalesce(a.enabled,true)
$$;
create or replace function public.current_user_role() returns public.user_role language sql stable security definer set search_path=public, pg_temp as $$
 select p.role from public.profiles p left join public.fm_member_access a on a.user_id=p.id
 where p.id=auth.uid() and coalesce(a.enabled,true)
$$;
create or replace function public.get_my_license()
returns table(drivers_license_number text,drivers_license_category text,drivers_license_expiration date,driver_authorized boolean)
language sql stable security definer set search_path=public, pg_temp as $$
 select p.drivers_license_number,p.drivers_license_category,p.drivers_license_expiration,p.driver_authorized
 from public.profiles p where p.id=auth.uid() and public.fm_account_enabled()
$$;
revoke all on function public.get_my_license() from public,anon;
grant execute on function public.get_my_license() to authenticated;

create function public.fm_member_access_snapshot() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=public.current_organization_id();
begin
 if not exists(select 1 from profiles where id=auth.uid() and organization_id=v_org and role='administrator') then raise exception 'NOT_AUTHORIZED';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'enabled',coalesce(a.enabled,true),'version',coalesce(a.version,0)))
 from profiles p left join fm_member_access a on a.user_id=p.id where p.organization_id=v_org),'[]'::jsonb);
end;$$;

create function public.fm_member_access_command(p_user_id uuid,p_enabled boolean,p_version integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=public.current_organization_id();v_actor uuid:=auth.uid();v_target public.profiles%rowtype;
 v_version integer;v_receipt public.fm_command_receipts%rowtype;v_changed uuid;v_result jsonb;
 v_payload jsonb:=jsonb_build_object('user_id',p_user_id,'enabled',p_enabled,'version',p_version,'reason',p_reason);
begin
 if not exists(select 1 from profiles where id=v_actor and organization_id=v_org and role='administrator') then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_enabled is null or p_version is null or p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'INVALID_INPUT';end if;
 -- Same organization mutex as role changes: role/access changes cannot jointly
 -- demote/deactivate the final ACTIVE administrator in separate transactions.
 perform 1 from organizations where id=v_org for no key update;
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload)
 values(v_org,p_request_id,v_actor,'member.access',v_payload) on conflict do nothing returning request_id into v_changed;
 if v_changed is null then
  select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'member.access' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;
 select * into v_target from profiles where id=p_user_id and organization_id=v_org for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_user_id=v_actor and not p_enabled then raise exception 'CANNOT_DEACTIVATE_SELF';end if;
 select version into v_version from fm_member_access where user_id=p_user_id;
 if coalesce(v_version,0)<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
 if not p_enabled and v_target.role='administrator' and not exists(
  select 1 from profiles p left join fm_member_access a on a.user_id=p.id
  where p.organization_id=v_org and p.role='administrator' and p.id<>p_user_id and coalesce(a.enabled,true)
 ) then raise exception 'LAST_ACTIVE_ADMINISTRATOR';end if;
 v_version:=coalesce(v_version,0)+1;
 insert into fm_member_access(user_id,organization_id,enabled,version,reason,updated_by)
 values(p_user_id,v_org,p_enabled,v_version,trim(p_reason),v_actor)
 on conflict(user_id) do update set enabled=excluded.enabled,version=excluded.version,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
 insert into fm_member_access_history(user_id,organization_id,enabled,version,reason,actor_id)
 values(p_user_id,v_org,p_enabled,v_version,trim(p_reason),v_actor);
 perform log_audit_event(v_org,v_actor,case when p_enabled then 'user_reactivated' else 'user_deactivated' end,'profile',p_user_id,null,jsonb_build_object('enabled',p_enabled,'version',v_version));
 v_result:=jsonb_build_object('id',p_user_id,'enabled',p_enabled,'version',v_version);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$$;

-- Preserve the existing service-only API, now counting active administrators and
-- serializing against member access changes. No signature or grant is widened.
create or replace function public.lock_and_require_multiple_administrators(p_organization_id uuid)
returns void language plpgsql security definer set search_path=public, pg_temp as $$
begin
 perform 1 from organizations where id=p_organization_id for no key update;
 if (select count(*) from profiles p left join fm_member_access a on a.user_id=p.id
 where p.organization_id=p_organization_id and p.role='administrator' and coalesce(a.enabled,true))<=1 then
  raise exception 'Cannot change this administrator: the organization would be left with none';end if;
end;$$;
create or replace function public.update_member_role(p_organization_id uuid,p_user_id uuid,p_new_role public.user_role)
returns void language plpgsql security definer set search_path=public, pg_temp as $$
declare v_target public.profiles%rowtype;
begin
 perform 1 from organizations where id=p_organization_id for no key update;
 select * into v_target from profiles where id=p_user_id and organization_id=p_organization_id for update;
 if not found then raise exception 'User not found';end if;
 if v_target.role='administrator' and p_new_role is distinct from 'administrator'
 and coalesce((select enabled from fm_member_access where user_id=p_user_id),true) then
  perform lock_and_require_multiple_administrators(p_organization_id);end if;
 update profiles set role=p_new_role where id=p_user_id;
end;$$;
revoke all on function public.lock_and_require_multiple_administrators(uuid),public.update_member_role(uuid,uuid,public.user_role) from public,anon,authenticated;
grant execute on function public.lock_and_require_multiple_administrators(uuid),public.update_member_role(uuid,uuid,public.user_role) to service_role;

create function public.fm_preserve_member_identity() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'PRESERVE_USER_HISTORY: deactivate accounts instead of deleting identities';end;$$;
create trigger fm_preserve_profile before delete on public.profiles for each row execute function public.fm_preserve_member_identity();
create trigger fm_preserve_auth_user before delete on auth.users for each row execute function public.fm_preserve_member_identity();
create trigger fm_preserve_profile_truncate before truncate on public.profiles for each statement execute function public.fm_preserve_member_identity();
create trigger fm_preserve_auth_truncate before truncate on auth.users for each statement execute function public.fm_preserve_member_identity();
-- Own-row policies (such as chat) must not keep working for an inactive JWT.
do $$ declare t record;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity loop
  execute format('create policy fm_active_account on public.%I as restrictive for all to authenticated using ((select public.fm_account_enabled())) with check ((select public.fm_account_enabled()))',t.relname);
 end loop;
end;$$;
revoke all on function public.fm_preserve_member_identity() from public,anon,authenticated;
revoke all on function public.fm_account_enabled(),public.fm_member_access_snapshot(),public.fm_member_access_command(uuid,boolean,integer,text,uuid) from public,anon;
grant execute on function public.fm_account_enabled(),public.fm_member_access_snapshot(),public.fm_member_access_command(uuid,boolean,integer,text,uuid) to authenticated;

-- Central driving prerequisite, internal only. Does not write license/antifraud data.
create function public.fm_assert_can_drive(p_user uuid,p_org uuid) returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.profiles%rowtype;
begin
 select * into p from profiles where id=p_user and organization_id=p_org;
 if not found or not p.driver_authorized or exists(select 1 from fm_member_access where user_id=p_user and not enabled) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
 if nullif(trim(p.drivers_license_number),'') is null or p.drivers_license_expiration is null or p.drivers_license_expiration<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'LICENSE_EXPIRED';end if;
end;$$;
revoke all on function public.fm_assert_can_drive(uuid,uuid) from public,anon,authenticated;
