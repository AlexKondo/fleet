-- C6/C7 fixture: reservas para CNH x acesso, fluxos SP/Campinas/Rio, avaria, OS. Somente linhas T1.
\set ON_ERROR_STOP on
begin;
select t1.mkveh(k,u) from (values
 ('cnh_sp_exp','sp'),('cnh_sp_null','sp'),('cnh_cp_exp','cp'),('cnh_sp_ok','sp'),('cnh_gate_late','sp'),('adm_self','sp'),('pend_adm','sp'),('pend_fm','cp'),('host','sp'),
 ('ops_sp','sp'),('ops_beh','sp'),('ops_cp','cp'),('ops_rj','rj'),('dmg_sp','sp'),('wo_sp','sp'),('iso_sp','sp'),('iso_cp','cp'),('iso_b','b')) t(k,u);
select t1.mkres('cnh_sp_exp','t1drvexp','cnh_sp_exp','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('cnh_sp_null','t1drvnull','cnh_sp_null','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('cnh_cp_exp','t1drvexp','cnh_cp_exp','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('cnh_sp_ok','t1drvok','cnh_sp_ok','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('cnh_gate_late','t1req2','cnh_gate_late','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('adm_self','t1adminnocnh','adm_self','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('pend_adm','t1drvok','pend_adm','pending_approval',now()+interval '1 day',now()+interval '1 day 2 hours');
select t1.mkres('pend_fm','t1drvok','pend_fm','pending_approval',now()+interval '1 day',now()+interval '1 day 2 hours');
select t1.mkres('host','t1drvok','host','confirmed',now()+interval '2 days',now()+interval '2 days 3 hours');
select t1.mkres('ops_sp','t1drvok','ops_sp','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('ops_beh','t1drvok','ops_beh','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('ops_cp','t1drvok','ops_cp','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('ops_rj','t1drvok','ops_rj','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('dmg_sp','t1drvok','dmg_sp','confirmed',now()-interval '10 minutes',now()+interval '3 hours');
select t1.mkres('iso_sp_pend','t1drvok','iso_sp','pending_approval',now()+interval '3 days',now()+interval '3 days 2 hours');
select t1.mkres('iso_cp_pend','t1drvok','iso_cp','pending_approval',now()+interval '3 days',now()+interval '3 days 2 hours');
select t1.mkres('iso_b_pend','t1drvb','iso_b','pending_approval',now()+interval '3 days',now()+interval '3 days 2 hours');
update vehicles set status='reserved' where id in (select id from t1.v where k in ('cnh_sp_exp','cnh_sp_null','cnh_cp_exp','cnh_sp_ok','cnh_gate_late','adm_self','host','ops_sp','ops_beh','ops_cp','ops_rj','dmg_sp'));
update trip_requests set allow_carpool=true where id=(select trip_request_id from reservations where id=t1.rid('host'));
insert into fm_work_orders(organization_id,vehicle_id,kind,status,description,supplier,quote_total,scheduled_start,scheduled_end,created_by,budget_pending)
values(t1.orga(),t1.vid('wo_sp'),'corrective','scheduled','T1 OS DESCRICAO INTERNA','T1 Oficina',1234.56,now()+interval '5 days',now()+interval '6 days',t1.uid('t1admin'),false);
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orga(),t1.vid('iso_cp'),'cleaning','T1 iso cp') returning id \gset
insert into t1.t values('iso_task_cp',:'id');
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orga(),t1.vid('iso_sp'),'cleaning','T1 iso sp') returning id \gset
insert into t1.t values('iso_task_sp',:'id');
insert into workflow_tasks(organization_id,vehicle_id,type,notes) values (t1.orgb(),t1.vid('iso_b'),'cleaning','T1 iso b') returning id \gset
insert into t1.t values('iso_task_b',:'id');
-- antifraude: CNH de t1custrj marcada como lida por IA
update profiles set drivers_license_expiration_source='ai' where id=t1.uid('t1custrj');
commit;
