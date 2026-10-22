-- T3: acoes de CONDUCAO x CNH no banco LOCAL, como o usuario (role authenticated + jwt claims). Tudo em uma transacao com ROLLBACK.
\set QUIET on
begin;
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into r;
    r := 'OK ' || coalesce(r, '');
  exception when others then
    r := 'ERRO ' || sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  return r;
end $$;
create temp table t3u as select k, (u->>'id')::uuid id from (select * from json_each(:'users'::json)) j(k, u);
create temp table t3out(step text, actor text, result text);

do $$
declare d record; v_sp uuid; v_cp uuid; rid uuid; res uuid; out text; cust uuid := (select id from t3u where k='t3cust'); sec uuid := (select id from t3u where k='t3sec');
begin
  select id into v_sp from vehicles where plate='GWM2H62';
  select id into v_cp from vehicles where plate='GWM6T36';
  for d in select k, id from t3u where k in ('t3valid','t3exp','t3null','t3admin','t3fmtotal','t3sec') order by k loop
    -- 1) reservar veiculo para conduzir (RPC)
    out := pg_temp.as_user(d.id, format($q$select create_vehicle_reservation(now()+interval '5 minutes', now()+interval '3 hours','Origem T3','Destino T3',10,1,false,'T3 teste CNH',%L::uuid,false)::text$q$, v_cp));
    insert into t3out values ('1 reservar (create_vehicle_reservation)', d.k, out);
    if out like 'OK %' then
      rid := substr(out, 4)::uuid;
      select id into res from reservations where id = rid or trip_request_id = rid limit 1;
      update reservations set status = 'confirmed' where id = res;
      -- 2) entrega de chaves pelo custodiante SEM CNH (unidade Campinas, key_custody): o que importa e a CNH do CONDUTOR
      out := pg_temp.as_user(cust, format($q$select fm_key_command(%L::uuid, 'delivered', null, gen_random_uuid())::text$q$, res));
      insert into t3out values ('2 chaves entregues (fm_key_command) por custodiante sem CNH', d.k, out);
      update reservations set status = 'cancelled' where id = res;
    end if;
    -- 4) saida pela portaria (unidade SP gate_visual): reserva criada pelo postgres para o condutor
    out := pg_temp.as_user(d.id, format($q$select create_vehicle_reservation(now()+interval '5 minutes', now()+interval '3 hours','Origem T3','Destino T3',10,1,false,'T3 teste portaria',%L::uuid,false)::text$q$, v_sp));
    if out like 'OK %' then
      rid := substr(out, 4)::uuid;
      select id into res from reservations where id = rid or trip_request_id = rid limit 1;
      update reservations set status = 'confirmed' where id = res;
      out := pg_temp.as_user(d.id, format($q$select record_pickup(%L::uuid, 9400, 80, 80, false, null, '{}', false, false, 'traveler')::text$q$, res));
      insert into t3out values ('3 retirada pelo condutor (record_pickup, SP)', d.k, out);
      out := pg_temp.as_user(sec, format($q$select fm_v3_command('gate.record', jsonb_build_object('reservation_id', %L::uuid, 'kind', 'departure'), gen_random_uuid())::text$q$, res));
      insert into t3out values ('4 saida pela portaria (gate.record departure) pela Seguranca', d.k, out);
      update reservations set status = 'cancelled' where id = res;
    end if;
    -- limpa reservas desta iteracao (o rollback final garante)
  end loop;
end $$;

select step, actor, left(result, 140) result from t3out order by actor, step;
rollback;
