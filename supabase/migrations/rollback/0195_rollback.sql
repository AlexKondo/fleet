-- Rollback of 0195: restore the previous search_path of list_member_license_sources() as captured in production on 2026-10-19.
alter function public.list_member_license_sources() set search_path = public;
