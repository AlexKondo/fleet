\set ON_ERROR_STOP on
-- T2: reservas próprias (confirmadas, janela aberta agora) + perfis de equipamento fictícios nos veículos T2.
begin;
create table if not exists t2.r(k text primary key, rid uuid, vid uuid, req uuid);
create or replace function t2.mk(code text, req_email text, p_plate text) returns void language plpgsql as $$
declare t uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); u uuid; v uuid;
begin
 if exists(select 1 from t2.r where k=code) then return; end if;
 select id into u from auth.users where email=req_email; select id into v from vehicles where vehicles.plate=p_plate;
 insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification,allow_carpool,created_at)
  values(t,'00000000-0000-0000-0000-000000000001',u,now()-interval '20 minutes',now()+interval '8 hours','Matriz Faria Lima','Centro Técnico Campinas',98,1,false,'T2 teste de fotos '||code,false,now()-interval '1 day');
 insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at,created_at,approved_by,approved_at)
  values(r,'00000000-0000-0000-0000-000000000001',v,t,'confirmed',now()-interval '20 minutes',now()+interval '8 hours',now()-interval '1 day','16ddf868-9ee5-4447-930f-9801538eaa6a',now()-interval '1 day');
 insert into t2.r values(code,r,v,u);
end $$;
select t2.mk('sp1','t2sp@t2-fotos.test','TDA1A02');
select t2.mk('sp2','t2sp@t2-fotos.test','TDA1A03');
select t2.mk('camp','t2camp@t2-fotos.test','TDA2A02');
select t2.mk('rio','t2rio@t2-fotos.test','TDA3A02');
commit;
-- perfis de equipamento (admin, via RPC real)
begin;
select set_config('request.jwt.claims', json_build_object('sub','16ddf868-9ee5-4447-930f-9801538eaa6a','role','authenticated')::text, true);
set local role authenticated;
select fm_equipment_profile_save('vehicle', v.id,
  array(select id from safety_equipment_items where organization_id='00000000-0000-0000-0000-000000000001' and name in ('Extintor de Incêndio','Kit Primeiros Socorros') order by name),
  array(select id from safety_equipment_items where organization_id='00000000-0000-0000-0000-000000000001' and name='Cabo de Recarga Tipo 2'),
  true, 0, 'T2 equipamentos ficticios', gen_random_uuid())
from vehicles v where v.plate in ('TDA1A02','TDA1A03','TDA2A02','TDA3A02');
commit;
select k, rid, (select plate from vehicles where id=vid) from t2.r order by k;
select target_id, enabled, cardinality(required_ids), cardinality(optional_ids) from fm_equipment_profiles;
