-- Immutable private documents; operational links never overwrite/delete evidence.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fleet-documents','fleet-documents',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table public.fm_documents(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id),vehicle_id uuid not null references vehicles(id),
 target_kind text not null check(target_kind in ('vehicle','work_order','energy_event')),target_id uuid not null,
 category text not null check(category in ('quote','invoice','service_report','vehicle_document','other')),
 filename text not null check(length(filename) between 1 and 180),mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 5242880),sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 storage_path text not null unique,state text not null default 'pending' check(state in ('pending','ready','invalidated')),
 uploaded_by uuid not null references profiles(id),created_at timestamptz not null default now(),finalized_at timestamptz,
 invalidated_by uuid references profiles(id),invalidated_at timestamptz,invalidation_reason text,version integer not null default 1,
 request_id uuid not null,unique(organization_id,request_id)
);
create index fm_documents_target on public.fm_documents(organization_id,target_kind,target_id,created_at desc);
alter table public.fm_documents enable row level security;
revoke all on public.fm_documents from public,anon,authenticated;
create function public.fm_document_vehicle(p_kind text,p_id uuid) returns uuid language sql stable security definer set search_path=public, pg_temp as $$
 select case p_kind when 'vehicle' then (select id from vehicles where id=p_id and organization_id=current_organization_id())
 when 'work_order' then (select vehicle_id from fm_work_orders where id=p_id and organization_id=current_organization_id())
 when 'energy_event' then (select vehicle_id from fm_energy_events where id=p_id and organization_id=current_organization_id()) end
$$;
create function public.fm_document_target_access(p_kind text,p_id uuid,p_category text,p_write boolean default false) returns boolean language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_vehicle uuid:=fm_document_vehicle(p_kind,p_id);v_unit uuid;
begin
 if current_organization_id() is null or v_vehicle is null then return false;end if;
 if fm_can_manage_vehicle(v_vehicle) then return true;end if;
 if current_user_role()='maintenance_operator' and p_kind in ('vehicle','work_order') then return true;end if;
 if not p_write and p_kind='work_order' and p_category='quote' then
  select unit_id into v_unit from fm_vehicle_units where vehicle_id=v_vehicle and organization_id=current_organization_id();
  return exists(select 1 from fm_maintenance_approval_policies p join fm_work_orders o on o.id=p_id where p.unit_id=v_unit and p.organization_id=current_organization_id() and auth.uid()=any(p.superior_ids) and o.budget_pending and o.status not in ('draft','completed','cancelled'));
 end if;
 return false;
end;$$;
create function public.fm_document_object_access(p_name text,p_write boolean) returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from fm_documents d where d.storage_path=p_name and d.organization_id=current_organization_id() and fm_document_target_access(d.target_kind,d.target_id,d.category,p_write)
 and (not p_write or (d.uploaded_by=auth.uid() and d.state='pending')) and (p_write or d.state<>'pending' or d.uploaded_by=auth.uid()))
$$;
create policy fm_document_objects_read on storage.objects for select to authenticated using(bucket_id='fleet-documents' and fm_document_object_access(name,false));
create policy fm_document_objects_insert on storage.objects for insert to authenticated with check(bucket_id='fleet-documents' and fm_document_object_access(name,true));
create policy fm_document_objects_restrict_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'fleet-documents' or fm_document_object_access(name,false));
create policy fm_document_objects_restrict_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'fleet-documents' or fm_document_object_access(name,true));
create policy fm_document_objects_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'fleet-documents') with check(bucket_id<>'fleet-documents');
create policy fm_document_objects_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'fleet-documents');
create function public.fm_document_preserve() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP in ('DELETE','TRUNCATE') then raise exception 'PRESERVE_DOCUMENT_HISTORY';end if;
 if row(new.organization_id,new.vehicle_id,new.target_kind,new.target_id,new.category,new.filename,new.mime_type,new.size_bytes,new.sha256,new.storage_path,new.uploaded_by,new.created_at,new.request_id)
 is distinct from row(old.organization_id,old.vehicle_id,old.target_kind,old.target_id,old.category,old.filename,old.mime_type,old.size_bytes,old.sha256,old.storage_path,old.uploaded_by,old.created_at,old.request_id) then raise exception 'PRESERVE_DOCUMENT_HISTORY';end if;
 if new.version<>old.version+1 or not ((old.state='pending' and new.state='ready') or (old.state='ready' and new.state='invalidated')) then raise exception 'INVALID_STATE_TRANSITION';end if;
 return new;
