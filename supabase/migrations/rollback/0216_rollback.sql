-- Rollback of 0216: restores the exact before-state ACL of public.inspection_photos captured on the local database at 0214
-- (relacl = {postgres=arwdDxtm/postgres,authenticated=arwd/postgres,service_role=arwdDxtm/postgres}; anon/PUBLIC had no INSERT).
grant insert on table public.inspection_photos to authenticated;
