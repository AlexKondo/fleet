-- C1 fixture: reservas vencidas na Org T1A (SEM linha em organization_settings) e Org T1B (linha default).
-- Atividade gerada pelos comandos REAIS (checklist, portaria 'denied', chave 'delivered') com a reserva ainda no horario;
-- depois o horario e deslocado para o passado (somente start_at/end_at, como postgres).
\set ON_ERROR_STOP on
begin;
select t1.mkveh(k,u) from (values
 ('rl_conf','sp'),('rl_pend','sp'),('rl_insp','sp'),('rl_gate','sp'),('rl_key','cp'),('rl_dmg','sp'),('rl_doc','sp'),('rl_wo','sp'),('rl_eqp','sp'),
 ('rl_other','sp'),('rl_g59','sp'),('rl_g61','sp'),('rl_fut','sp'),
 ('rlb_conf','b'),('rlb_opt','b'),('rlb_g0','b'),('rlb_g1440a','b'),('rlb_g1440b','b')) t(k,u);
-- reservas "agora" (para gerar atividade real) e vencidas
select t1.mkres('rl_insp','t1drvok','rl_insp','confirmed',now()-interval '10 minutes',now()+interval '2 hours');
select t1.mkres('rl_gate','t1drvok','rl_gate','confirmed',now()-interval '10 minutes',now()+interval '2 hours');
select t1.mkres('rl_key','t1drvok','rl_key','confirmed',now()-interval '10 minutes',now()+interval '2 hours');
select t1.mkres('rl_conf','t1drvok','rl_conf','confirmed',now()-interval '5 hours',now()-interval '3 hours');
select t1.mkres('rl_pend','t1drvok','rl_pend','pending_approval',now()-interval '5 hours',now()-interval '3 hours');
select t1.mkres('rl_dmg','t1drvok','rl_dmg','confirmed',now()-interval '5 hours',now()-interval '3 hours');
select t1.mkres('rl_doc','t1drvok','rl_doc','confirmed',now()-interval '5 hours',now()-interval '3 hours');
select t1.mkres('rl_wo','t1drvok','rl_wo','confirmed',now()-interval '5 hours',now()-interval '3 hours');
select t1.mkres('rl_eqp','t1drvok','rl_eqp','confirmed',now()-interval '5 hours',now()-interval '3 hours');
select t1.mkres('rl_other_exp','t1drvok','rl_other','confirmed',now()-interval '5 hours',now()-interval '3 hours');
select t1.mkres('rl_other_fut','t1req2','rl_other','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours');
select t1.mkres('rl_g59','t1drvok','rl_g59','confirmed',now()-interval '3 hours',now()-interval '59 minutes');
select t1.mkres('rl_g61','t1drvok','rl_g61','confirmed',now()-interval '3 hours',now()-interval '61 minutes');
select t1.mkres('rl_fut','t1drvok','rl_fut','confirmed',now()+interval '1 hour',now()+interval '3 hours');
select t1.mkres('rlb_conf','t1drvb','rlb_conf','confirmed',now()-interval '5 hours',now()-interval '3 hours');
update vehicles set status='reserved' where id in (select id from t1.v where k like 'rl%' and k<>'rl_pend');
update vehicles set has_blocking_damage=true where id=t1.vid('rl_dmg');
update vehicles set documentation_valid=false where id=t1.vid('rl_doc');
update vehicles set missing_safety_equipment=array['Extintor de Incendio'] where id=t1.vid('rl_eqp');
insert into fm_work_orders(organization_id,vehicle_id,kind,status,description,supplier,quote_total,scheduled_start,scheduled_end,created_by,budget_pending)
values(t1.orga(),t1.vid('rl_wo'),'corrective','in_progress','T1 OS em andamento','T1 Oficina',100,now()-interval '1 hour',now()+interval '1 day',t1.uid('t1admin'),false);
commit;
-- atividade real (usuario real, role authenticated)
\echo === atividade real
begin;
select 'insp prepare', t1.as_user('t1drvok', format($q$select fm_prepare_equipment_checklist(%L)::text$q$, t1.rid('rl_insp')));
select 'insp pickup', t1.as_user('t1drvok', format($q$select record_pickup(%L,10010,80,null,false,null,'{}',false,false,'traveler')::text$q$, t1.rid('rl_insp')));
select 'gate denied', t1.as_user('t1sec', format($q$select fm_v3_command('gate.record',jsonb_build_object('reservation_id',%L::uuid,'kind','denied','reason','T1 negado na portaria'),gen_random_uuid())::text$q$, t1.rid('rl_gate')));
select 'key delivered', t1.as_user('t1custcp', format($q$select fm_key_command(%L,'delivered',null,gen_random_uuid())::text$q$, t1.rid('rl_key')));
commit;
-- desloca as tres reservas com atividade para o passado (vencidas ha 3h)
begin;
update reservations set start_at=now()-interval '5 hours', end_at=now()-interval '3 hours' where id in (t1.rid('rl_insp'),t1.rid('rl_gate'),t1.rid('rl_key'));
update trip_requests set departure_at=now()-interval '5 hours', expected_return_at=now()-interval '3 hours' where id in (select trip_request_id from reservations where id in (t1.rid('rl_insp'),t1.rid('rl_gate'),t1.rid('rl_key')));
commit;
select r.k, res.status, v.status vstatus, (select count(*) from inspections i where i.reservation_id=res.id) insp, (select count(*) from fm_gate_events g where g.reservation_id=res.id) gate, (select count(*) from fm_key_events k where k.reservation_id=res.id) keyev, res.end_at < now() expired
from t1.r r join reservations res on res.id=r.id join vehicles v on v.id=res.vehicle_id order by r.k;