end;$$;
create trigger fm_document_preserve before update or delete on public.fm_documents for each row execute function public.fm_document_preserve();
create trigger fm_document_no_truncate before truncate on public.fm_documents for each statement execute function public.fm_document_preserve();
create function public.fm_document_begin(p_kind text,p_target_id uuid,p_category text,p_filename text,p_mime text,p_size integer,p_sha256 text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_id uuid:=gen_random_uuid();v_vehicle uuid;v_doc fm_documents%rowtype;v_payload jsonb;v_created uuid;v_receipt fm_command_receipts%rowtype;
begin
 if not fm_document_target_access(p_kind,p_target_id,p_category,true) then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_category is null or p_category not in ('quote','invoice','service_report','vehicle_document','other') or p_filename is null or length(trim(p_filename)) not between 1 and 180 or p_filename ~ '[[:cntrl:]/\\]' or p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png','image/webp') or p_size is null or p_size not between 1 and 5242880 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT';end if;
 v_payload:=jsonb_build_object('kind',p_kind,'target_id',p_target_id,'category',p_category,'filename',trim(p_filename),'mime',p_mime,'size',p_size,'sha256',p_sha256);
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,auth.uid(),'document.begin',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
 select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
 if v_receipt.actor_id<>auth.uid() or v_receipt.command<>'document.begin' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 select * into v_doc from fm_documents where organization_id=v_org and request_id=p_request_id;return to_jsonb(v_doc);
 end if;
 v_vehicle:=fm_document_vehicle(p_kind,p_target_id);
 insert into fm_documents(id,organization_id,vehicle_id,target_kind,target_id,category,filename,mime_type,size_bytes,sha256,storage_path,uploaded_by,request_id)
 values(v_id,v_org,v_vehicle,p_kind,p_target_id,p_category,trim(p_filename),p_mime,p_size,p_sha256,v_org::text||'/'||v_id::text||case p_mime when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end,auth.uid(),p_request_id) returning * into v_doc;
 perform log_audit_event(v_org,auth.uid(),'document.upload_started','document',v_id,null,v_payload);
 update fm_command_receipts set result=jsonb_build_object('id',v_id) where organization_id=v_org and request_id=p_request_id;
 return to_jsonb(v_doc);
end;$$;
create function public.fm_document_finalize(p_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_doc fm_documents%rowtype;
begin
 select * into v_doc from fm_documents where id=p_id and organization_id=current_organization_id() for update;
 if not found or v_doc.uploaded_by is distinct from auth.uid() or not fm_document_target_access(v_doc.target_kind,v_doc.target_id,v_doc.category,true) then raise exception 'NOT_AUTHORIZED';end if;
 if v_doc.state='ready' then return to_jsonb(v_doc);end if;
 if v_doc.state<>'pending' then raise exception 'INVALID_STATE_TRANSITION';end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='fleet-documents' and o.name=v_doc.storage_path and o.metadata->>'size'=v_doc.size_bytes::text and o.metadata->>'mimetype'=v_doc.mime_type) then raise exception 'DOCUMENT_UPLOAD_INCOMPLETE';end if;
 update fm_documents set state='ready',version=version+1,finalized_at=now() where id=p_id returning * into v_doc;
 perform log_audit_event(v_doc.organization_id,auth.uid(),'document.ready','document',p_id,null,jsonb_build_object('sha256',v_doc.sha256,'bytes',v_doc.size_bytes));return to_jsonb(v_doc);
end;$$;
create function public.fm_document_list(p_kind text,p_target_id uuid) returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
begin
 if not fm_document_target_access(p_kind,p_target_id,'other',false) and not fm_document_target_access(p_kind,p_target_id,'quote',false) then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('can_upload',fm_document_target_access(p_kind,p_target_id,'other',true),'documents',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('can_invalidate',d.state='ready' and (d.uploaded_by=auth.uid() or fm_can_manage_vehicle(d.vehicle_id))) order by d.created_at desc,d.id desc) from fm_documents d where d.organization_id=current_organization_id() and d.target_kind=p_kind and d.target_id=p_target_id and fm_document_target_access(d.target_kind,d.target_id,d.category,false) and (d.state<>'pending' or d.uploaded_by=auth.uid())),'[]'::jsonb));
