-- C2: tarefas (0218, 0225, 0226) com usuarios reais (role authenticated + claims sub). Org T1A/T1B.
\set ON_ERROR_STOP on
\pset pager off
begin;
select t1.mkveh(k,u) from (values ('tk_sp','sp'),('tk_cp','cp'),('tk_b','b'),('tk_sp2','sp'),('tk_cp2','cp')) t(k,u);
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orga(),t1.vid('tk_sp'),'cleaning','T1 NOTA INTERNA SP') returning id \gset
insert into t1.t values('task_sp',:'id');
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orga(),t1.vid('tk_cp'),'cleaning','T1 NOTA INTERNA CP') returning id \gset
insert into t1.t values('task_cp',:'id');
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orgb(),t1.vid('tk_b'),'cleaning','T1 NOTA INTERNA ORG B') returning id \gset
insert into t1.t values('task_b',:'id');
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orga(),t1.vid('tk_sp2'),'fuel','T1 NOTA SP2') returning id \gset
insert into t1.t values('task_sp2',:'id');
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orga(),t1.vid('tk_cp2'),'fuel','T1 NOTA CP2') returning id \gset
insert into t1.t values('task_cp2',:'id');
commit;

\echo === C2-01 privilegios de tabela (pos-CONTRACT 0218/0226)
select r.rolname, has_table_privilege(r.rolname,'public.workflow_tasks','SELECT') sel, has_table_privilege(r.rolname,'public.workflow_tasks','INSERT') ins,
 has_table_privilege(r.rolname,'public.workflow_tasks','UPDATE') upd, has_table_privilege(r.rolname,'public.workflow_tasks','DELETE') del,
 (select string_agg(column_name||':'||privilege_type,',') from information_schema.column_privileges c where c.table_schema='public' and c.table_name='workflow_tasks' and c.grantee=r.rolname and privilege_type<>'SELECT') col_write_grants
from pg_roles r where r.rolname in ('anon','authenticated','service_role') order by 1;

\echo === C2-02 leitura de notas internas e escrita direta por papel (matriz)
create temp table c2(actor text, role text, read_sp text, read_cp text, read_b text, view_sp text, ins text, upd_status text, upd_assign text, upd_notes text, del text);
grant all on c2 to authenticated;
do $$
declare a text; sp uuid:=t1.tid('task_sp'); cp uuid:=t1.tid('task_cp'); b uuid:=t1.tid('task_b'); vsp uuid:=t1.vid('tk_sp'); o uuid; rr text;
begin
 for a in select k from t1.u order by k loop
  o:=(select organization_id from profiles where id=t1.uid(a)); rr:=(select role::text from profiles where id=t1.uid(a));
  insert into c2 values(a, rr,
   t1.as_user(a, format($q$select count(*)||':'||coalesce(string_agg(notes,','),'') from workflow_tasks where id=%L$q$, sp)),
   t1.as_user(a, format($q$select count(*)||':'||coalesce(string_agg(notes,','),'') from workflow_tasks where id=%L$q$, cp)),
   t1.as_user(a, format($q$select count(*)||':'||coalesce(string_agg(notes,','),'') from workflow_tasks where id=%L$q$, b)),
   t1.as_user(a, format($q$select count(*)||':'||coalesce(string_agg(notes,','),'') from fm_managed_workflow_tasks where id=%L$q$, sp)),
   t1.as_user(a, format($q$with x as (insert into workflow_tasks(organization_id,vehicle_id,type,notes) values(%L,%L,'cleaning','T1 insert direto') returning 1) select count(*) from x$q$, o, vsp)),
   t1.as_user(a, format($q$with x as (update workflow_tasks set status='done' where id=%L returning 1) select count(*) from x$q$, sp)),
   t1.as_user(a, format($q$with x as (update workflow_tasks set assigned_to=auth.uid() where id=%L returning 1) select count(*) from x$q$, sp)),
   t1.as_user(a, format($q$with x as (update workflow_tasks set notes='alterada' where id=%L returning 1) select count(*) from x$q$, sp)),
   t1.as_user(a, format($q$with x as (delete from workflow_tasks where id=%L returning 1) select count(*) from x$q$, sp)));
 end loop;
