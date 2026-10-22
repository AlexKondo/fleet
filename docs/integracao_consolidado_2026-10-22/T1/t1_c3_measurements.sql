-- C3: medicoes (0220 comando auditado, 0223 sem UPDATE direto) e cadastro (0210). Usuarios reais (role authenticated + claims).
\set ON_ERROR_STOP on
\pset pager off
begin;
select t1.mkveh(k,u) from (values ('ms_sp','sp'),('ms_cp','cp'),('ms_b','b')) t(k,u);
commit;
\set vsp `docker exec -i supabase_db_fleet-homolog true 2>/dev/null; echo`
select id as vsp from t1.v where k='ms_sp' \gset
select id as vcp from t1.v where k='ms_cp' \gset
select id as vb from t1.v where k='ms_b' \gset

\echo === C3-01 privilegios de coluna (0223)
select c.column_name, has_column_privilege('authenticated','public.vehicles',c.column_name,'UPDATE') auth_update
from information_schema.columns c where c.table_schema='public' and c.table_name='vehicles' order by c.ordinal_position;

\echo === C3-02 comando auditado fm_update_vehicle
select 'fmsp aumenta odometro/combustivel (escopo)' c, t1.as_user('t1fmsp', format($q$select fm_update_vehicle(%L,'{"odometer_km":10100,"fuel_level_percent":70,"battery_level_percent":null,"estimated_range_km":550}'::jsonb)::text$q$, :'vsp'))
union all select 'fmsp reduz odometro SEM justificativa', t1.as_user('t1fmsp', format($q$select fm_update_vehicle(%L,'{"odometer_km":10050}'::jsonb)::text$q$, :'vsp'))
union all select 'fmsp reduz odometro com justificativa vazia (como o app envia)', t1.as_user('t1fmsp', format($q$select fm_update_vehicle(%L,'{"odometer_km":10050}'::jsonb,'')::text$q$, :'vsp'))
union all select 'fmsp reduz odometro com justificativa curta (2)', t1.as_user('t1fmsp', format($q$select fm_update_vehicle(%L,'{"odometer_km":10050}'::jsonb,'ab')::text$q$, :'vsp'))
union all select 'fmsp reduz odometro COM justificativa', t1.as_user('t1fmsp', format($q$select fm_update_vehicle(%L,'{"odometer_km":10050}'::jsonb,'Correcao de digitacao T1')::text$q$, :'vsp'))
union all select 'fmcp no veiculo SP (unidade errada)', t1.as_user('t1fmcp', format($q$select fm_update_vehicle(%L,'{"odometer_km":10200}'::jsonb)::text$q$, :'vsp'))
union all select 'fmcp no veiculo CP (escopo)', t1.as_user('t1fmcp', format($q$select fm_update_vehicle(%L,'{"odometer_km":10200}'::jsonb)::text$q$, :'vcp'))
union all select 'adminB no veiculo SP (outra org)', t1.as_user('t1adminb', format($q$select fm_update_vehicle(%L,'{"odometer_km":10300}'::jsonb)::text$q$, :'vsp'))
union all select 'admin A no veiculo da Org B', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"odometer_km":10300}'::jsonb)::text$q$, :'vb'))
union all select 'condutor (employee)', t1.as_user('t1drvok', format($q$select fm_update_vehicle(%L,'{"odometer_km":10300}'::jsonb)::text$q$, :'vsp'))
union all select 'seguranca', t1.as_user('t1sec', format($q$select fm_update_vehicle(%L,'{"odometer_km":10300}'::jsonb)::text$q$, :'vsp'))
union all select 'manutencao', t1.as_user('t1maint', format($q$select fm_update_vehicle(%L,'{"odometer_km":10300}'::jsonb)::text$q$, :'vsp'))
union all select 'chave proibida (status)', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"status":"available"}'::jsonb)::text$q$, :'vsp'))
union all select 'chave proibida (documentation_valid)', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"documentation_valid":true}'::jsonb)::text$q$, :'vsp'))
union all select 'chave proibida (photo_storage_path)', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"photo_storage_path":"x"}'::jsonb)::text$q$, :'vsp'))
union all select 'combustivel 120', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"fuel_level_percent":120}'::jsonb)::text$q$, :'vsp'))
union all select 'odometro negativo', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"odometer_km":-1}'::jsonb,'Teste negativo')::text$q$, :'vsp'))
union all select 'categoria de outra org', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"category_id":"7b000000-0000-0000-0000-0000000000d1"}'::jsonb)::text$q$, :'vsp'))
union all select 'local de outra org', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'{"home_location_id":"7b000000-0000-0000-0000-0000000000c1"}'::jsonb)::text$q$, :'vsp'))
union all select 'payload nao-objeto', t1.as_user('t1admin', format($q$select fm_update_vehicle(%L,'[1]'::jsonb)::text$q$, :'vsp'))
union all select 'admin sem CNH: cadastro+medicao (escopo)', t1.as_user('t1adminnocnh', format($q$select fm_update_vehicle(%L,'{"name":"T1 ms_sp renomeado","color":"Azul","odometer_km":10060}'::jsonb)::text$q$, :'vsp'))
union all select 'gestor sem CNH (all units)', t1.as_user('t1fmnocnh', format($q$select fm_update_vehicle(%L,'{"fuel_level_percent":65}'::jsonb)::text$q$, :'vcp'));

