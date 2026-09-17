-- Fixes audit finding #6: UNBLOCK always sent a vehicle to 'available', discarding
-- whatever status it had before BLOCK (reserved, maintenance, cleaning, charging...).
-- block_vehicle already refuses in_use/returning at the DB level, but for every other
-- source status the prior status was lost. Store it, restore it.

alter table vehicles add column pre_block_status vehicle_status;

create or replace function block_vehicle(p_vehicle_id uuid, p_reason text)
returns void
language plpgsql
as $$
begin
  update vehicles
    set pre_block_status = status, status = 'blocked', updated_at = now()
    where id = p_vehicle_id
      and organization_id = current_organization_id()
      and status not in ('in_use', 'returning', 'blocked');
  if not found then
    raise exception 'Vehicle cannot be blocked from its current status';
  end if;

  insert into workflow_tasks (organization_id, vehicle_id, type, notes)
  values (current_organization_id(), p_vehicle_id, 'safety', p_reason);

  insert into notifications (organization_id, user_id, title, body)
  select current_organization_id(), profiles.id, 'Veículo bloqueado',
    coalesce('Motivo: ' || p_reason, 'Um veículo foi bloqueado.')
  from profiles
  where profiles.organization_id = current_organization_id()
    and profiles.role in ('fleet_manager', 'administrator');

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'vehicle_blocked', 'vehicle', p_vehicle_id,
    null, jsonb_build_object('reason', p_reason)
  );
end;
$$;

create or replace function unblock_vehicle(p_vehicle_id uuid)
returns void
language plpgsql
as $$
declare
  v_restored_status vehicle_status;
begin
  update vehicles
    set status = coalesce(pre_block_status, 'available'), pre_block_status = null, updated_at = now()
    where id = p_vehicle_id and organization_id = current_organization_id() and status = 'blocked'
    returning status into v_restored_status;
  if not found then
    raise exception 'Vehicle is not blocked';
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'vehicle_unblocked', 'vehicle', p_vehicle_id,
    null, jsonb_build_object('restored_status', v_restored_status)
  );
end;
$$;
