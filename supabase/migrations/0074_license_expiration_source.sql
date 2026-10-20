-- 0074: ADDITIVE. Records how a member's CNH expiration date got into the system: 'ai' (read from the CNH photo/PDF by the vision model and
-- confirmed by the driver) or 'manual' (typed by an administrator / fleet manager). NULL = not recorded (every row that existed before this
-- migration; we do not guess).
--  * New column on profiles. NOT granted to anon/authenticated (license data is column-protected since 0063): readable only through the
--    role-checked definer function below; written only through the service role (same as every other license column).
--  * list_member_license_sources(): NEW function (no existing function or signature is touched, so no overload risk); fleet_manager /
--    administrator of the caller's organization only.
alter table public.profiles
  add column if not exists drivers_license_expiration_source text
    check (drivers_license_expiration_source in ('ai', 'manual'));

create function public.list_member_license_sources()
returns table (id uuid, drivers_license_expiration_source text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_user_role() not in ('fleet_manager', 'administrator') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select p.id, p.drivers_license_expiration_source
      from public.profiles p
     where p.organization_id = public.current_organization_id();
end;
$$;
revoke all on function public.list_member_license_sources() from public, anon;
grant execute on function public.list_member_license_sources() to authenticated;
