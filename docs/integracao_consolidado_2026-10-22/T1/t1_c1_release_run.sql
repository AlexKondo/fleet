-- C1: liberacao de vencidas ATIVA (0217 + 0213 + 0215). Sempre com p_organization_id (nunca toca orgs de outros agentes).
\set ON_ERROR_STOP on
\pset pager off
\set orga 7a000000-0000-0000-0000-00000000000a
\set orgb 7b000000-0000-0000-0000-00000000000b
\echo === C1-00 estado das configuracoes
select t1.orga() org, exists(select 1 from organization_settings where organization_id=t1.orga()) orga_has_settings,
       (select auto_release_enabled from organization_settings where organization_id=t1.orgb()) orgb_auto_release,
       (select no_show_release_grace_minutes from organization_settings where organization_id=t1.orgb()) orgb_grace,
       (select column_default from information_schema.columns where table_schema='public' and table_name='organization_settings' and column_name='auto_release_enabled') col_default;

\echo === C1-01 somente service_role executa (authenticated/anon negados)
begin;
select 'admin', t1.as_user('t1admin', format($q$select fm_release_expired_reservations(%L,10)::text$q$, t1.orga()));
select 'fmall', t1.as_user('t1fmall', format($q$select fm_release_expired_reservations(%L,10)::text$q$, t1.orga()));
set local role anon;
do $$ begin perform fm_release_expired_reservations(null,1); raise notice 'anon EXECUTOU'; exception when others then raise notice 'anon: % %', sqlstate, sqlerrm; end $$;
reset role;
select has_function_privilege('authenticated','fm_release_expired_reservations(uuid,integer)','execute') auth_exec,
       has_function_privilege('anon','fm_release_expired_reservations(uuid,integer)','execute') anon_exec,
       has_function_privilege('service_role','fm_release_expired_reservations(uuid,integer)','execute') svc_exec;
commit;

\echo === C1-02 primeira execucao Org A (sem linha de settings => default ATIVO, tolerancia 60)
begin;
set local role service_role;
select fm_release_expired_reservations(:'orga',200) as run1;
reset role;
commit;
select r.k, res.status, res.cancellation_reason, v.status vstatus, v.has_blocking_damage dmg, v.documentation_valid doc,
       (select count(*) from audit_log a where a.entity_id=res.id and a.action='reservation.no_show_released') audits,
       (select count(*) from notifications n where n.entity_id=res.id and n.title in ('Reserva não retirada','Solicitação de reserva expirada')) notifs
from t1.r r join reservations res on res.id=r.id join vehicles v on v.id=res.vehicle_id where r.k like 'rl%' order by r.k;

\echo === C1-03 idempotencia (segunda e terceira execucao)
begin; set local role service_role; select fm_release_expired_reservations(:'orga',200) as run2; reset role; commit;
begin; set local role service_role; select fm_release_expired_reservations(:'orga',200) as run3; reset role; commit;
select count(*) total_audits_released_t1a from audit_log where organization_id=t1.orga() and action='reservation.no_show_released';

\echo === C1-04 isolamento: execucao da Org A nao tocou a Org B
select 'rlb_conf' k, status from reservations where id=t1.rid('rlb_conf');

\echo === C1-05 Org B com linha de settings default (ativo)
begin; set local role service_role; select fm_release_expired_reservations(:'orgb',200) as runb; reset role; commit;
select 'rlb_conf' k, res.status, res.cancellation_reason, v.status from reservations res join vehicles v on v.id=res.vehicle_id where res.id=t1.rid('rlb_conf');

\echo === C1-06 opt-out explicito auto_release_enabled=false (transacao desfeita ao final)
begin;
update organization_settings set auto_release_enabled=false where organization_id=t1.orgb();
select t1.mkres('rlb_opt','t1drvb','rlb_opt','confirmed',now()-interval '5 hours',now()-interval '3 hours');
update vehicles set status='reserved' where id=t1.vid('rlb_opt');
set local role service_role;
select fm_release_expired_reservations(:'orgb',200) as run_optout;
reset role;
select 'rlb_opt' k, res.status, v.status from reservations res join vehicles v on v.id=res.vehicle_id where res.id=t1.rid('rlb_opt');
rollback;
delete from t1.r where k='rlb_opt';

\echo === C1-07 tolerancia 0 / 1440 (transacoes desfeitas)
begin;
update organization_settings set no_show_release_grace_minutes=0 where organization_id=t1.orgb();
select t1.mkres('rlb_g0_past','t1drvb','rlb_g0','confirmed',now()-interval '2 hours',now()-interval '1 minute');
select t1.mkres('rlb_g0_fut','t1drvb','rlb_g0','confirmed',now()+interval '1 day',now()+interval '1 day 1 minute');
set local role service_role; select fm_release_expired_reservations(:'orgb',200) as run_grace0; reset role;
select 'grace0 ended 1min ago' c, status from reservations where id=t1.rid('rlb_g0_past')
union all select 'grace0 future', status from reservations where id=t1.rid('rlb_g0_fut');
rollback;
begin;
update organization_settings set no_show_release_grace_minutes=1440 where organization_id=t1.orgb();
select t1.mkres('rlb_g1440_23h','t1drvb','rlb_g1440a','confirmed',now()-interval '26 hours',now()-interval '23 hours');
select t1.mkres('rlb_g1440_25h','t1drvb','rlb_g1440b','confirmed',now()-interval '28 hours',now()-interval '25 hours');
set local role service_role; select fm_release_expired_reservations(:'orgb',200) as run_grace1440; reset role;
select 'grace1440 ended 23h ago' c, status from reservations where id=t1.rid('rlb_g1440_23h')
union all select 'grace1440 ended 25h ago', status from reservations where id=t1.rid('rlb_g1440_25h');
rollback;
delete from t1.r where k like 'rlb_g%';
select 'settings B restaurado' c, auto_release_enabled, no_show_release_grace_minutes from organization_settings where organization_id=t1.orgb();
