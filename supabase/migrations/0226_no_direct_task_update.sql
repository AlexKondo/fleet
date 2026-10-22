-- CONTRACT after dashboard assignment uses fm_claim_workflow_task on all writers.
revoke update on public.workflow_tasks from public,anon,authenticated;