end;$$;
create function public.fm_document_get(p_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_doc fm_documents%rowtype;
begin
 select * into v_doc from fm_documents where id=p_id and organization_id=current_organization_id();
 if not found or v_doc.state='pending' or not fm_document_target_access(v_doc.target_kind,v_doc.target_id,v_doc.category,false) then raise exception 'NOT_AUTHORIZED';end if;
 perform log_audit_event(v_doc.organization_id,auth.uid(),'document.download_requested','document',p_id,null,jsonb_build_object('sha256',v_doc.sha256,'state',v_doc.state));return to_jsonb(v_doc);
end;$$;
create function public.fm_document_invalidate(p_id uuid,p_version integer,p_reason text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_doc fm_documents%rowtype;v_payload jsonb;v_receipt fm_command_receipts%rowtype;v_created uuid;v_result jsonb;
begin
 select * into v_doc from fm_documents where id=p_id and organization_id=current_organization_id() for update;
 if not found or not fm_document_target_access(v_doc.target_kind,v_doc.target_id,v_doc.category,true) or not(v_doc.uploaded_by=auth.uid() or fm_can_manage_vehicle(v_doc.vehicle_id)) then raise exception 'NOT_AUTHORIZED';end if;
 if p_version is null or p_version<1 or p_request_id is null or p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'INVALID_INPUT';end if;
 v_payload:=jsonb_build_object('id',p_id,'version',p_version,'reason',trim(p_reason));
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_doc.organization_id,p_request_id,auth.uid(),'document.invalidate',v_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then
 select * into v_receipt from fm_command_receipts where organization_id=v_doc.organization_id and request_id=p_request_id;
 if v_receipt.actor_id<>auth.uid() or v_receipt.command<>'document.invalidate' or v_receipt.payload<>v_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;
 end if;
 if v_doc.version<>p_version then raise exception 'CONCURRENT_UPDATE';end if;
 if v_doc.state<>'ready' then raise exception 'INVALID_STATE_TRANSITION';end if;
 update fm_documents set state='invalidated',version=version+1,invalidated_at=now(),invalidated_by=auth.uid(),invalidation_reason=trim(p_reason) where id=p_id returning * into v_doc;
 v_result:=to_jsonb(v_doc);perform log_audit_event(v_doc.organization_id,auth.uid(),'document.invalidated','document',p_id,null,jsonb_build_object('reason',trim(p_reason)));
 update fm_command_receipts set result=v_result where organization_id=v_doc.organization_id and request_id=p_request_id;return v_result;
end;$$;
revoke all on function public.fm_document_vehicle(text,uuid),public.fm_document_target_access(text,uuid,text,boolean),public.fm_document_preserve() from public,anon,authenticated;
revoke all on function public.fm_document_object_access(text,boolean),public.fm_document_begin(text,uuid,text,text,text,integer,text,uuid),public.fm_document_finalize(uuid),public.fm_document_list(text,uuid),public.fm_document_get(uuid),public.fm_document_invalidate(uuid,integer,text,uuid) from public,anon;
grant execute on function public.fm_document_object_access(text,boolean),public.fm_document_begin(text,uuid,text,text,text,integer,text,uuid),public.fm_document_finalize(uuid),public.fm_document_list(text,uuid),public.fm_document_get(uuid),public.fm_document_invalidate(uuid,integer,text,uuid) to authenticated;
create function public.fm_vehicle_dossier(p_vehicle_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_role user_role:=current_user_role();v_result jsonb;
begin
 if v_org is null or not exists(select 1 from vehicles where id=p_vehicle_id and organization_id=v_org) or not (fm_can_manage_vehicle(p_vehicle_id) or v_role='maintenance_operator') then raise exception 'NOT_AUTHORIZED';end if;
 select jsonb_build_object('generated_at',now(),'vehicle',jsonb_build_object('id',v.id,'plate',v.plate,'name',v.name,'vin',v.vin,'status',v.status,'odometer_km',v.odometer_km,'next_service_date',v.next_service_date,'next_service_odometer_km',v.next_service_odometer_km),
 'unit',(select u.name from fm_vehicle_units m join fm_units u on u.id=m.unit_id where m.vehicle_id=v.id and m.organization_id=v_org),
 'orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at,o.id) from fm_work_orders o where o.vehicle_id=v.id and o.organization_id=v_org),'[]'::jsonb),
 'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from fm_work_order_lines l join fm_work_orders o on o.id=l.work_order_id where o.vehicle_id=v.id and l.organization_id=v_org),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from fm_budget_approvals a join fm_work_orders o on o.id=a.work_order_id where o.vehicle_id=v.id and a.organization_id=v_org),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'target_kind',d.target_kind,'target_id',d.target_id,'category',d.category,'filename',d.filename,'state',d.state,'sha256',d.sha256,'created_at',d.created_at,'invalidation_reason',d.invalidation_reason) order by d.created_at,d.id) from fm_documents d where d.vehicle_id=v.id and d.organization_id=v_org and d.state<>'pending'),'[]'::jsonb),
 'energy',case when v_role in ('fleet_manager','administrator') then coalesce((select jsonb_agg(to_jsonb(e) order by e.event_at,e.id) from fm_energy_events e where e.vehicle_id=v.id and e.organization_id=v_org),'[]'::jsonb) else null end)
 into v_result from vehicles v where v.id=p_vehicle_id and v.organization_id=v_org;
 perform log_audit_event(v_org,auth.uid(),'vehicle.dossier_export','vehicle',p_vehicle_id,null,jsonb_build_object('scope','maintenance_history'));
 return v_result;
end;$$;
revoke all on function public.fm_vehicle_dossier(uuid) from public,anon;
grant execute on function public.fm_vehicle_dossier(uuid) to authenticated;
