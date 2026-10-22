CREATE OR REPLACE FUNCTION public.block_vehicle(p_vehicle_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if public.current_user_role() not in ('fleet_manager','administrator') or not coalesce(public.fm_can_manage_vehicle(p_vehicle_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

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
$function$