\echo --- gestor desativado (transacao desfeita)
begin;
insert into fm_member_access(user_id,organization_id,enabled,version,reason,updated_by) values (t1.uid('t1fmall'),t1.orga(),false,1,'T1 desativacao temporaria',t1.uid('t1admin'));
select 'fmall desativado' c, t1.as_user('t1fmall', format($q$select fm_update_vehicle(%L,'{"odometer_km":10400}'::jsonb)::text$q$, :'vsp'));
rollback;

\echo --- estado e auditoria
select v.name, v.color, v.odometer_km, v.fuel_level_percent, v.estimated_range_km from vehicles v where id in (:'vsp',:'vcp',:'vb') order by name;
select (select k from t1.u where id=a.actor_id) actor, a.before->>'odometer_km' odo_before, a.after->>'odometer_km' odo_after, a.after->>'fuel_level_percent' fuel_after, a.after->>'correction_reason' reason
from audit_log a where a.entity_id in (:'vsp',:'vcp') and a.action='vehicle.measurements_updated' order by a.created_at;

\echo === C3-03 UPDATE direto das colunas de medicao (todos os papeis) e cadastro direto (0210)
create temp table c3(actor text, role text, odo text, fuel text, batt text, range text, name_sp text, name_cp text, color_b text);
grant all on c3 to authenticated;
do $$
declare a text; vsp uuid:=t1.vid('ms_sp'); vcp uuid:=t1.vid('ms_cp'); vb uuid:=t1.vid('ms_b');
begin
 for a in select k from t1.u order by k loop
  insert into c3 values(a,(select role::text from profiles where id=t1.uid(a)),
   t1.as_user(a, format($q$with x as (update vehicles set odometer_km=odometer_km+1 where id=%L returning 1) select count(*) from x$q$, vsp)),
   t1.as_user(a, format($q$with x as (update vehicles set fuel_level_percent=11 where id=%L returning 1) select count(*) from x$q$, vsp)),
   t1.as_user(a, format($q$with x as (update vehicles set battery_level_percent=11 where id=%L returning 1) select count(*) from x$q$, vsp)),
   t1.as_user(a, format($q$with x as (update vehicles set estimated_range_km=11 where id=%L returning 1) select count(*) from x$q$, vsp)),
   t1.as_user(a, format($q$with x as (update vehicles set name='T1 ms_sp '||%L where id=%L returning 1) select count(*) from x$q$, a, vsp)),
   t1.as_user(a, format($q$with x as (update vehicles set name='T1 ms_cp '||%L where id=%L returning 1) select count(*) from x$q$, a, vcp)),
   t1.as_user(a, format($q$with x as (update vehicles set color=%L where id=%L returning 1) select count(*) from x$q$, a, vb)));
 end loop;
end $$;
select * from c3 order by role, actor;
select name, color, odometer_km, fuel_level_percent, battery_level_percent, estimated_range_km from vehicles where id in (:'vsp',:'vcp',:'vb') order by name;
