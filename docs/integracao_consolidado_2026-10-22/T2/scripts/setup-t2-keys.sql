-- T2: custodiante (Patrícia, fictícia) entrega as chaves das reservas T2 de Campinas e Rio pelo comando real.
begin;
select set_config('request.jwt.claims', json_build_object('sub','3b3a4846-9caa-4969-b93a-cc975e926896','role','authenticated')::text, true);
set local role authenticated;
select fm_key_command('99d67805-9c74-4d81-a5cf-66df21e5fdc4','delivered',null,gen_random_uuid());
select fm_key_command('cb3d48f1-d37b-4e18-8717-5e4fe34259f2','delivered',null,gen_random_uuid());
commit;
