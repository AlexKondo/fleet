-- F1 regression (after 0215/0216), Org A base users, everything in BEGIN..ROLLBACK:
--  R1 SP gate_visual happy path: traveler + security checklists -> security departure -> return -> arrival -> security return => completed/available
--  R2 SP damage: pickup with damage -> DEPARTURE_BLOCKED; reporter cannot release; independent manager completes the repair -> hold released, departure OK
--  R3 Campinas key_custody: delivery -> digital pickup (in_use) -> key received -> return => completed/available
--  R4 Release layers (0213): flag off -> 0; flag on: -59 min stays, -61 min released, activity skipped, idempotent
-- Run as: cat f1_lib.sql r_regress_flows.sql | psql
\set ON_ERROR_STOP 1
begin;
create temp table f1_out(caso text, esperado text, obtido text) on commit drop;
select s1.orga() as org, s1.uid('lucas') as lucas, s1.uid('security') as sec, s1.uid('fmall') as fmall, s1.uid('custodian') as cust, s1.uid('admin') as adm \gset
create or replace function pg_temp.f1_v(p_k text, p_unit uuid, p_loc uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
 v:=s1.mkveh(p_k,s1.orga(),p_unit,'reserved');
 update vehicles set current_location_id=p_loc, home_location_id=p_loc where id=v;
 insert into fm_equipment_profiles(target_kind,target_id,organization_id,enabled,required_ids,optional_ids,version,updated_by) values('vehicle',v,s1.orga(),true,'{}','{}',1,s1.uid('admin'));
 return v;
end;$f$;
create or replace function pg_temp.pk(r uuid, role text, dmg boolean default false) returns text language sql as $f$
 select format('select record_pickup(%L,10001,80,null,%s,%L,%s,false,false,%L)::text', r, case when dmg then 'true' else 'false' end, case when dmg then 'Avaria F1' end, case when role='traveler' then '''{}''::text[]' else 'null' end, role) $f$;
create or replace function pg_temp.rt(r uuid, role text, loc uuid) returns text language sql as $f$
 select format('select record_return(%L,10050,70,null,false,null,%s,false,false,%L,null,null,%s)::text', r, case when role='traveler' then '''{}''::text[]' else 'null' end, role, case when role='traveler' then quote_literal(loc) else 'null' end) $f$;
create or replace function pg_temp.gate(r uuid, kind text) returns text language sql as $f$
 select format('select fm_v3_command(''gate.record'',%L,gen_random_uuid())::text', json_build_object('reservation_id',r,'kind',kind)::text) $f$;
-- R1
select pg_temp.f1_v('f1r1','d1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001') as v1 \gset
select s1.mkres('f1r1',:'org',:'lucas',:'v1','confirmed',now()-interval '5 minutes',now()+interval '3 hours') as r1 \gset
insert into f1_out select 'R1_01_contrato','OK',regexp_replace(pg_temp.f1_as(:'lucas',format('select (fm_prepare_equipment_checklist(%L) is not null)::text',:'r1')),'^OK.*','OK');
insert into f1_out select 'R1_02_checklist_condutor','OK',regexp_replace(pg_temp.f1_as(:'lucas',pg_temp.pk(:'r1','traveler')),'^OK.*','OK');
insert into f1_out select 'R1_03_saida_sem_checklist_seg','ERR:CHECKLIST_REQUIRED',pg_temp.f1_as(:'sec',pg_temp.gate(:'r1','departure'));
insert into f1_out select 'R1_04_checklist_seguranca','OK',regexp_replace(pg_temp.f1_as(:'sec',pg_temp.pk(:'r1','security')),'^OK.*','OK');
insert into f1_out select 'R1_05_saida_gestor','ERR:NOT_AUTHORIZED',pg_temp.f1_as(:'fmall',pg_temp.gate(:'r1','departure'));
insert into f1_out select 'R1_06_saida_seguranca','OK',regexp_replace(pg_temp.f1_as(:'sec',pg_temp.gate(:'r1','departure')),'^OK.*','OK');
insert into f1_out select 'R1_07_status_in_use','in_use',(select status::text from vehicles where id=:'v1');
insert into f1_out select 'R1_08_chegada_seguranca','OK',regexp_replace(pg_temp.f1_as(:'sec',pg_temp.gate(:'r1','arrival')),'^OK.*','OK');
insert into f1_out select 'R1_09_devolucao_condutor','OK',regexp_replace(pg_temp.f1_as(:'lucas',pg_temp.rt(:'r1','traveler','e1000000-0000-0000-0000-000000000001')),'^OK.*','OK');
insert into f1_out select 'R1_10_devolucao_seguranca','OK',regexp_replace(pg_temp.f1_as(:'sec',pg_temp.rt(:'r1','security',null)),'^OK.*','OK');
insert into f1_out select 'R1_11_final','completed/available',(select r.status||'/'||v.status from reservations r join vehicles v on v.id=r.vehicle_id where r.id=:'r1');
-- R2 damage
select pg_temp.f1_v('f1r2','d1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001') as v2 \gset
select s1.mkres('f1r2',:'org',:'lucas',:'v2','confirmed',now()-interval '5 minutes',now()+interval '3 hours') as r2 \gset
insert into f1_out select 'R2_01_contrato','OK',regexp_replace(pg_temp.f1_as(:'lucas',format('select (fm_prepare_equipment_checklist(%L) is not null)::text',:'r2')),'^OK.*','OK');
insert into f1_out select 'R2_02_checklist_com_avaria','OK',regexp_replace(pg_temp.f1_as(:'lucas',pg_temp.pk(:'r2','traveler',true)),'^OK.*','OK');
insert into f1_out select 'R2_03_checklist_seguranca','OK',regexp_replace(pg_temp.f1_as(:'sec',pg_temp.pk(:'r2','security')),'^OK.*','OK');
insert into f1_out select 'R2_04_saida_com_avaria','ERR:DEPARTURE_BLOCKED',pg_temp.f1_as(:'sec',pg_temp.gate(:'r2','departure'));
select coalesce((select id::text from workflow_tasks where vehicle_id=:'v2' and type='repair' and status='open' limit 1),'00000000-0000-0000-0000-000000000000') as t2 \gset
insert into f1_out select 'R2_05_tarefa_reparo_criada','1',(select count(*)::text from workflow_tasks where vehicle_id=:'v2' and type='repair');
insert into f1_out select 'R2_06_gestor_libera_avaria_de_outro','OK:',pg_temp.f1_as(:'fmall',format('select complete_workflow_task(%L)::text',:'t2'));
insert into f1_out select 'R2_07_avaria_liberada_auditada','f/1',(select left(has_blocking_damage::text,1)||'/'||(select count(*) from audit_log where entity_id=:'v2' and action='vehicle.damage_hold_released' and actor_id=:'fmall') from vehicles where id=:'v2');
-- damage evidence photo, written as the definer path does (fm_photo_link runs as owner; simulated here as postgres)
insert into storage.objects(bucket_id,name,owner,metadata) select 'vehicle-photos',i.organization_id||'/'||i.id||'/damage_f1.png',i.performed_by,'{"size":10,"mimetype":"image/png"}' from inspections i where i.reservation_id=:'r2' and i.type='pickup' and i.has_new_damage;
insert into inspection_photos(organization_id,inspection_id,angle,storage_path) select i.organization_id,i.id,'damage',i.organization_id||'/'||i.id||'/damage_f1.png' from inspections i where i.reservation_id=:'r2' and i.type='pickup' and i.has_new_damage;
insert into f1_out select 'R2_08_saida_apos_reparo','OK',regexp_replace(pg_temp.f1_as(:'sec',pg_temp.gate(:'r2','departure')),'^OK.*','OK');
-- R3 Campinas key custody
select pg_temp.f1_v('f1r3','d1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002') as v3 \gset
select s1.mkres('f1r3',:'org',:'lucas',:'v3','confirmed',now()-interval '5 minutes',now()+interval '3 hours') as r3 \gset
insert into f1_out select 'R3_01_portaria_em_custodia','ERR:DEPARTURE_BLOCKED',pg_temp.f1_as(:'sec',pg_temp.gate(:'r3','departure'));
insert into f1_out select 'R3_02_gestor_nao_custodiante','ERR:KEY_CUSTODY_NOT_AUTHORIZED',pg_temp.f1_as(:'fmall',format('select fm_key_command(%L,''delivered'',null,gen_random_uuid())::text',:'r3'));
insert into f1_out select 'R3_03_entrega_custodiante','OK',regexp_replace(pg_temp.f1_as(:'cust',format('select fm_key_command(%L,''delivered'',null,gen_random_uuid())::text',:'r3')),'^OK.*','OK');
insert into f1_out select 'R3_04_contrato','OK',regexp_replace(pg_temp.f1_as(:'lucas',format('select (fm_prepare_equipment_checklist(%L) is not null)::text',:'r3')),'^OK.*','OK');
insert into f1_out select 'R3_05_retirada_digital','OK',regexp_replace(pg_temp.f1_as(:'lucas',pg_temp.pk(:'r3','traveler')),'^OK.*','OK');
insert into f1_out select 'R3_06_status','in_use',(select status::text from vehicles where id=:'v3');
insert into f1_out select 'R3_07_recebimento','OK',regexp_replace(pg_temp.f1_as(:'cust',format('select fm_key_command(%L,''received'',null,gen_random_uuid())::text',:'r3')),'^OK.*','OK');
insert into f1_out select 'R3_08_devolucao','OK',regexp_replace(pg_temp.f1_as(:'lucas',pg_temp.rt(:'r3','traveler','e1000000-0000-0000-0000-000000000002')),'^OK.*','OK');
insert into f1_out select 'R3_09_final','completed/available',(select r.status||'/'||v.status from reservations r join vehicles v on v.id=r.vehicle_id where r.id=:'r3');
-- R4 release layers (Org A, flag toggled only inside this transaction)
update organization_settings set auto_release_enabled=false where organization_id=:'org';
select pg_temp.f1_v('f1r4a','d1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001') as v4a \gset
select pg_temp.f1_v('f1r4b','d1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001') as v4b \gset
select pg_temp.f1_v('f1r4c','d1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001') as v4c \gset
select s1.mkres('f1r4a',:'org',:'lucas',:'v4a','confirmed',now()-interval '3 hours',now()-interval '59 minutes') as r4a \gset
select s1.mkres('f1r4b',:'org',:'lucas',:'v4b','confirmed',now()-interval '3 hours',now()-interval '61 minutes') as r4b \gset
select s1.mkres('f1r4c',:'org',:'lucas',:'v4c','confirmed',now()-interval '3 hours',now()-interval '2 hours') as r4c \gset
insert into fm_gate_events(organization_id,reservation_id,vehicle_id,kind,reason,created_by) values(:'org',:'r4c',:'v4c','denied','F1 atividade',:'sec');
set local role service_role;
select (public.fm_release_expired_reservations(:'org'::uuid)->>'released') as rel_off \gset
reset role;
insert into f1_out select 'R4_01_flag_desligada','0',:'rel_off';
update organization_settings set auto_release_enabled=true, no_show_release_grace_minutes=60 where organization_id=:'org';
set local role service_role;
select public.fm_release_expired_reservations(:'org'::uuid)::text as rel_on \gset
select (public.fm_release_expired_reservations(:'org'::uuid)->>'released') as rel_again \gset
reset role;
insert into f1_out select 'R4_02_menos59_permanece','confirmed/reserved',(select r.status||'/'||v.status from reservations r join vehicles v on v.id=r.vehicle_id where r.id=:'r4a');
insert into f1_out select 'R4_03_menos61_liberada','cancelled/no_show_auto/available',(select r.status||'/'||r.cancellation_reason||'/'||v.status from reservations r join vehicles v on v.id=r.vehicle_id where r.id=:'r4b');
insert into f1_out select 'R4_04_com_atividade_intocada','confirmed',(select status::text from reservations where id=:'r4c');
insert into f1_out select 'R4_05_idempotente','0',:'rel_again';
insert into f1_out select 'R4_06_auditoria_unica','1',(select count(*)::text from audit_log where entity_id=:'r4b' and action='reservation.no_show_released');
select caso, esperado, obtido, case when obtido=esperado then 'PASS' else 'FAIL' end veredito from f1_out order by caso;
\echo release_on=:rel_on
rollback;
