drop trigger if exists profiles_license_lock_trg on public.profiles;
drop function if exists public.reset_ai_license(uuid);
drop function if exists public.apply_ai_license_read(uuid, text, text, text, date, boolean);
drop function if exists public.profiles_license_lock();
