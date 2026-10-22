CREATE OR REPLACE FUNCTION public.cancel_workflow_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_vehicle_id uuid;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if not exists(select 1 from public.workflow_tasks t where t.id=p_task_id and t.organization_id=public.current_organization_id() and (public.current_user_role()='maintenance_operator' or (public.current_user_role() in ('fleet_manager','administrator') and public.fm_can_manage_vehicle(t.vehicle_id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

  select vehicle_id into v_vehicle_id from workflow_tasks where id = p_task_id;
  if v_vehicle_id is null then
    raise exception 'Workflow task not found';
  end if;

  perform 1 from vehicles where id=v_vehicle_id for update;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
  perform 1 from workflow_tasks where id=p_task_id and vehicle_id=v_vehicle_id for update;
  if not found then raise exception 'CONCURRENT_UPDATE';end if;

  update workflow_tasks set status = 'cancelled', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  select
    count(*) filter (where type in ('repair', 'safety', 'preventive_maintenance')),
    count(*) filter (where type = 'cleaning'),
    count(*) filter (where type = 'charging')
    into v_open_maintenance_like, v_open_cleaning, v_open_charging
    from workflow_tasks
    where vehicle_id = v_vehicle_id and status in ('open', 'in_progress');

  select status into v_current_status from vehicles where id = v_vehicle_id;
  if v_current_status not in ('maintenance', 'cleaning', 'charging') then
    perform log_audit_event(
      current_organization_id(), auth.uid(), 'workflow_task_cancelled', 'workflow_task',
      p_task_id, null, null
    );
    return;
  end if;

  if v_open_maintenance_like > 0 then
    update vehicles set status = 'maintenance', updated_at = now() where id = v_vehicle_id;
  elsif v_open_cleaning > 0 then
    update vehicles set status = 'cleaning', updated_at = now() where id = v_vehicle_id;
  elsif v_open_charging > 0 then
    update vehicles set status = 'charging', updated_at = now() where id = v_vehicle_id;
  else
    update vehicles
      set status = 'available', has_blocking_damage = false, updated_at = now()
      where id = v_vehicle_id;
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'workflow_task_cancelled', 'workflow_task',
    p_task_id, null, null
  );
end;
$function$

