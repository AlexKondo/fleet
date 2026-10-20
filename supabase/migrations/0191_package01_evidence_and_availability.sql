-- Idempotent prerequisite for safe public-before-pg_temp resolution.
revoke create on schema public from public,anon,authenticated;
-- New forward correction. Does not rewrite any production-applied migration.
-- Original bytes never overwritten/deleted. Journal exists before object upload.
create table public.fm_photo_uploads (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 uploaded_by uuid not null references public.profiles(id), target_kind text not null check(target_kind in ('inspection','vehicle')),
 target_id uuid not null, angle public.photo_angle, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 10485760), mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 storage_path text not null unique, state text not null default 'pending' check(state in ('pending','linked')),
 created_at timestamptz not null default now(), linked_at timestamptz,
 unique(organization_id,target_kind,target_id,sha256,angle),
 check((target_kind='inspection')=(angle is not null))
);
create unique index fm_vehicle_photo_retry on public.fm_photo_uploads(organization_id,target_id,sha256) where target_kind='vehicle';
alter table public.fm_photo_uploads enable row level security;
revoke all on public.fm_photo_uploads from public,anon,authenticated;
create function public.fm_photo_allowed(p_kind text,p_target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select fm_account_enabled() and case when p_kind='vehicle' then fm_can_manage_vehicle(p_target)
 when p_kind='inspection' then exists(select 1 from inspections where id=p_target and organization_id=current_organization_id() and performed_by=auth.uid()) else false end
$$;
revoke all on function public.fm_photo_allowed(text,uuid) from public,anon,authenticated;
create function public.fm_photo_begin(p_kind text,p_target uuid,p_angle public.photo_angle,p_sha256 text,p_size integer,p_mime text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=current_organization_id();v_row fm_photo_uploads%rowtype;v_path text;v_ext text;
begin
 if not coalesce(fm_photo_allowed(p_kind,p_target),false) then raise exception 'NOT_AUTHORIZED';end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_size is null or p_size not between 1 and 10485760 or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') or (p_kind='inspection') is distinct from (p_angle is not null) then raise exception 'INVALID_PHOTO';end if;
 v_ext:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
 v_path:=v_org::text||'/'||case when p_kind='vehicle' then 'vehicles/'||p_target::text||'_' else p_target::text||'/'||p_angle::text||'_' end||p_sha256||'.'||v_ext;
 insert into fm_photo_uploads(organization_id,uploaded_by,target_kind,target_id,angle,sha256,size_bytes,mime_type,storage_path)
 values(v_org,auth.uid(),p_kind,p_target,p_angle,p_sha256,p_size,p_mime,v_path) on conflict do nothing;
 select * into v_row from fm_photo_uploads where storage_path=v_path;
 if v_row.uploaded_by is distinct from auth.uid() or v_row.size_bytes is distinct from p_size or v_row.mime_type is distinct from p_mime then raise exception 'PHOTO_CONFLICT';end if;
 return jsonb_build_object('id',v_row.id,'path',v_row.storage_path,'state',v_row.state);
end;$$;
create function public.fm_photo_finalize(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
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
end;$$;
create function public.fm_photo_pending() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'target_kind',target_kind,'target_id',target_id,'path',storage_path,'sha256',sha256,'created_at',created_at)),'[]'::jsonb)
 from fm_photo_uploads where organization_id=current_organization_id() and uploaded_by=auth.uid() and state='pending' and fm_photo_allowed(target_kind,target_id)
$$;
revoke all on function public.fm_photo_begin(text,uuid,public.photo_angle,text,integer,text),public.fm_photo_finalize(uuid),public.fm_photo_pending() from public,anon;
grant execute on function public.fm_photo_begin(text,uuid,public.photo_angle,text,integer,text),public.fm_photo_finalize(uuid),public.fm_photo_pending() to authenticated;
-- A session cannot mutate the journal or previous evidence. Atomic finalization is the writer.
create trigger fm_photo_upload_no_delete before delete on public.fm_photo_uploads for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_photo_upload_no_truncate before truncate on public.fm_photo_uploads for each statement execute function public.fm_preserve_inspection_evidence();

-- Old RPC retains reservation-only semantics. Maintenance does not become a reservation KPI.
create or replace function public.get_vehicle_busy_windows(p_from timestamptz default now())
returns table(vehicle_id uuid,start_at timestamptz,end_at timestamptz,status public.reservation_status)
language sql stable security definer set search_path=public,pg_temp as $$
 select r.vehicle_id,r.start_at,r.end_at,r.status from public.reservations r
 where r.organization_id=public.current_organization_id() and r.status in ('pending_approval','confirmed') and r.end_at>p_from
$$;
create function public.fm_availability_windows(p_from timestamptz default now())
returns table(vehicle_id uuid,start_at timestamptz,end_at timestamptz,kind text)
language sql stable security definer set search_path=public,pg_temp as $$
 select r.vehicle_id,r.start_at,r.end_at,'reservation'::text from public.reservations r
 where r.organization_id=public.current_organization_id() and r.status in ('pending_approval','confirmed') and r.end_at>p_from
 union all select o.vehicle_id,o.scheduled_start,o.scheduled_end,'maintenance'::text from public.fm_work_orders o
 where o.organization_id=public.current_organization_id() and o.status in ('scheduled','in_progress','partial') and o.scheduled_end>p_from
$$;
revoke all on function public.fm_availability_windows(timestamptz),public.get_vehicle_busy_windows(timestamptz) from public,anon;
grant execute on function public.fm_availability_windows(timestamptz),public.get_vehicle_busy_windows(timestamptz) to authenticated;
revoke all on function public.fm_reservation_maintenance_guard(),public.fm_immutable_vin() from public,anon,authenticated;
