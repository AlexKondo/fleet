-- Pacote 01 integration: list_member_license_sources() (our migration 0074) is SECURITY DEFINER, callable by authenticated and was
-- left out of 0192 (that allowlist only covers functions present in the v3 source). Pin its search_path with pg_temp last, like the
-- other 138 definer functions. Body, grants and owner are untouched.
alter function public.list_member_license_sources() set search_path = public, pg_temp;
