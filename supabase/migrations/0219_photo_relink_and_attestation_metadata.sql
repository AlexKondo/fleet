-- EXPAND: metadata-aware five-argument implementation and path-bound six-argument wrapper.
create or replace function public.fm_photo_attest(p_id uuid,p_actor uuid,p_sha256 text,p_size integer,p_mime text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j fm_photo_uploads%rowtype;o storage.objects%rowtype;
begin
 select * into j from fm_photo_uploads where id=p_id for update;
 if not found or j.uploaded_by is distinct from p_actor or not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=p_actor and p.organization_id=j.organization_id and coalesce(a.enabled,true)) then raise exception 'NOT_AUTHORIZED';end if;
 if j.sha256 is distinct from p_sha256 or j.size_bytes is distinct from p_size or j.mime_type is distinct from p_mime then raise exception 'PHOTO_INTEGRITY_MISMATCH';end if;
 select * into o from storage.objects where bucket_id='vehicle-photos' and name=j.storage_path;
 if not found or o.owner is distinct from j.uploaded_by or o.metadata is null or coalesce(o.metadata->>'size','') !~ '^[0-9]+$' or (o.metadata->>'size')::bigint<>j.size_bytes or lower(coalesce(o.metadata->>'mimetype','')) is distinct from j.mime_type then raise exception 'PHOTO_INTEGRITY_MISMATCH';end if;
 update fm_photo_uploads set server_verified_at=coalesce(server_verified_at,now()) where id=p_id;
end;$$;
revoke all on function public.fm_photo_attest(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.fm_photo_attest(uuid,uuid,text,integer,text) to service_role;

-- Bind server verification to the exact immutable object path that was downloaded.
-- Holding the journal lock makes a concurrent retry fail with a path mismatch, never attest another attempt.
create function public.fm_photo_attest(p_id uuid,p_actor uuid,p_sha256 text,p_size integer,p_mime text,p_path text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_path text;
begin
 select storage_path into current_path from fm_photo_uploads where id=p_id for update;
 if not found or current_path is distinct from p_path then raise exception 'PHOTO_ATTEMPT_CHANGED';end if;
 perform public.fm_photo_attest(p_id,p_actor,p_sha256,p_size,p_mime);
end;$$;
revoke all on function public.fm_photo_attest(uuid,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.fm_photo_attest(uuid,uuid,text,integer,text,text) to service_role;
