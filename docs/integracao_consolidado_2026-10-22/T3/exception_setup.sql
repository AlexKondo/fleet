-- T3: prepara (COMMIT) uma reserva propria de t3valid encerrada com excecao 'not_departed' e motivo INTERNO marcado,
-- para conferir na UI que o solicitante ve o rotulo proprio e NAO ve o motivo. Insercao direta como postgres (atalho de teste,
-- o fluxo real e o comando da Seguranca/custodia); a tabela e append-only, a linha permanece no banco local.
begin;
create temp table t3u as select k, (u->>'id')::uuid id from (select * from json_each(:'users'::json)) j(k, u);
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into r;
  perform set_config('role', 'postgres', true);
  return r;
end $$;
do $$
declare rid uuid; res uuid; v uuid := (select id from vehicles where plate='GWM9J29'); drv uuid := (select id from t3u where k='t3valid');
  sec uuid := (select id from seedv.u where k='security');
begin
  rid := pg_temp.as_user(drv, format($q$select create_vehicle_reservation(now()+interval '2 days', now()+interval '2 days 4 hours','Origem T3 EXC','Destino T3 EXC',10,1,false,'T3 teste rotulo excecao',%L::uuid,false)::text$q$, v))::uuid;
  select id into res from reservations where id = rid or trip_request_id = rid limit 1;
  update reservations set status = 'cancelled' where id = res;
  insert into fm_operation_exceptions(organization_id, reservation_id, vehicle_id, unit_id, workflow, outcome, reason, actor_id, actor_role, reservation_status_before, vehicle_status_before, vehicle_status_after)
  values ('00000000-0000-0000-0000-000000000001', res, v, 'd1000000-0000-0000-0000-000000000003', 'key_custody', 'not_departed', 'MOTIVO-INTERNO-T3-SIGILOSO', sec, 'security', 'confirmed', 'available', 'available');
  raise notice 'T3 reserva excecao: %', res;
end $$;
commit;
