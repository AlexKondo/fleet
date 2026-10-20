-- Never roll back access revocations after real access history exists.
do $$begin
 if exists(select 1 from public.fm_member_access) or exists(select 1 from public.fm_member_access_history) then
  raise exception 'ACCESS_HISTORY_EXISTS: preserve access revocations and their audit trail';end if;
end;$$;
do $$declare t record;begin
 for t in select tablename from pg_policies where schemaname='public' and policyname='fm_active_account' loop
  execute format('drop policy fm_active_account on public.%I',t.tablename);
 end loop;
end;$$;
drop trigger fm_preserve_profile on public.profiles;
drop trigger fm_preserve_auth_user on auth.users;
drop trigger fm_preserve_profile_truncate on public.profiles;
drop trigger fm_preserve_auth_truncate on auth.users;
drop function public.fm_preserve_member_identity();
create or replace function public.current_organization_id() returns uuid language sql stable security definer set search_path=public as $$select organization_id from public.profiles where id=auth.uid()$$;
create or replace function public.current_user_role() returns public.user_role language sql stable security definer set search_path=public as $$select role from public.profiles where id=auth.uid()$$;
create or replace function public.get_my_license()
returns table(drivers_license_number text,drivers_license_category text,drivers_license_expiration date,driver_authorized boolean)
language sql stable security definer set search_path=public as $$select p.drivers_license_number,p.drivers_license_category,p.drivers_license_expiration,p.driver_authorized from profiles p where p.id=auth.uid()$$;
create or replace function public.lock_and_require_multiple_administrators(p_organization_id uuid)
returns void language plpgsql security definer set search_path=public as $$begin
 perform 1 from organizations where id=p_organization_id for update;
 if (select count(*) from profiles where organization_id=p_organization_id and role='administrator')<=1 then
  raise exception 'Cannot change this administrator: the organization would be left with none';end if;
end;$$;
create or replace function public.update_member_role(p_organization_id uuid,p_user_id uuid,p_new_role public.user_role)
returns void language plpgsql security definer set search_path=public as $$declare v_target public.profiles%rowtype;begin
 perform 1 from organizations where id=p_organization_id for update;
 select * into v_target from profiles where id=p_user_id and organization_id=p_organization_id for update;
 if not found then raise exception 'User not found';end if;
 if v_target.role='administrator' and p_new_role is distinct from 'administrator' then perform lock_and_require_multiple_administrators(p_organization_id);end if;
 update profiles set role=p_new_role where id=p_user_id;
end;$$;
drop function public.fm_member_access_command(uuid,boolean,integer,text,uuid),public.fm_member_access_snapshot(),public.fm_account_enabled();
drop table public.fm_member_access_history,public.fm_member_access;
