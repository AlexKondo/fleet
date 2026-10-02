-- Rollback for 0070_f5_default_privileges_no_auto_exposure.sql: restores the Supabase default privileges for objects created
-- later in schema public by postgres and supabase_admin (anon / authenticated / service_role get everything again).
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges for role postgres grant execute on functions to public;
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role';
  execute 'alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role';
  execute 'alter default privileges for role supabase_admin in schema public grant execute on functions to anon, authenticated, service_role';
exception when others then
  raise notice 'supabase_admin defaults unchanged (%)', sqlerrm;
end $$;
