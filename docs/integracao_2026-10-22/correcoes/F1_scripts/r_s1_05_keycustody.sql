-- F1 / S1-05: key-custody unit (Campinas, Org A). Unsafe vehicle: the key is NOT delivered (VEHICLE_NOT_READY) and a new
-- digital pickup is refused (DEPARTURE_BLOCKED). Base: C:\projects\_homolog\conclusao\S1\t5d_keycustody_invalid_doc.sql.
-- s1drvok was disabled by S1 cleanup; it is re-enabled INSIDE this transaction only. BEGIN..ROLLBACK.
-- Run as: cat f1_lib.sql r_s1_05_keycustody.sql | psql
\set ON_ERROR_STOP 1
begin;
update fm_member_access set enabled=true where user_id=s1.uid('s1drvok');
create temp table f1_out(caso text, esperado text, obtido text) on commit drop;
-- helper to build one Campinas vehicle + confirmed reservation (window open now)
create or replace function pg_temp.f1_kveh(p_k text) returns uuid language plpgsql as $f$
declare v uuid;
begin
 v:=s1.mkveh(p_k,s1.orga(),'d1000000-0000-0000-0000-000000000002','reserved');
 update vehicles set current_location_id='e1000000-0000-0000-0000-000000000002', home_location_id='e1000000-0000-0000-0000-000000000002' where id=v;
 insert into fm_equipment_profiles(target_kind,target_id,organization_id,enabled,required_ids,optional_ids,version,updated_by)
  select 'vehicle',v,s1.orga(),true,array(select id from safety_equipment_items where organization_id=s1.orga() and name='Extintor de Incêndio'),'{}',1,s1.uid('admin');
 return v;
end;$f$;
-- (a) documentation invalid BEFORE the key handover
select pg_temp.f1_kveh('f1kd_doc') as v \gset
update vehicles set documentation_valid=false where id=:'v';
select s1.mkres('f1kd_doc',s1.orga(),s1.uid('s1drvok'),:'v','confirmed',now()-interval '5 minutes',now()+interval '2 hours') as r \gset
insert into f1_out select 'RESULT|S1-05|a_entrega_chave_doc_irregular','ERR:VEHICLE_NOT_READY',pg_temp.f1_as(s1.uid('custodian'),format('select fm_key_command(%L,''delivered'',null,gen_random_uuid())::text',:'r'));
insert into f1_out select 'RESULT|S1-05|a_status_veiculo','reserved',(select status::text from vehicles where id=:'v');
-- (b) key delivered while safe, documentation becomes invalid, then the driver's digital pickup
select pg_temp.f1_kveh('f1kd_late') as v2 \gset
select s1.mkres('f1kd_late',s1.orga(),s1.uid('s1drvok'),:'v2','confirmed',now()-interval '5 minutes',now()+interval '2 hours') as r2 \gset
insert into f1_out select 'RESULT|S1-05|b_entrega_chave_seguro','OK',left(pg_temp.f1_as(s1.uid('custodian'),format('select fm_key_command(%L,''delivered'',null,gen_random_uuid())::text',:'r2')),2);
update vehicles set documentation_valid=false where id=:'v2';
insert into f1_out select 'RESULT|S1-05|b_contrato_equip','OK',left(pg_temp.f1_as(s1.uid('s1drvok'),format('select (fm_prepare_equipment_checklist(%L) is not null)::text',:'r2')),2);
insert into f1_out select 'RESULT|S1-05|b_retirada_doc_irregular','ERR:DEPARTURE_BLOCKED',pg_temp.f1_as(s1.uid('s1drvok'),format('select record_pickup(%L,10001,80,null,false,null,''{}''::text[],false,false,''traveler'')::text',:'r2'));
insert into f1_out select 'RESULT|S1-05|b_status_veiculo','reserved',(select status::text from vehicles where id=:'v2');
-- (c) same with an in-progress work order (the other condition of the single check)
select pg_temp.f1_kveh('f1kd_wo') as v3 \gset
select s1.mkres('f1kd_wo',s1.orga(),s1.uid('s1drvok'),:'v3','confirmed',now()-interval '5 minutes',now()+interval '2 hours') as r3 \gset
set local session_replication_role=replica;
insert into fm_work_orders(organization_id,vehicle_id,kind,status,description,supplier,quote_total,scheduled_start,scheduled_end,created_by,budget_pending)
values(s1.orga(),:'v3','corrective','in_progress','F1 OS em andamento','F1 Oficina',100,now()-interval '1 hour',now()+interval '1 day',s1.uid('admin'),false);
set local session_replication_role=origin;
insert into f1_out select 'RESULT|S1-05|c_entrega_chave_os_andamento','ERR:VEHICLE_NOT_READY',pg_temp.f1_as(s1.uid('custodian'),format('select fm_key_command(%L,''delivered'',null,gen_random_uuid())::text',:'r3'));
-- (d) control: safe vehicle, delivery + pickup start the trip
select pg_temp.f1_kveh('f1kd_ok') as v4 \gset
select s1.mkres('f1kd_ok',s1.orga(),s1.uid('s1drvok'),:'v4','confirmed',now()-interval '5 minutes',now()+interval '2 hours') as r4 \gset
insert into f1_out select 'RESULT|S1-05|d_controle_entrega','OK',left(pg_temp.f1_as(s1.uid('custodian'),format('select fm_key_command(%L,''delivered'',null,gen_random_uuid())::text',:'r4')),2);
insert into f1_out select 'RESULT|S1-05|d_controle_contrato','OK',left(pg_temp.f1_as(s1.uid('s1drvok'),format('select (fm_prepare_equipment_checklist(%L) is not null)::text',:'r4')),2);
insert into f1_out select 'RESULT|S1-05|d_controle_retirada','OK',left(pg_temp.f1_as(s1.uid('s1drvok'),format('select record_pickup(%L,10001,80,null,false,null,''{}''::text[],false,false,''traveler'')::text',:'r4')),2);
insert into f1_out select 'RESULT|S1-05|d_controle_retry_identico','OK',left(pg_temp.f1_as(s1.uid('s1drvok'),format('select record_pickup(%L,10001,80,null,false,null,''{}''::text[],false,false,''traveler'')::text',:'r4')),2);
insert into f1_out select 'RESULT|S1-05|d_controle_status','in_use',(select status::text from vehicles where id=:'v4');
select caso, esperado, obtido, case when obtido=esperado then 'PASS' else 'FAIL' end veredito from f1_out order by caso;
rollback;