end $$;
select * from c2 order by role, actor;
\echo --- anon
begin;
set local role anon;
do $$ begin perform count(*) from workflow_tasks; raise notice 'anon SELECT executou'; exception when others then raise notice 'anon SELECT: % %', sqlstate, sqlerrm; end $$;
do $$ begin update workflow_tasks set status='done' where true; raise notice 'anon UPDATE executou'; exception when others then raise notice 'anon UPDATE: % %', sqlstate, sqlerrm; end $$;
do $$ begin insert into workflow_tasks(organization_id,vehicle_id,type) values('7a000000-0000-0000-0000-00000000000a',gen_random_uuid(),'cleaning'); raise notice 'anon INSERT executou'; exception when others then raise notice 'anon INSERT: % %', sqlstate, sqlerrm; end $$;
rollback;
\echo --- estado das tarefas apos a matriz (nada deve ter mudado)
select t.k, w.status, w.assigned_to, w.notes, (select count(*) from workflow_tasks x where x.vehicle_id=w.vehicle_id) n_on_vehicle from t1.t t join workflow_tasks w on w.id=t.id order by t.k;

\echo === C2-03 atribuicao pelo comando auditado fm_claim_workflow_task
select 'emp claim sp' c, t1.as_user('t1drvok', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_sp')))
union all select 'security claim sp', t1.as_user('t1sec', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_sp')))
union all select 'deact claim sp', t1.as_user('t1deact', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_sp')))
union all select 'fmcp claim sp (fora da unidade)', t1.as_user('t1fmcp', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_sp')))
union all select 'adminB claim sp (outra org)', t1.as_user('t1adminb', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_sp')))
union all select 'fmsp claim sp (no escopo)', t1.as_user('t1fmsp', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_sp')))
union all select 'fmall claim sp (ja atribuida)', t1.as_user('t1fmall', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_sp')))
union all select 'maint claim cp2', t1.as_user('t1maint', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_cp2')))
union all select 'admin claim cp', t1.as_user('t1admin', format('select fm_claim_workflow_task(%L)::text', t1.tid('task_cp')));
select t.k, w.assigned_to = t1.uid('t1fmsp') by_fmsp, w.assigned_to = t1.uid('t1maint') by_maint, w.assigned_to = t1.uid('t1admin') by_admin, w.status,
 (select string_agg(a.action||' actor='||(select k from t1.u where id=a.actor_id),';') from audit_log a where a.entity_id=w.id and a.action='workflow_task.claimed') audit
from t1.t t join workflow_tasks w on w.id=t.id order by t.k;

\echo === C2-04 conclusao de tarefa preservada (complete_workflow_task)
select 'emp complete sp2' c, t1.as_user('t1drvok', format('select complete_workflow_task(%L)::text', t1.tid('task_sp2')))
union all select 'fmcp complete sp2 (fora)', t1.as_user('t1fmcp', format('select complete_workflow_task(%L)::text', t1.tid('task_sp2')))
union all select 'fmsp complete sp2', t1.as_user('t1fmsp', format('select complete_workflow_task(%L)::text', t1.tid('task_sp2')));
select t.k, w.status, w.resolved_at is not null resolved from t1.t t join workflow_tasks w on w.id=t.id where t.k='task_sp2';

\echo === C2-05 aprovacao de pedido vencido recusada (0218); pedido no prazo aprovado
begin;
select t1.mkveh('ap_exp','sp'); select t1.mkveh('ap_ok','sp');
select t1.mkres('ap_exp','t1drvok','ap_exp','pending_approval',now()-interval '3 hours',now()-interval '5 minutes');
select t1.mkres('ap_ok','t1drvok','ap_ok','pending_approval',now()+interval '1 day',now()+interval '1 day 2 hours');
commit;
select 'approve vencido (fmsp)' c, t1.as_user('t1fmsp', format('select approve_reservation(%L)::text', t1.rid('ap_exp')))
union all select 'approve vencido (admin)', t1.as_user('t1admin', format('select approve_reservation(%L)::text', t1.rid('ap_exp')))
union all select 'approve no prazo fora do escopo (fmcp)', t1.as_user('t1fmcp', format('select approve_reservation(%L)::text', t1.rid('ap_ok')))
union all select 'approve no prazo (fmsp)', t1.as_user('t1fmsp', format('select approve_reservation(%L)::text', t1.rid('ap_ok')));
select x.k, r.status, v.status from t1.r x join reservations r on r.id=x.id join vehicles v on v.id=r.vehicle_id where x.k in ('ap_exp','ap_ok');
