-- F1 helper (session-local, pg_temp): run one statement as a real authenticated user (same grants/RLS as PostgREST) and
-- return OK:<value> or ERR:<message>. Errors are contained in a subtransaction, so a script continues after an expected refusal.
create or replace function pg_temp.f1_as(p_actor uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
 perform set_config('request.jwt.claims', json_build_object('sub',p_actor,'role','authenticated')::text, true);
 set local role authenticated;
 execute p_sql into v;
 reset role;
 return 'OK:'||coalesce(v,'');
exception when others then
 return 'ERR:'||sqlerrm;
end;$f$;
