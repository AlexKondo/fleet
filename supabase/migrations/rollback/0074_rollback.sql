drop function if exists public.list_member_license_sources();
alter table public.profiles drop column if exists drivers_license_expiration_source;
