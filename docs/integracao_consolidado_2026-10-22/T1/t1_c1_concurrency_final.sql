-- estado final apos a concorrencia: varredura final da Org T1B e conferencia global
\pset pager off
begin; set local role service_role; select fm_release_expired_reservations('7b000000-0000-0000-0000-00000000000b',1000) final_sweep; commit;
select r.status, coalesce(r.cancellation_reason,'-') reason, v.status vstatus, (select count(*)>0 from inspections i where i.reservation_id=r.id) has_insp, count(*)
from t1.r x join reservations r on r.id=x.id join vehicles v on v.id=r.vehicle_id where x.k like 'cc_%' group by 1,2,3,4 order by 1,2,3,4;
select 'duplicated release audits' c, count(*) from (select entity_id from audit_log where organization_id='7b000000-0000-0000-0000-00000000000b' and action='reservation.no_show_released' group by 1 having count(*)>1) d
union all select 'released with activity', count(*) from reservations r where r.organization_id='7b000000-0000-0000-0000-00000000000b' and r.cancellation_reason in ('no_show_auto','expired_unapproved') and (exists(select 1 from inspections i where i.reservation_id=r.id) or exists(select 1 from fm_gate_events g where g.reservation_id=r.id) or exists(select 1 from fm_key_events k where k.reservation_id=r.id))
union all select 'cancelled w/o activity but vehicle not available', count(*) from t1.r x join reservations r on r.id=x.id join vehicles v on v.id=r.vehicle_id where x.k like 'cc_%' and r.status='cancelled' and not exists(select 1 from inspections i where i.reservation_id=r.id) and v.status<>'available';
