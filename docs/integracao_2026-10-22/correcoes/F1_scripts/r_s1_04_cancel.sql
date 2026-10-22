-- F1 / S1-04: cancel_reservation (requester s1drvb, Org B) must not put an unsafe vehicle back to 'available'.
-- Base: C:\projects\_homolog\conclusao\S1\t3f_cancel_unsafe.sql, extended (equipment, work order, safe and other-confirmed
-- controls). Run as: cat f1_lib.sql r_s1_04_cancel.sql | psql. BEGIN..ROLLBACK.
\set ON_ERROR_STOP 1
begin;
create temp table f1_case(plate text, want text, res uuid) on commit drop;
select s1.mkveh('cx_doc',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vdoc \gset
select s1.mkveh('cx_dmg',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vdmg \gset
select s1.mkveh('cx_eqp',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as veqp \gset
select s1.mkveh('cx_wo',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vwo \gset
select s1.mkveh('cx_ok',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vok \gset
select s1.mkveh('cx_two',s1.orgb(),'b5000000-0000-0000-0000-0000000000a1','reserved') as vtwo \gset
update vehicles set documentation_valid=false where id in (:'vdoc',:'vtwo');
update vehicles set has_blocking_damage=true where id=:'vdmg';
update vehicles set missing_safety_equipment='{Extintor}' where id=:'veqp';
insert into f1_case select 'S1CX_DOC','blocked',s1.mkres('cx_doc',s1.orgb(),s1.uid('s1drvb'),:'vdoc','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours');
insert into f1_case select 'S1CX_DMG','maintenance',s1.mkres('cx_dmg',s1.orgb(),s1.uid('s1drvb'),:'vdmg','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours');
insert into f1_case select 'S1CX_EQP','maintenance',s1.mkres('cx_eqp',s1.orgb(),s1.uid('s1drvb'),:'veqp','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours');
insert into f1_case select 'S1CX_WO','maintenance',s1.mkres('cx_wo',s1.orgb(),s1.uid('s1drvb'),:'vwo','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours');
insert into f1_case select 'S1CX_OK','available',s1.mkres('cx_ok',s1.orgb(),s1.uid('s1drvb'),:'vok','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours');
insert into f1_case select 'S1CX_TWO','reserved',s1.mkres('cx_two',s1.orgb(),s1.uid('s1drvb'),:'vtwo','confirmed',now()+interval '1 day',now()+interval '1 day 2 hours');
select s1.mkres('cx_two_b',s1.orgb(),s1.uid('s1drvb'),:'vtwo','confirmed',now()+interval '3 days',now()+interval '3 days 2 hours') \gset
set local session_replication_role=replica;
insert into fm_work_orders(organization_id,vehicle_id,kind,status,description,supplier,quote_total,scheduled_start,scheduled_end,created_by,budget_pending)
values(s1.orgb(),:'vwo','corrective','in_progress','F1 OS em andamento','F1 Oficina',100,now()-interval '1 hour',now()+interval '2 hours',s1.uid('s1adminb'),false);
set local session_replication_role=origin;
select 'RESULT|S1-04|'||c.plate as caso,
 pg_temp.f1_as(s1.uid('s1drvb'), format('select cancel_reservation(%L,%L)::text', c.res, 'F1 desisti')) as chamada,
 c.want as esperado
from f1_case c order by c.plate;
select 'RESULT|S1-04|'||c.plate as caso, c.want as esperado, v.status::text as obtido, r.status::text as reserva,
 v.documentation_valid, v.has_blocking_damage, case when v.status::text=c.want and r.status='cancelled' then 'PASS' else 'FAIL' end as veredito
from f1_case c join reservations r on r.id=c.res join vehicles v on v.id=r.vehicle_id order by 1;
rollback;
