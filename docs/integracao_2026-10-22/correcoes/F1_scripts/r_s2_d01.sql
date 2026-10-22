-- F1 / S2-D01: direct INSERT into inspection_photos by the inspector (lucas, own inspection b16613dd) must be refused, while
-- the official path (fm_photo_begin -> object -> fm_photo_attest -> fm_photo_finalize -> fm_photo_link) still links.
-- Everything in BEGIN..ROLLBACK (storage.objects rows are simulated as the Storage API writes them: owner + metadata).
-- Run as: cat f1_lib.sql r_s2_d01.sql | psql
\set ON_ERROR_STOP 1
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org, 'b16613dd-6012-4b63-8843-7a02680f5de2'::uuid as ins \gset
select performed_by as lucas from inspections where id=:'ins' \gset
create temp table f1_out(caso text, esperado text, obtido text) on commit drop;
grant all on f1_out to authenticated;
insert into f1_out select 'RESULT|S2-D01|priv_insert_authenticated','false',has_table_privilege('authenticated','public.inspection_photos','INSERT')::text;
insert into f1_out select 'RESULT|S2-D01|priv_insert_anon','false',has_table_privilege('anon','public.inspection_photos','INSERT')::text;
-- (1) bypass: object without journal + direct insert
select format('%s/%s/interior_f1_bypass_%s.png', :'org', :'ins', extract(epoch from clock_timestamp())::bigint) as junk \gset
insert into storage.objects(bucket_id,name,owner,metadata) values('vehicle-photos',:'junk',:'lucas','{"size":900,"mimetype":"image/png"}');
insert into f1_out select 'RESULT|S2-D01|insert_direto_lucas','ERR:permission denied for table inspection_photos',
 pg_temp.f1_as(:'lucas',format('insert into inspection_photos(organization_id,inspection_id,angle,storage_path) values(%L,%L,''interior'',%L) returning id::text',:'org',:'ins',:'junk'));
-- (2) official path still works (new code: begin -> upload -> attest (service role) -> finalize)
select encode(sha256(convert_to('F1 S2-D01 '||clock_timestamp()::text,'UTF8')),'hex') as sha \gset
select pg_temp.f1_as(:'lucas',format('select fm_photo_begin(''inspection'',%L,''interior'',%L,14000,''image/png'')::text',:'ins',:'sha')) as began \gset
select substr(:'began',4)::jsonb->>'id' as jid, substr(:'began',4)::jsonb->>'path' as jpath \gset
insert into storage.objects(bucket_id,name,owner,metadata) values('vehicle-photos',:'jpath',:'lucas','{"size":14000,"mimetype":"image/png"}');
set local role service_role;
select fm_photo_attest(:'jid'::uuid,:'lucas'::uuid,:'sha',14000,'image/png');
reset role;
insert into f1_out select 'RESULT|S2-D01|caminho_oficial_finalize','OK:',pg_temp.f1_as(:'lucas',format('select fm_photo_finalize(%L::uuid,%L)::text',:'jid',:'sha'));
insert into f1_out select 'RESULT|S2-D01|caminho_oficial_vinculo','1',(select count(*)::text from inspection_photos where storage_path=:'jpath');
insert into f1_out select 'RESULT|S2-D01|caminho_oficial_jornal','linked',(select state from fm_photo_uploads where id=:'jid');
insert into f1_out select 'RESULT|S2-D01|bypass_sem_vinculo','0',(select count(*)::text from inspection_photos where storage_path=:'junk');
select caso, esperado, obtido, case when obtido=esperado then 'PASS' else 'FAIL' end veredito from f1_out order by caso;
rollback;
