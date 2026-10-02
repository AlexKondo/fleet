-- Rollback of 0071 (purged data cannot be restored; only the function is removed).
drop function if exists public.purge_old_carpool_locations(integer);
