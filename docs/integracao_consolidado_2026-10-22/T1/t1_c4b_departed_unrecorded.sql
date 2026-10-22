-- C4b: documenta o outro desfecho da 0211 (departed_unrecorded) para separar de "nao saiu" (0222)
\pset pager off
begin;
select t1.mkveh('ex_du','sp');
select t1.mkres('ex_du','t1drvok','ex_du','confirmed',now()-interval '3 hours',now()-interval '1 minute');
update vehicles set status='reserved' where id=t1.vid('ex_du');
commit;
select 'gestor tenta departed_unrecorded' c, t1.as_user('t1fmall', format($q$select fm_operation_exception(%L,'departed_unrecorded','T1 saiu sem registro',gen_random_uuid())::text$q$, t1.rid('ex_du')))
union all select 'Seguranca registra departed_unrecorded', t1.as_user('t1sec', format($q$select fm_operation_exception(%L,'departed_unrecorded','T1 saiu sem registro',gen_random_uuid())::text$q$, t1.rid('ex_du')));
select r.status, v.status vstatus, (select string_agg(kind||':'||reason,',') from fm_gate_events g where g.reservation_id=r.id) gate_rows,
 (select count(*) from inspections i where i.reservation_id=r.id) insp_rows,
 t1.as_user('t1drvok', format('select fm_not_departed_reservations(array[%L]::uuid[])::text', r.id)) rotulo_nao_saiu
from reservations r join vehicles v on v.id=r.vehicle_id where r.id=t1.rid('ex_du');
