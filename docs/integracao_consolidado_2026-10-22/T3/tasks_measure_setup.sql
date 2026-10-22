-- T3: veiculo proprio (placa T3M0001, unidade SP) + tarefa aberta de limpeza, para testar pela UI a atribuicao pelo dashboard
-- e a edicao auditada de medicoes. COMMIT (linhas proprias do T3).
begin;
with v as (
  insert into vehicles(id, organization_id, plate, category_id, status, odometer_km, fuel_level_percent, next_service_odometer_km, home_location_id, current_location_id,
    has_blocking_damage, documentation_valid, is_clean_exterior, is_clean_interior, name, color, next_service_date)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'T3M0001', 'c1000000-0000-0000-0000-000000000001', 'available', 15000, 70, 30000,
    'e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', false, true, false, true, 'T3 Jolion medicoes', 'Prata', current_date + 120)
  on conflict do nothing returning id)
, u as (insert into fm_vehicle_units(vehicle_id, organization_id, unit_id) select id, '00000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001' from v returning vehicle_id)
insert into workflow_tasks(organization_id, vehicle_id, type, notes, priority) select '00000000-0000-0000-0000-000000000001', vehicle_id, 'cleaning', 'T3 tarefa para atribuicao pelo dashboard', 'normal' from u;
commit;
select v.id, v.odometer_km, t.id task from vehicles v left join workflow_tasks t on t.vehicle_id=v.id where v.plate='T3M0001';
