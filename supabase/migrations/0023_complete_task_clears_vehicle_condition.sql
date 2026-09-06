-- complete_workflow_task (0004_operational_actions.sql, last redefined in
-- 0015_audit_trail.sql) only ever updated the workflow_tasks row and, for
-- maintenance/cleaning/charging vehicle statuses, the vehicle's `status` column. It never
-- touched `missing_safety_equipment` or the fuel/battery reading that the task actually
-- represents fixing — so a fleet manager could mark a 'safety' or 'fuel' task "done" and
-- the vehicle's own Painel de Veículos card kept showing "Equipamento ausente"/"Energia
-- baixa" (assessVehicleReadiness, packages/domain/src/readiness/assessVehicleReadiness.ts,
-- reads those vehicle columns directly — it has no idea a task was ever completed).
--
-- 'safety' completion means "the missing equipment was restocked" — clear the list.
-- 'fuel'/'charging' completion means "the vehicle was refueled/recharged" — set that
-- energy reading to 100. 'repair'/'preventive_maintenance'/'cleaning' already have no
-- separate vehicle column of their own to reconcile (their effect is purely the
-- status transition already handled below).

create or replace function complete_workflow_task(p_task_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_task_type workflow_task_type;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
  select vehicle_id, type into v_vehicle_id, v_task_type from workflow_tasks where id = p_task_id;
  if v_vehicle_id is null then
    raise exception 'Workflow task not found';
  end if;

  update workflow_tasks set status = 'done', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  if v_task_type = 'safety' then
    update vehicles set missing_safety_equipment = '{}', updated_at = now()
      where id = v_vehicle_id;
  elsif v_task_type = 'fuel' then
    update vehicles set fuel_level_percent = 100, updated_at = now()
      where id = v_vehicle_id;
  elsif v_task_type = 'charging' then
    update vehicles set battery_level_percent = 100, updated_at = now()
      where id = v_vehicle_id;
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
      current_organization_id(), auth.uid(), 'workflow_task_completed', 'workflow_task',
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
    current_organization_id(), auth.uid(), 'workflow_task_completed', 'workflow_task',
    p_task_id, null, null
  );
end;
$$;
