\set ON_ERROR_STOP on
-- T2: veículos/reservas adicionais para os testes de queda (SP gate_visual).
begin;
insert into t2.v values ('sp_f1','TDA1A05',1),('sp_f2','TDA1A06',1),('sp_f3','TDA1A07',1),('sp_f4','TDA1A08',1) on conflict do nothing;
insert into vehicles(organization_id,plate,category_id,status,odometer_km,fuel_level_percent,estimated_range_km,next_service_odometer_km,home_location_id,current_location_id,has_blocking_damage,documentation_valid,is_clean_exterior,is_clean_interior,name,color,next_service_date)
select '00000000-0000-0000-0000-000000000001',plate,'c1000000-0000-0000-0000-000000000001','available',10000,80,600,50000,'e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',false,true,true,true,'T2 '||k,'Branco',current_date+180 from t2.v where k like 'sp_f%' on conflict do nothing;
insert into fm_vehicle_units(vehicle_id,organization_id,unit_id) select v.id,'00000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001' from t2.v t join vehicles v on v.plate=t.plate where t.k like 'sp_f%' on conflict do nothing;
select t2.mk('f1','t2sp@t2-fotos.test','TDA1A05');
select t2.mk('f2','t2sp@t2-fotos.test','TDA1A06');
select t2.mk('f3','t2sp@t2-fotos.test','TDA1A07');
select t2.mk('f4','t2sp@t2-fotos.test','TDA1A08');
commit;
select k,rid from t2.r order by k;
