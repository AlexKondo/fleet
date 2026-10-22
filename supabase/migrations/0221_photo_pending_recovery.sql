-- Keep old object paths permanently; rotate only pending attempts, never linked evidence.
create table public.fm_photo_attempt_history(id uuid primary key default gen_random_uuid(),upload_id uuid not null references fm_photo_uploads(id),organization_id uuid not null references organizations(id),storage_path text not null,actor_id uuid not null references profiles(id),created_at timestamptz not null default now());
alter table public.fm_photo_attempt_history enable row level security;
revoke all on public.fm_photo_attempt_history from public,anon,authenticated;
create trigger fm_photo_attempt_no_delete before update or delete on public.fm_photo_attempt_history for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_photo_attempt_no_truncate before truncate on public.fm_photo_attempt_history for each statement execute function public.fm_preserve_inspection_evidence();
create function public.fm_photo_info(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j fm_photo_uploads%rowtype;
begin
 select * into j from fm_photo_uploads where id=p_id and organization_id=current_organization_id() and uploaded_by=auth.uid();
 if not found or not coalesce(fm_photo_allowed(j.target_kind,j.target_id),false) then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('id',j.id,'path',j.storage_path,'state',j.state,'sha256',j.sha256,'size',j.size_bytes,'mime',j.mime_type,'kind',j.target_kind,'target',j.target_id,'angle',j.angle);
end;$$;
create function public.fm_photo_restart(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j fm_photo_uploads%rowtype;v_path text;
begin
 select * into j from fm_photo_uploads where id=p_id and organization_id=current_organization_id() and uploaded_by=auth.uid() for update;
 if not found or not coalesce(fm_photo_allowed(j.target_kind,j.target_id),false) then raise exception 'NOT_AUTHORIZED';end if;
 if j.state<>'pending' then raise exception 'PHOTO_ALREADY_LINKED';end if;
 v_path:=regexp_replace(j.storage_path,'\.[^.]+$','')||'_'||gen_random_uuid()::text||'.'||case j.mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end;
 insert into fm_photo_attempt_history(upload_id,organization_id,storage_path,actor_id) values(j.id,j.organization_id,j.storage_path,auth.uid());
 update fm_photo_uploads set storage_path=v_path,server_verified_at=null where id=j.id;
 perform log_audit_event(j.organization_id,auth.uid(),'photo.retry_started',j.target_kind,j.target_id,jsonb_build_object('path',j.storage_path),jsonb_build_object('path',v_path));
end;$$;
revoke all on function public.fm_photo_info(uuid),public.fm_photo_restart(uuid) from public,anon;
grant execute on function public.fm_photo_info(uuid),public.fm_photo_restart(uuid) to authenticated;

create or replace function public.fm_photo_begin(p_kind text,p_target uuid,p_angle public.photo_angle,p_sha256 text,p_size integer,p_mime text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=current_organization_id();v_row fm_photo_uploads%rowtype;v_path text;v_ext text;
begin
 if not coalesce(fm_photo_allowed(p_kind,p_target),false) then raise exception 'NOT_AUTHORIZED';end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_size is null or p_size not between 1 and 10485760 or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') or (p_kind='inspection') is distinct from (p_angle is not null) then raise exception 'INVALID_PHOTO';end if;
 v_ext:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
 v_path:=v_org::text||'/'||case when p_kind='vehicle' then 'vehicles/'||p_target::text||'_' else p_target::text||'/'||p_angle::text||'_' end||p_sha256||'.'||v_ext;
 insert into fm_photo_uploads(organization_id,uploaded_by,target_kind,target_id,angle,sha256,size_bytes,mime_type,storage_path)
 values(v_org,auth.uid(),p_kind,p_target,p_angle,p_sha256,p_size,p_mime,v_path) on conflict do nothing;
 select * into v_row from fm_photo_uploads where organization_id=v_org and target_kind=p_kind and target_id=p_target and sha256=p_sha256 and angle is not distinct from p_angle;
 if v_row.uploaded_by is distinct from auth.uid() or v_row.size_bytes is distinct from p_size or v_row.mime_type is distinct from p_mime then raise exception 'PHOTO_CONFLICT';end if;
 return jsonb_build_object('id',v_row.id,'path',v_row.storage_path,'state',v_row.state);
end;$$;

create or replace function public.fm_photo_pending() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'target_kind',target_kind,'target_id',target_id,'angle',angle,'path',storage_path,'sha256',sha256,'created_at',created_at)),'[]'::jsonb)
 from fm_photo_uploads where organization_id=current_organization_id() and uploaded_by=auth.uid() and state='pending' and fm_photo_allowed(target_kind,target_id)
$$;
