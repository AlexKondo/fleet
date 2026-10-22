-- C5b: historico de tentativas (0221) imutavel e fechado a usuarios
\pset pager off
begin;
do $$ begin update fm_photo_attempt_history set storage_path='x' where id=(select id from fm_photo_attempt_history where organization_id=t1.orga() limit 1); raise notice 'postgres UPDATE executou'; exception when others then raise notice 'postgres UPDATE: % %', sqlstate, sqlerrm; end $$;
do $$ begin delete from fm_photo_attempt_history where id=(select id from fm_photo_attempt_history where organization_id=t1.orga() limit 1); raise notice 'postgres DELETE executou'; exception when others then raise notice 'postgres DELETE: % %', sqlstate, sqlerrm; end $$;
do $$ begin delete from fm_photo_uploads where id=(select id from fm_photo_uploads where organization_id=t1.orga() limit 1); raise notice 'postgres DELETE jornal executou'; exception when others then raise notice 'postgres DELETE jornal: % %', sqlstate, sqlerrm; end $$;
rollback;
select 'fmsp le historico' c, t1.as_user('t1fmsp','select count(*)::text from fm_photo_attempt_history')
union all select 'fmsp le jornal', t1.as_user('t1fmsp','select count(*)::text from fm_photo_uploads')
union all select 'fmsp UPDATE jornal', t1.as_user('t1fmsp',$q$with x as (update fm_photo_uploads set server_verified_at=now() returning 1) select count(*)::text from x$q$)
union all select 'fmsp INSERT jornal', t1.as_user('t1fmsp',$q$with x as (insert into fm_photo_uploads(organization_id,uploaded_by,target_kind,target_id,sha256,size_bytes,mime_type,storage_path) values('7a000000-0000-0000-0000-00000000000a',auth.uid(),'vehicle',gen_random_uuid(),repeat('a',64),1,'image/jpeg','x') returning 1) select count(*)::text from x$q$);
select count(*) attempts_t1, count(distinct upload_id) uploads from fm_photo_attempt_history where organization_id=t1.orga();
