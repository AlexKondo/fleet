-- Rollback of 0205: removes the damage-hold release triggers and helpers. Audit rows already written are preserved (DEC-03).
drop trigger if exists fm_task_damage_release on public.workflow_tasks;
drop trigger if exists fm_incident_damage_release on public.fm_incidents;
drop function if exists public.fm_task_damage_release_trg();
drop function if exists public.fm_incident_damage_release_trg();
drop function if exists public.fm_release_damage_hold(uuid,text,uuid,uuid);
drop function if exists public.fm_incident_holds_damage(text,uuid);
