-- Append-only monetary correction requests; never rewrite a closed order or its original lines.
create table public.fm_order_adjustments (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 work_order_id uuid not null references public.fm_work_orders(id),delta numeric(14,2) not null check(delta<>0 and delta not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 reason text not null check(length(reason) between 3 and 3000),status text not null default 'pending' check(status in ('pending','approved','rejected')),
 proposed_by uuid not null references public.profiles(id),proposed_as user_role not null,reviewed_by uuid references public.profiles(id),review_notes text,
 policy_snapshot jsonb,version integer not null default 1,created_at timestamptz not null default now(),reviewed_at timestamptz
);
alter table public.fm_order_adjustments enable row level security;
revoke all on public.fm_order_adjustments from public,anon,authenticated;
grant select on public.fm_order_adjustments to authenticated;
create policy fm_adjustment_read on public.fm_order_adjustments for select to authenticated using(organization_id=current_organization_id() and exists(select 1 from fm_work_orders o where o.id=work_order_id and (fm_can_manage_vehicle(o.vehicle_id) or current_user_role()='maintenance_operator')));
create function public.fm_adjustment_preserve() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' or old.status<>'pending' or new.organization_id<>old.organization_id or new.work_order_id<>old.work_order_id or new.delta<>old.delta or new.reason<>old.reason or new.proposed_by<>old.proposed_by or new.proposed_as<>old.proposed_as or new.created_at<>old.created_at then raise exception 'PRESERVE_FINANCIAL_HISTORY';end if;return new;
end;$$;
create trigger fm_adjustment_preserve before update or delete on public.fm_order_adjustments for each row execute function public.fm_adjustment_preserve();
create trigger fm_adjustment_no_truncate before truncate on public.fm_order_adjustments for each statement execute function public.fm_preserve_inspection_evidence();
create function public.fm_order_adjustment_command(p_command text,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_role user_role:=current_user_role();v_order fm_work_orders%rowtype;v_a fm_order_adjustments%rowtype;v_policy fm_maintenance_approval_policies%rowtype;v_unit uuid;v_delta numeric;v_notes text;v_created uuid;v_receipt fm_command_receipts%rowtype;v_result jsonb;v_total numeric;
begin
 if v_org is null then raise exception 'NOT_AUTHORIZED';end if;
 if p_command is null or p_command not in ('propose','approve','reject') or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_request_id is null then raise exception 'INVALID_INPUT';end if;
 perform 1 from organizations where id=v_org for no key update;
 if current_organization_id() is distinct from v_org or current_user_role() is distinct from v_role then raise exception 'NOT_AUTHORIZED';end if;
 v_notes:=trim(coalesce(p_payload->>'reason',''));if length(v_notes) not between 3 and 3000 then raise exception 'INVALID_INPUT';end if;
 if p_command='propose' then select * into v_order from fm_work_orders where id=(p_payload->>'order_id')::uuid and organization_id=v_org for update;
 else
  select * into v_a from fm_order_adjustments where id=(p_payload->>'id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
  select * into v_order from fm_work_orders where id=v_a.work_order_id and organization_id=v_org for update;
 end if;
 if v_order.id is null then raise exception 'NOT_AUTHORIZED';end if;
 select unit_id into v_unit from fm_vehicle_units where vehicle_id=v_order.vehicle_id and organization_id=v_org;
 select * into v_policy from fm_maintenance_approval_policies where unit_id=v_unit and organization_id=v_org;
 if p_command='propose' then
  if not ((v_role in ('fleet_manager','administrator') and fm_can_manage_vehicle(v_order.vehicle_id)) or v_role='maintenance_operator') then raise exception 'NOT_AUTHORIZED';end if;
 elsif not (fm_can_manage_vehicle(v_order.vehicle_id) or v_actor=any(coalesce(v_policy.superior_ids,'{}'::uuid[]))) then raise exception 'NOT_AUTHORIZED';end if;
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,v_actor,'order.adjustment.'||p_command,p_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'order.adjustment.'||p_command or v_receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;
 end if;
 if v_order.status<>'completed' then raise exception 'INVALID_STATE_TRANSITION';end if;
 if p_command='propose' then
  v_delta:=(p_payload->>'delta')::numeric;
  if v_delta is null or v_delta in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or v_delta=0 or abs(v_delta)>100000000 or round(v_delta,2)<>v_delta then raise exception 'INVALID_INPUT';end if;
  if coalesce((p_payload->>'version')::integer,0)<>v_order.version then raise exception 'CONCURRENT_UPDATE';end if;
  insert into fm_order_adjustments(organization_id,work_order_id,delta,reason,proposed_by,proposed_as) values(v_org,v_order.id,v_delta,v_notes,v_actor,v_role) returning * into v_a;
 else
  if v_a.proposed_by=v_actor then raise exception 'SELF_APPROVAL_DENIED';end if;
  if v_a.status<>'pending' then raise exception 'INVALID_STATE_TRANSITION';end if;
  if coalesce((p_payload->>'version')::integer,0)<>v_a.version then raise exception 'CONCURRENT_UPDATE';end if;
  if v_a.proposed_as in ('fleet_manager','administrator') and not(v_actor=any(coalesce(v_policy.superior_ids,'{}'::uuid[]))) then raise exception 'SUPERIOR_APPROVAL_REQUIRED';end if;
  if v_policy.mode='designated' and not(v_actor=any(v_policy.approver_ids) or v_actor=any(v_policy.superior_ids)) then raise exception 'APPROVER_NOT_AUTHORIZED';end if;
  if p_command='approve' then
   select coalesce(sum(round(quantity*unit_price,2)),0) into v_total from fm_work_order_lines where work_order_id=v_order.id and stage='actual' and not warranty and voided_at is null;
   v_total:=v_total+coalesce((select sum(delta) from fm_order_adjustments where work_order_id=v_order.id and status='approved'),0)+v_a.delta;
   if v_total<0 then raise exception 'NEGATIVE_EFFECTIVE_COST';end if;
  end if;
  update fm_order_adjustments set status=case when p_command='approve' then 'approved' else 'rejected' end,reviewed_by=v_actor,review_notes=v_notes,reviewed_at=now(),version=version+1,
   policy_snapshot=jsonb_build_object('unit_id',v_unit,'version',coalesce(v_policy.version,0),'mode',coalesce(v_policy.mode,'scoped_managers'),'superior_required',v_a.proposed_as in ('fleet_manager','administrator')) where id=v_a.id returning * into v_a;
 end if;
 v_result:=jsonb_build_object('id',v_a.id,'order_id',v_order.id,'status',v_a.status,'version',v_a.version);
 perform log_audit_event(v_org,v_actor,'order.adjustment.'||p_command,'work_order',v_order.id,null,to_jsonb(v_a));
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$$;
create function public.fm_order_adjustment_workspace() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();begin
 if v_org is null then raise exception 'NOT_AUTHORIZED';end if;
 return coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('can_review',a.status='pending' and a.proposed_by<>v_actor and (fm_can_manage_vehicle(o.vehicle_id) or v_actor=any(coalesce(p.superior_ids,'{}'::uuid[]))) and (a.proposed_as not in ('fleet_manager','administrator') or v_actor=any(coalesce(p.superior_ids,'{}'::uuid[]))) and (p.mode is distinct from 'designated' or v_actor=any(p.approver_ids) or v_actor=any(p.superior_ids)))) from fm_order_adjustments a join fm_work_orders o on o.id=a.work_order_id left join fm_vehicle_units m on m.vehicle_id=o.vehicle_id left join fm_maintenance_approval_policies p on p.unit_id=m.unit_id where a.organization_id=v_org and (fm_can_manage_vehicle(o.vehicle_id) or current_user_role()='maintenance_operator' or (a.status='pending' and v_actor=any(coalesce(p.superior_ids,'{}'::uuid[]))))),'[]'::jsonb);
