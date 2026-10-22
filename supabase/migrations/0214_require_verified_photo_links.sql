-- CONTRACT: apply only after the server attestation frontend is deployed.
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
 if v_row.server_verified_at is null then raise exception 'PHOTO_SERVER_VERIFICATION_REQUIRED';end if;
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
