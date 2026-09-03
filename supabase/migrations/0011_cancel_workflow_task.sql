-- CRUD completion: `workflow_task_status` has had a 'cancelled' value since
-- 0002_operational_cycle.sql, but nothing ever set it — complete_workflow_task
-- (0004_operational_actions.sql) can only mark a task 'done'. A fleet manager /
-- maintenance operator had no way to dismiss a task that turned out unnecessary (e.g. a
-- cleaning task raised in error) without either completing it dishonestly or a raw SQL
-- UPDATE. Body is complete_workflow_task's, verbatim, except the target status and the
-- guard against completing an already-cancelled (or vice versa) task.

create or replace function cancel_workflow_task(p_task_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
  select vehicle_id into v_vehicle_id from workflow_tasks where id = p_task_id;
  if v_vehicle_id is null then
    raise exception 'Workflow task not found';
  end if;

  update workflow_tasks set status = 'cancelled', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  -- Same re-derivation as complete_workflow_task: vehicle status is one field shared by
  -- every open task on it, so cancelling one task must look at every remaining open task,
  -- not just tasks of the same type.
  select
    count(*) filter (where type in ('repair', 'safety', 'preventive_maintenance')),
    count(*) filter (where type = 'cleaning'),
    count(*) filter (where type = 'charging')
    into v_open_maintenance_like, v_open_cleaning, v_open_charging
    from workflow_tasks
    where vehicle_id = v_vehicle_id and status in ('open', 'in_progress');

  select status into v_current_status from vehicles where id = v_vehicle_id;
  if v_current_status not in ('maintenance', 'cleaning', 'charging') then
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
end;
$$;

grant execute on function cancel_workflow_task(uuid) to authenticated;
