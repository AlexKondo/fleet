begin;
select set_config('request.jwt.claims', json_build_object('sub','16ddf868-9ee5-4447-930f-9801538eaa6a','role','authenticated')::text, true);
set local role authenticated;
select fm_equipment_profile_save('vehicle', v.id,
  array(select id from safety_equipment_items where organization_id='00000000-0000-0000-0000-000000000001' and name in ('Extintor de Incêndio','Kit Primeiros Socorros') order by name),
  array(select id from safety_equipment_items where organization_id='00000000-0000-0000-0000-000000000001' and name='Cabo de Recarga Tipo 2'),
  true, 0, 'T2 equipamentos ficticios', gen_random_uuid())
from vehicles v where v.plate in ('TDA1A05','TDA1A06','TDA1A07','TDA1A08');
commit;
