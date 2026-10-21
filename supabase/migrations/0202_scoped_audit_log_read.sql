-- Pacote 01 correction DEF-06: a LIMITED fleet_manager (mode selected_units) read the whole organization's audit_log.
-- Contract-type change (narrows a read; no app code depends on reading out-of-scope rows). A restrictive SELECT policy keeps
-- administrators and all-units managers unchanged; a limited manager sees a row only when it is his own action or when the
-- audited entity resolves to a vehicle / reservation / unit inside his scope. Entities that cannot be attributed to a unit
-- (organization settings, members, carpool, privacy, ...) are hidden from limited managers unless they are the actor.
create or replace function public.fm_audit_entry_in_scope(p_entity_type text,p_entity_id uuid,p_actor_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select coalesce((auth.uid() is not null and p_actor_id=auth.uid()) or case p_entity_type
  when 'reservation' then fm_can_manage_reservation(p_entity_id)
  when 'vehicle' then fm_can_manage_vehicle(p_entity_id)
  when 'vehicle_equipment' then fm_can_manage_vehicle(p_entity_id)
  when 'unit' then fm_can_manage_unit(p_entity_id)
  when 'work_order' then fm_can_manage_vehicle((select vehicle_id from fm_work_orders where id=p_entity_id and organization_id=current_organization_id()))
  when 'inspection' then fm_can_manage_vehicle((select vehicle_id from inspections where id=p_entity_id and organization_id=current_organization_id()))
  when 'gate_event' then fm_can_manage_vehicle((select vehicle_id from fm_gate_events where id=p_entity_id and organization_id=current_organization_id()))
  when 'energy_event' then fm_can_manage_vehicle((select vehicle_id from fm_energy_events where id=p_entity_id and organization_id=current_organization_id()))
  when 'inspection_acknowledgement' then fm_can_manage_vehicle((select i.vehicle_id from fm_incident_acknowledgements a join inspections i on i.id=a.inspection_id where a.id=p_entity_id and a.organization_id=current_organization_id()))
  when 'incident' then fm_can_manage_vehicle((select vehicle_id from fm_incidents where id=p_entity_id and organization_id=current_organization_id()))
  when 'document' then fm_can_manage_vehicle((select vehicle_id from fm_documents where id=p_entity_id and organization_id=current_organization_id()))
  when 'workflow_task' then fm_can_manage_vehicle((select vehicle_id from workflow_tasks where id=p_entity_id and organization_id=current_organization_id()))
  else false end,false)
$$;
revoke all on function public.fm_audit_entry_in_scope(text,uuid,uuid) from public,anon;
grant execute on function public.fm_audit_entry_in_scope(text,uuid,uuid) to authenticated;
drop policy if exists fm_scope_audit_read on public.audit_log;
create policy fm_scope_audit_read on public.audit_log as restrictive for select to authenticated
 using ((not coalesce((select public.fm_is_limited_manager()),false)) or public.fm_audit_entry_in_scope(entity_type,entity_id,actor_id));
