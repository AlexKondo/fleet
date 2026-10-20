-- READ ONLY. Run only where authorized; no ledger repair or migration execution.
select version();
select to_regprocedure('public.apply_ai_license_read(uuid,text,text,text,date,boolean)') ai_reader,
 to_regprocedure('public.reset_ai_license(uuid)') ai_reset,
 to_regprocedure('public.list_member_license_sources()') license_sources;
select trigger_name,event_manipulation from information_schema.triggers where trigger_name='profiles_license_lock_trg';
select column_name,data_type from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='drivers_license_expiration_source';
select p.oid::regprocedure signature,pg_get_userbyid(p.proowner) owner,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') member_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef order by 1;
select rolname,has_schema_privilege(rolname,'public','CREATE') can_create from pg_roles where rolname in ('anon','authenticated');
select count(*) missing_validity from public.profiles where driver_authorized and drivers_license_expiration is null;
-- After the v3 schema exists, additionally run readiness queries in INTEGRACAO.md.
