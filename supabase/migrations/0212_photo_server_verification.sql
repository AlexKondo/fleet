-- Server verifies actual Storage bytes before attesting. Client-supplied SHA alone is not proof.
alter table public.fm_photo_uploads add column server_verified_at timestamptz;
create function public.fm_photo_attest(p_id uuid,p_actor uuid,p_sha256 text,p_size integer,p_mime text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from profiles p left join fm_member_access a on a.user_id=p.id where p.id=p_actor and coalesce(a.enabled,true)) then raise exception 'NOT_AUTHORIZED';end if;
 update fm_photo_uploads j set server_verified_at=now() where j.id=p_id and j.uploaded_by=p_actor
 and j.sha256=p_sha256 and j.size_bytes=p_size and j.mime_type=p_mime
 and exists(select 1 from profiles p where p.id=p_actor and p.organization_id=j.organization_id);
 if not found then raise exception 'PHOTO_INTEGRITY_MISMATCH';end if;
end;$$;
revoke all on function public.fm_photo_attest(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.fm_photo_attest(uuid,uuid,text,integer,text) to service_role;

