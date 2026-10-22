-- F1 / S1-06: complete_workflow_task / cancel_workflow_task must not make an unsafe vehicle available and must not clear
-- has_blocking_damage outside the audited 0205 release (independent-actor rule). Org B. BEGIN..ROLLBACK.
-- Base: C:\projects\_homolog\conclusao\S1\t1c_complete_task_unsafe.sql (case a). Run as: cat f1_lib.sql r_s1_06_tasks.sql | psql
\set ON_ERROR_STOP 1
begin;
create temp table f1_out(caso text, esperado text, obtido text) on commit drop;
create or replace function pg_temp.f1_task(p_vehicle uuid, p_type workflow_task_type, p_src uuid default null) returns uuid language sql as $f$
 insert into workflow_tasks(organization_id,vehicle_id,type,notes,source_inspection_id) values(s1.orgb(),p_vehicle,p_type,'F1 tarefa',p_src) returning id $f$;
-- damage reported by s1adminb on a confirmed (still open) trip of the vehicle -> s1adminb is NOT independent
create or replace function pg_temp.f1_damage(p_k text, p_reporter uuid) returns uuid[] language plpgsql as $f$
declare v uuid; r uuid; i uuid;
begin
 v:=s1.mkveh(p_k,s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','maintenance');
 r:=s1.mkres(p_k,s1.orgb(),s1.uid('s1drvb'),v,'confirmed',now()+interval '2 days',now()+interval '2 days 2 hours');
 set local session_replication_role=replica;
 insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role,has_new_damage,damage_notes)
 values(s1.orgb(),r,v,'pickup',p_reporter,'traveler',true,'F1 avaria') returning id into i;
 set local session_replication_role=origin;
 update vehicles set has_blocking_damage=true where id=v;
 return array[v,i];
end;$f$;
-- (a) documentation invalid + last repair task completed -> must NOT be available (t1c)
select s1.mkveh('ct_doc',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','maintenance') as va \gset
update vehicles set documentation_valid=false where id=:'va';
select pg_temp.f1_task(:'va','repair') as ta \gset
insert into f1_out select 'RESULT|S1-06|a_complete_doc_irregular_chamada','OK:',pg_temp.f1_as(s1.uid('s1adminb'),format('select complete_workflow_task(%L)::text',:'ta'));
insert into f1_out select 'RESULT|S1-06|a_complete_doc_irregular_status','blocked',(select status::text from vehicles where id=:'va');
-- (a2) same through cancel_workflow_task
select s1.mkveh('ct_doc2',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','maintenance') as va2 \gset
update vehicles set documentation_valid=false where id=:'va2';
select pg_temp.f1_task(:'va2','safety') as ta2 \gset
insert into f1_out select 'RESULT|S1-06|a2_cancel_doc_irregular_chamada','OK:',pg_temp.f1_as(s1.uid('s1adminb'),format('select cancel_workflow_task(%L)::text',:'ta2'));
insert into f1_out select 'RESULT|S1-06|a2_cancel_doc_irregular_status','blocked',(select status::text from vehicles where id=:'va2');
-- (b) damage reported by s1adminb: s1adminb completing the repair task must hit the 0205 independence rule
select (pg_temp.f1_damage('ct_dmgself',s1.uid('s1adminb'))) as arr \gset
select (:'arr'::uuid[])[1] as vb, (:'arr'::uuid[])[2] as ib \gset
select pg_temp.f1_task(:'vb','repair',:'ib') as tb \gset
insert into f1_out select 'RESULT|S1-06|b_reporter_completa_reparo','ERR:DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED',pg_temp.f1_as(s1.uid('s1adminb'),format('select complete_workflow_task(%L)::text',:'tb'));
insert into f1_out select 'RESULT|S1-06|b_estado_inalterado','maintenance/t/open',(select v.status||'/'||left(v.has_blocking_damage::text,1)||'/'||t.status from vehicles v join workflow_tasks t on t.vehicle_id=v.id where v.id=:'vb');
-- (c) damage reported by s1drvb (another person): independent admin completes -> released through 0205 (audit) and available
select (pg_temp.f1_damage('ct_dmgind',s1.uid('s1drvb'))) as arr \gset
select (:'arr'::uuid[])[1] as vc, (:'arr'::uuid[])[2] as ic \gset
select pg_temp.f1_task(:'vc','repair',:'ic') as tc \gset
insert into f1_out select 'RESULT|S1-06|c_independente_completa','OK:',pg_temp.f1_as(s1.uid('s1adminb'),format('select complete_workflow_task(%L)::text',:'tc'));
insert into f1_out select 'RESULT|S1-06|c_estado','reserved_or_available/f',(select case when v.status in ('available') then 'reserved_or_available' else v.status::text end||'/'||left(v.has_blocking_damage::text,1) from vehicles v where v.id=:'vc');
insert into f1_out select 'RESULT|S1-06|c_auditoria_0205','1',(select count(*)::text from audit_log where action='vehicle.damage_hold_released' and entity_id=:'vc' and actor_id=s1.uid('s1adminb'));
-- (d) cancelling the repair task must NOT clear the damage
select (pg_temp.f1_damage('ct_dmgcan',s1.uid('s1drvb'))) as arr \gset
select (:'arr'::uuid[])[1] as vd, (:'arr'::uuid[])[2] as id_ \gset
select pg_temp.f1_task(:'vd','repair',:'id_') as td \gset
insert into f1_out select 'RESULT|S1-06|d_cancel_reparo','OK:',pg_temp.f1_as(s1.uid('s1adminb'),format('select cancel_workflow_task(%L)::text',:'td'));
insert into f1_out select 'RESULT|S1-06|d_estado','maintenance/t',(select v.status||'/'||left(v.has_blocking_damage::text,1) from vehicles v where v.id=:'vd');
-- (e) control: safe vehicle -> available
select s1.mkveh('ct_ok',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','maintenance') as ve \gset
select pg_temp.f1_task(:'ve','preventive_maintenance') as te \gset
insert into f1_out select 'RESULT|S1-06|e_controle','OK:',pg_temp.f1_as(s1.uid('s1adminb'),format('select complete_workflow_task(%L)::text',:'te'));
insert into f1_out select 'RESULT|S1-06|e_controle_status','available',(select status::text from vehicles where id=:'ve');
-- (f) control: the work order's own task being closed (work_order.completed path) does not hold the vehicle
select s1.mkveh('ct_os',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','maintenance') as vf \gset
select pg_temp.f1_task(:'vf','repair') as tf \gset
set local session_replication_role=replica;
insert into fm_work_orders(organization_id,vehicle_id,kind,status,description,supplier,quote_total,scheduled_start,scheduled_end,created_by,budget_pending,workflow_task_id)
values(s1.orgb(),:'vf','corrective','in_progress','F1 OS','F1 Oficina',100,now()-interval '1 hour',now()+interval '1 day',s1.uid('s1adminb'),false,:'tf');
set local session_replication_role=origin;
insert into f1_out select 'RESULT|S1-06|f_os_propria_tarefa','OK:',pg_temp.f1_as(s1.uid('s1adminb'),format('select complete_workflow_task(%L)::text',:'tf'));
insert into f1_out select 'RESULT|S1-06|f_os_status','available',(select status::text from vehicles where id=:'vf');
select caso, esperado, obtido, case when obtido=esperado then 'PASS' else 'FAIL' end veredito from f1_out order by caso;
rollback;
