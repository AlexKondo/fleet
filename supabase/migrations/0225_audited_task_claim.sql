-- EXPAND: replace the dashboard's direct assignment with a scoped, audited command.
create function public.fm_claim_workflow_task(p_task_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_vehicle uuid;v_task workflow_tasks%rowtype;
begin
 if not fm_account_enabled() or current_user_role() not in ('fleet_manager','administrator','maintenance_operator') then raise exception 'NOT_AUTHORIZED';end if;
 select vehicle_id into v_vehicle from workflow_tasks where id=p_task_id and organization_id=current_organization_id();
 if not found or (current_user_role()<>'maintenance_operator' and not coalesce(fm_can_manage_vehicle(v_vehicle),false)) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 perform 1 from vehicles where id=v_vehicle and organization_id=current_organization_id() for update;
 select * into v_task from workflow_tasks where id=p_task_id and organization_id=current_organization_id() for update;
 if not found or v_task.vehicle_id is distinct from v_vehicle or v_task.status<>'open' or v_task.assigned_to is not null then raise exception 'CONCURRENT_UPDATE';end if;
 update workflow_tasks set assigned_to=auth.uid() where id=p_task_id;
 perform log_audit_event(v_task.organization_id,auth.uid(),'workflow_task.claimed','workflow_task',p_task_id,null,jsonb_build_object('assigned_to',auth.uid()));
 return p_task_id;
end;$$;
revoke all on function public.fm_claim_workflow_task(uuid) from public,anon;
grant execute on function public.fm_claim_workflow_task(uuid) to authenticated;
