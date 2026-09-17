-- Fixes audit finding #3: workflow_tasks has no assignee, so every maintenance_operator
-- sees the same global queue with no "my tasks" and no accountability. Nullable —
-- existing/legacy tasks and manager-created tasks may stay unassigned (visible to all
-- maintenance operators, same as today), but the UI can now let an operator claim a task
-- or a manager assign one directly.

alter table workflow_tasks add column assigned_to uuid references profiles (id) on delete set null;
create index workflow_tasks_assigned_to_idx on workflow_tasks (assigned_to);

alter table workflow_tasks add column priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high'));
