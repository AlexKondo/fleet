-- 0075: ADDITIVE (only blocks rows whose source is 'ai'; none exist when this is applied). Anti-fraud lock for CNH data read by the vision model.
-- Rule: once a member's CNH was read by AI and confirmed by the driver (drivers_license_expiration_source = 'ai'), number / category /
-- expiration / source can NOT be changed by any human or by any generic UPDATE, including the service role. The ONLY ways to change them:
--   * apply_ai_license_read(): the driver's own re-upload of a photo (server verified the AI result, see the signed token in the app), or
--   * reset_ai_license(): an audited administrator reset that CLEARS the record (the driver must re-send a photo; the member is unauthorized
--     to drive until then).
-- Both are SECURITY DEFINER, service_role only, and set a transaction-local flag the trigger honours. Rows with source NULL / 'manual' are
-- unaffected (editable as before).
create function public.profiles_license_lock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.drivers_license_expiration_source = 'ai'
     and coalesce(current_setting('app.license_ai_write', true), '') <> '1'
     and (new.drivers_license_number is distinct from old.drivers_license_number
          or new.drivers_license_category is distinct from old.drivers_license_category
          or new.drivers_license_expiration is distinct from old.drivers_license_expiration
          or new.drivers_license_expiration_source is distinct from old.drivers_license_expiration_source) then
    raise exception 'license_locked_by_ai' using errcode = '42501',
      detail = 'CNH data read by AI cannot be edited; the driver must send a new photo or an administrator must reset it.';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_license_lock() from public, anon, authenticated;

create trigger profiles_license_lock_trg
  before update of drivers_license_number, drivers_license_category, drivers_license_expiration, drivers_license_expiration_source
  on public.profiles
  for each row execute function public.profiles_license_lock();

create function public.apply_ai_license_read(
  p_user_id uuid, p_full_name text, p_number text, p_category text, p_expiration date, p_authorized boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or coalesce(trim(p_number), '') = '' or coalesce(trim(p_category), '') = '' or p_expiration is null then
    raise exception 'invalid_license_read' using errcode = '22023';
  end if;
  perform set_config('app.license_ai_write', '1', true);
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         drivers_license_number = p_number,
         drivers_license_category = p_category,
         drivers_license_expiration = p_expiration,
         drivers_license_expiration_source = 'ai',
         driver_authorized = p_authorized
   where id = p_user_id;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.apply_ai_license_read(uuid, text, text, text, date, boolean) from public, anon, authenticated;
grant execute on function public.apply_ai_license_read(uuid, text, text, text, date, boolean) to service_role;

create function public.reset_ai_license(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.license_ai_write', '1', true);
  update public.profiles
     set drivers_license_number = null,
         drivers_license_category = null,
         drivers_license_expiration = null,
         drivers_license_expiration_source = null,
         driver_authorized = false
   where id = p_user_id;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.reset_ai_license(uuid) from public, anon, authenticated;
grant execute on function public.reset_ai_license(uuid) to service_role;