end;$$;
-- Add approved corrections to the existing cost stream, without altering any stored line.
alter function public.fm_v3_snapshot() rename to fm_v3_snapshot_before_adjustments;
revoke all on function public.fm_v3_snapshot_before_adjustments() from public,anon,authenticated;
create function public.fm_v3_snapshot() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_result jsonb;v_extra jsonb;begin
 v_result:=fm_v3_snapshot_before_adjustments();
 if current_user_role() in ('fleet_manager','administrator','maintenance_operator') then
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'work_order_id',a.work_order_id,'stage','actual','description','Ajuste após encerramento: '||a.reason,'category','other','quantity',1,'unit_price',a.delta,'warranty',false,'created_at',a.reviewed_at,'voided_at',null,'void_reason',null,'is_adjustment',true)),'[]') into v_extra from fm_order_adjustments a join fm_work_orders o on o.id=a.work_order_id where a.organization_id=current_organization_id() and a.status='approved' and (current_user_role()='maintenance_operator' or fm_can_manage_vehicle(o.vehicle_id));
  v_result:=jsonb_set(v_result,'{lines}',coalesce(v_result->'lines','[]')||v_extra)||jsonb_build_object('adjustments',fm_order_adjustment_workspace());
 end if;return v_result;
end;$$;
alter function public.fm_vehicle_dossier(uuid) rename to fm_vehicle_dossier_before_adjustments;
revoke all on function public.fm_vehicle_dossier_before_adjustments(uuid) from public,anon,authenticated;
create function public.fm_vehicle_dossier(p_vehicle_id uuid) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_result jsonb;begin
 v_result:=fm_vehicle_dossier_before_adjustments(p_vehicle_id);
 return v_result||jsonb_build_object('adjustments',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from fm_order_adjustments a join fm_work_orders o on o.id=a.work_order_id where o.vehicle_id=p_vehicle_id and a.organization_id=current_organization_id()),'[]'::jsonb));
end;$$;
revoke all on function public.fm_adjustment_preserve() from public,anon,authenticated;
revoke all on function public.fm_order_adjustment_command(text,jsonb,uuid),public.fm_order_adjustment_workspace(),public.fm_v3_snapshot(),public.fm_vehicle_dossier(uuid) from public,anon;
grant execute on function public.fm_order_adjustment_command(text,jsonb,uuid),public.fm_order_adjustment_workspace(),public.fm_v3_snapshot(),public.fm_vehicle_dossier(uuid) to authenticated;
