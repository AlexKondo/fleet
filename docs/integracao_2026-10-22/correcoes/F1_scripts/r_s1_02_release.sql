-- F1 / S1-02: fm_release_expired_reservations must not leave an unsafe vehicle 'reserved' without an active reservation.
-- Org B (fictitious S1 org). Everything inside BEGIN..ROLLBACK. Uses the s1.* helpers of C:\projects\_homolog\conclusao\S1.
\set ON_ERROR_STOP 1
begin;
update organization_settings set auto_release_enabled=true, no_show_release_grace_minutes=60 where organization_id=s1.orgb();
select s1.mkveh('f1rl_doc',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vdoc \gset
select s1.mkveh('f1rl_dmg',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vdmg \gset
select s1.mkveh('f1rl_eqp',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as veqp \gset
select s1.mkveh('f1rl_wo',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vwo \gset
select s1.mkveh('f1rl_ok',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vok \gset
select s1.mkveh('f1rl_two',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vtwo \gset
update vehicles set documentation_valid=false where id=:'vdoc';
update vehicles set has_blocking_damage=true where id=:'vdmg';
update vehicles set missing_safety_equipment='{Extintor}' where id=:'veqp';
update vehicles set documentation_valid=false where id=:'vtwo';
select s1.mkres('f1rl_doc',s1.orgb(),s1.uid('s1drvb'),:'vdoc','confirmed',now()-interval '5 hours',now()-interval '3 hours') \gset
select s1.mkres('f1rl_dmg',s1.orgb(),s1.uid('s1drvb'),:'vdmg','confirmed',now()-interval '5 hours',now()-interval '3 hours') \gset
select s1.mkres('f1rl_eqp',s1.orgb(),s1.uid('s1drvb'),:'veqp','confirmed',now()-interval '5 hours',now()-interval '3 hours') \gset
select s1.mkres('f1rl_wo',s1.orgb(),s1.uid('s1drvb'),:'vwo','confirmed',now()-interval '5 hours',now()-interval '3 hours') \gset
select s1.mkres('f1rl_ok',s1.orgb(),s1.uid('s1drvb'),:'vok','confirmed',now()-interval '5 hours',now()-interval '3 hours') \gset
select s1.mkres('f1rl_two',s1.orgb(),s1.uid('s1drvb'),:'vtwo','confirmed',now()-interval '5 hours',now()-interval '3 hours') \gset
select s1.mkres('f1rl_two_f',s1.orgb(),s1.uid('s1drvb'),:'vtwo','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours') \gset
set local session_replication_role=replica;
insert into fm_work_orders(organization_id,vehicle_id,kind,status,description,supplier,quote_total,scheduled_start,scheduled_end,created_by,budget_pending)
values(s1.orgb(),:'vwo','corrective','in_progress','F1 OS em andamento','F1 Oficina',100,now()-interval '1 hour',now()+interval '1 day',s1.uid('s1adminb'),false);
set local session_replication_role=origin;
set local role service_role;
select 'release' as call, public.fm_release_expired_reservations('b5000000-0000-0000-0000-00000000000b'::uuid) as r;
reset role;
with exp(plate,want) as (values ('S1F1RL_DOC','blocked'),('S1F1RL_DMG','maintenance'),('S1F1RL_EQP','maintenance'),('S1F1RL_WO','maintenance'),('S1F1RL_OK','available'),('S1F1RL_TWO','reserved'))
select 'RESULT|S1-02|'||e.plate as caso, e.want as esperado, v.status::text as obtido,
 (select count(*) from reservations r where r.vehicle_id=v.id and r.status='confirmed') as confirmed_left,
 (select a.after->>'vehicle_status' from audit_log a join reservations r on r.id=a.entity_id where r.vehicle_id=v.id and a.action='reservation.no_show_released' order by a.created_at desc limit 1) as audit_vehicle_status,
 case when v.status::text=e.want then 'PASS' else 'FAIL' end as veredito
from exp e join vehicles v on v.plate=e.plate and v.organization_id=s1.orgb() order by 1;
rollback;
