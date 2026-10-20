-- Privileged application functions must resolve persistent tables before pg_temp.
-- SET search_path=public alone implicitly searches temporary relations first.
-- No application role needs DDL in the trusted public schema.
revoke create on schema public from public,anon,authenticated;
do $hardening$
declare v_function record;
begin
 for v_function in
  select p.oid::regprocedure as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and p.prokind='f'
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 loop
  execute format('alter function %s set search_path = pg_catalog, public, extensions, auth, storage, pg_temp',v_function.signature);
 end loop;
end;
$hardening$;
