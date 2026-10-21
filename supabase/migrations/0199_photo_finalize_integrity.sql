-- Pacote 01 correction DEF-02 (DEC-03 integrity): fm_photo_finalize linked any object that merely existed at the journal path,
-- so bytes different from the declared SHA-256 (and a 2 MB object declared as 74 B) were linked and the journal said 'linked'.
-- What SQL can verify (and now does, before linking):
--  * the Storage object exists in bucket vehicle-photos at the journal path, which is content-addressed (<..>_<sha256>.<ext>);
--  * storage.objects.metadata.size == journal size_bytes; metadata.mimetype == journal mime_type;
--  * storage.objects.owner == journal uploaded_by == auth.uid() (path ownership; nobody else's object can be linked);
--  * optional client-declared hash (new 2-arg overload) must equal the journal hash, also for an already linked row
--    (no relinking with a different hash). Mismatch -> PHOTO_INTEGRITY_MISMATCH / PHOTO_HASH_MISMATCH; nothing is linked,
--    the object is preserved (no delete, DEC-03) and the journal stays 'pending' (visible in fm_photo_pending).
-- LIMIT: the SHA-256 of the stored bytes cannot be computed in SQL (Storage keeps bytes outside Postgres; metadata.eTag is an
-- MD5 for single-part uploads and is not comparable with the journal SHA-256). Same-size different-bytes is therefore not
-- detectable here; the proposed server-side step is in the FIX-SQL report (service-role hash verification after upload).
-- Deploy order: this migration BEFORE the app version that calls fm_photo_finalize(p_id,p_sha256) (expand).
create or replace function public.fm_photo_link(p_id uuid,p_declared_sha256 text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row fm_photo_uploads%rowtype;v_owner uuid;v_meta jsonb;v_found boolean;
begin
 select * into v_row from fm_photo_uploads where id=p_id and organization_id=current_organization_id() and uploaded_by=auth.uid() for update;
 if not found or not coalesce(fm_photo_allowed(v_row.target_kind,v_row.target_id),false) then raise exception 'NOT_AUTHORIZED';end if;
 if p_declared_sha256 is not null and lower(p_declared_sha256) is distinct from v_row.sha256 then raise exception 'PHOTO_HASH_MISMATCH';end if;
 if v_row.state='linked' then return;end if;
 select true,o.owner,o.metadata into v_found,v_owner,v_meta from storage.objects o where o.bucket_id='vehicle-photos' and o.name=v_row.storage_path;
 if not coalesce(v_found,false) then raise exception 'PHOTO_UPLOAD_REQUIRED';end if;
 if strpos(v_row.storage_path,v_row.sha256)=0
  or v_meta is null or coalesce(v_meta->>'size','') !~ '^[0-9]+$' or (v_meta->>'size')::bigint<>v_row.size_bytes::bigint
  or lower(coalesce(v_meta->>'mimetype','')) is distinct from v_row.mime_type
  or v_owner is distinct from v_row.uploaded_by then raise exception 'PHOTO_INTEGRITY_MISMATCH';end if;
 if v_row.target_kind='inspection' then
  insert into inspection_photos(organization_id,inspection_id,angle,storage_path) values(v_row.organization_id,v_row.target_id,v_row.angle,v_row.storage_path);
 else
  update vehicles set photo_storage_path=v_row.storage_path where id=v_row.target_id and organization_id=v_row.organization_id;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
 end if;
 update fm_photo_uploads set state='linked',linked_at=now() where id=p_id;
 perform log_audit_event(v_row.organization_id,auth.uid(),'photo.linked',v_row.target_kind,v_row.target_id,null,
  jsonb_build_object('upload_id',p_id,'sha256',v_row.sha256,'verified',jsonb_build_object('size',v_meta->>'size','mimetype',v_meta->>'mimetype','etag',v_meta->>'eTag','owner',v_owner,'client_hash_confirmed',p_declared_sha256 is not null)));
end;$$;
revoke all on function public.fm_photo_link(uuid,text) from public,anon,authenticated;

create or replace function public.fm_photo_finalize(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.fm_photo_link(p_id,null);end;$$;
create or replace function public.fm_photo_finalize(p_id uuid,p_sha256 text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if p_sha256 is null or lower(p_sha256) !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PHOTO';end if;
 perform public.fm_photo_link(p_id,p_sha256);
end;$$;
revoke all on function public.fm_photo_finalize(uuid),public.fm_photo_finalize(uuid,text) from public,anon;
grant execute on function public.fm_photo_finalize(uuid),public.fm_photo_finalize(uuid,text) to authenticated;
