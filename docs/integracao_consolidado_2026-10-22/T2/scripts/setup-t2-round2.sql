\set ON_ERROR_STOP on
-- T2 rodada 2 dos testes de queda: veículos TDA1C0x (SP) com perfil de equipamento + reservas g1..g5.
begin;
insert into t2.v values ('sp_g1','TDA1C01',1),('sp_g2','TDA1C02',1),('sp_g3','TDA1C03',1),('sp_g4','TDA1C04',1),('sp_g5','TDA1C05',1) on conflict do nothing;
insert into vehicles(organization_id,plate,category_id,status,odometer_km,fuel_level_percent,estimated_range_km,next_service_odometer_km,home_location_id,current_location_id,has_blocking_damage,documentation_valid,is_clean_exterior,is_clean_interior,name,color,next_service_date)
select '00000000-0000-0000-0000-000000000001',plate,'c1000000-0000-0000-0000-000000000001','available',10000,80,600,50000,'e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',false,true,true,true,'T2 '||k,'Branco',current_date+180 from t2.v where k like 'sp_g%' on conflict do nothing;
insert into fm_vehicle_units(vehicle_id,organization_id,unit_id) select v.id,'00000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001' from t2.v t join vehicles v on v.plate=t.plate where t.k like 'sp_g%' on conflict do nothing;
select t2.mk('g1','t2sp@t2-fotos.test','TDA1C01');
select t2.mk('g2','t2sp@t2-fotos.test','TDA1C02');
select t2.mk('g3','t2sp@t2-fotos.test','TDA1C03');
select t2.mk('g4','t2sp@t2-fotos.test','TDA1C04');
select t2.mk('g5','t2sp@t2-fotos.test','TDA1C05');
commit;
begin;
select set_config('request.jwt.claims', json_build_object('sub','16ddf868-9ee5-4447-930f-9801538eaa6a','role','authenticated')::text, true);
set local role authenticated;
select count(*) from (select fm_equipment_profile_save('vehicle', v.id,
  array(select id from safety_equipment_items where organization_id='00000000-0000-0000-0000-000000000001' and name in ('Extintor de Incêndio','Kit Primeiros Socorros') order by name),
  array(select id from safety_equipment_items where organization_id='00000000-0000-0000-0000-000000000001' and name='Cabo de Recarga Tipo 2'),
  true, 0, 'T2 equipamentos ficticios', gen_random_uuid())
from vehicles v where v.plate like 'TDA1C0%') x;
commit;
