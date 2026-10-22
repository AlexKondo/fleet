-- C4: excecao operacional (0211) + resumo para o solicitante (0222). Usuarios reais (role authenticated + claims).
\set ON_ERROR_STOP on
\pset pager off
begin;
select t1.mkveh(k,u) from (values ('ex_sp','sp'),('ex_cp','cp'),('ex_cp2','cp'),('ex_sp_other','sp')) t(k,u);
select t1.mkres('ex_sp','t1drvok','ex_sp','confirmed',now()-interval '10 minutes',now()+interval '2 hours');
select t1.mkres('ex_cp','t1drvok','ex_cp','confirmed',now()-interval '10 minutes',now()+interval '2 hours');
select t1.mkres('ex_cp2','t1drvok','ex_cp2','confirmed',now()-interval '10 minutes',now()+interval '2 hours');
select t1.mkres('ex_sp_other','t1req2','ex_sp_other','confirmed',now()-interval '10 minutes',now()+interval '2 hours');
update vehicles set status='reserved' where id in (t1.vid('ex_sp'),t1.vid('ex_cp'),t1.vid('ex_cp2'),t1.vid('ex_sp_other'));
commit;
select id as rsp from t1.r where k='ex_sp' \gset
select id as rcp from t1.r where k='ex_cp' \gset
select id as rcp2 from t1.r where k='ex_cp2' \gset
select id as rother from t1.r where k='ex_sp_other' \gset

\echo === C4-01 SP (gate_visual): Seguranca registra "nao saiu"
select 'solicitante registra a propria excecao' c, t1.as_user('t1drvok', format($q$select fm_operation_exception(%L,'not_departed','T1 MOTIVO INTERNO SIGILOSO',gen_random_uuid())::text$q$, :'rsp'))
union all select 'gestor fora do escopo (CP)', t1.as_user('t1fmcp', format($q$select fm_operation_exception(%L,'not_departed','T1 MOTIVO INTERNO SIGILOSO',gen_random_uuid())::text$q$, :'rsp'))
union all select 'Seguranca registra', t1.as_user('t1sec', format($q$select fm_operation_exception(%L,'not_departed','T1 MOTIVO INTERNO SIGILOSO',gen_random_uuid())::text$q$, :'rsp'));
select r.status, r.cancellation_reason, v.status vstatus,
 (select count(*) from fm_gate_events g where g.reservation_id=r.id) gate_rows, (select count(*) from inspections i where i.reservation_id=r.id) insp_rows,
 (select count(*) from fm_key_events k where k.reservation_id=r.id) key_rows
from reservations r join vehicles v on v.id=r.vehicle_id where r.id=:'rsp';

\echo === C4-02 visibilidade do resultado (rotulo) x motivo interno
select a c,
 t1.as_user(a, format($q$select fm_not_departed_reservations(array[%L,%L]::uuid[])::text$q$, :'rsp', :'rother')) rotulo,
 t1.as_user(a, format($q$select count(*)||':'||coalesce(string_agg(reason,','),'') from fm_operation_exceptions where reservation_id=%L$q$, :'rsp')) tabela_excecoes,
 t1.as_user(a, format($q$select count(*)||':'||coalesce(string_agg(cancellation_reason,','),'') from reservations where id=%L$q$, :'rsp')) reservations_cancellation_reason,
 t1.as_user(a, format($q$select count(*)||':'||coalesce(string_agg(body,' | '),'') from notifications where entity_id=%L and user_id=auth.uid()$q$, :'rsp')) notificacao_propria
from unnest(array['t1drvok','t1req2','t1fmsp','t1fmcp','t1fmall','t1sec','t1adminb','t1deact','t1emp']) a;

\echo === C4-03 Campinas (key_custody): custodia segue o fluxo existente de entrega/recebimento
select 'custodiante entrega a chave' c, t1.as_user('t1custcp', format($q$select fm_key_command(%L,'delivered',null,gen_random_uuid())::text$q$, :'rcp'))
union all select 'excecao com chave pendente', t1.as_user('t1custcp', format($q$select fm_operation_exception(%L,'not_departed','T1 nao saiu CP',gen_random_uuid())::text$q$, :'rcp'))
union all select 'custodiante RJ (outra unidade) recebe', t1.as_user('t1custrj', format($q$select fm_key_command(%L,'received',null,gen_random_uuid())::text$q$, :'rcp'))
union all select 'custodiante CP registra recebimento real', t1.as_user('t1custcp', format($q$select fm_key_command(%L,'received',null,gen_random_uuid())::text$q$, :'rcp'))
union all select 'excecao apos devolucao da chave', t1.as_user('t1custcp', format($q$select fm_operation_exception(%L,'not_departed','T1 nao saiu CP',gen_random_uuid())::text$q$, :'rcp'))
union all select 'departed_unrecorded em custodia', t1.as_user('t1sec', format($q$select fm_operation_exception(%L,'departed_unrecorded','T1 saiu sem registro',gen_random_uuid())::text$q$, :'rcp2'));
select k.kind, (select x from (values ('t1custcp'),('t1custrj')) t(x) where t1.uid(x)=k.actor_id) actor, k.reason from fm_key_events k where k.reservation_id=:'rcp' order by k.created_at;
select r.status, v.status vstatus, (select count(*) from fm_gate_events g where g.reservation_id=r.id) gate_rows, (select count(*) from inspections i where i.reservation_id=r.id) insp_rows
from reservations r join vehicles v on v.id=r.vehicle_id where r.id=:'rcp';

\echo === C4-04 Campinas: apos retirada digital, "nao saiu" e recusado (usa devolucao/recebimento)
select 'condutor prepara checklist' c, t1.as_user('t1drvok', format($q$select (fm_prepare_equipment_checklist(%L) is not null)::text$q$, :'rcp2'))
union all select 'custodiante entrega a chave', t1.as_user('t1custcp', format($q$select fm_key_command(%L,'delivered',null,gen_random_uuid())::text$q$, :'rcp2'))
union all select 'condutor faz retirada digital', t1.as_user('t1drvok', format($q$select record_pickup(%L,10010,80,null,false,null,'{}',false,false,'traveler')::text$q$, :'rcp2'))
union all select 'excecao nao saiu apos retirada', t1.as_user('t1custcp', format($q$select fm_operation_exception(%L,'not_departed','T1 nao saiu apos retirada',gen_random_uuid())::text$q$, :'rcp2'))
union all select 'gestor CP excecao apos retirada', t1.as_user('t1fmcp', format($q$select fm_operation_exception(%L,'not_departed','T1 nao saiu apos retirada',gen_random_uuid())::text$q$, :'rcp2'));
select r.status, v.status vstatus, (select count(*) from fm_operation_exceptions e where e.reservation_id=r.id) exc_rows from reservations r join vehicles v on v.id=r.vehicle_id where r.id=:'rcp2';
