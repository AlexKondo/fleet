-- Rollback of 0199: finalize links on object existence only (0191 behaviour). Deploy the app version that calls the 1-arg form first.
drop function if exists public.fm_photo_finalize(uuid,text);
CREATE OR REPLACE FUNCTION public.fm_photo_finalize(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row fm_photo_uploads%rowtype;
begin
 select * into v_row from fm_photo_uploads where id=p_id and organization_id=current_organization_id() and uploaded_by=auth.uid() for update;
 if not found or not coalesce(fm_photo_allowed(v_row.target_kind,v_row.target_id),false) then raise exception 'NOT_AUTHORIZED';end if;
 if v_row.state='linked' then return;end if;
 if not exists(select 1 from storage.objects where bucket_id='vehicle-photos' and name=v_row.storage_path) then raise exception 'PHOTO_UPLOAD_REQUIRED';end if;
 if v_row.target_kind='inspection' then
  insert into inspection_photos(organization_id,inspection_id,angle,storage_path) values(v_row.organization_id,v_row.target_id,v_row.angle,v_row.storage_path);
 else
  update vehicles set photo_storage_path=v_row.storage_path where id=v_row.target_id and organization_id=v_row.organization_id;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
 end if;
 update fm_photo_uploads set state='linked',linked_at=now() where id=p_id;
 perform log_audit_event(v_row.organization_id,auth.uid(),'photo.linked',v_row.target_kind,v_row.target_id,null,jsonb_build_object('upload_id',p_id,'sha256',v_row.sha256));
end;$function$;
revoke all on function public.fm_photo_finalize(uuid) from public,anon;
grant execute on function public.fm_photo_finalize(uuid) to authenticated;
drop function if exists public.fm_photo_link(uuid,text);
