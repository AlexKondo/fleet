CREATE OR REPLACE FUNCTION public.unblock_vehicle(p_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_vehicle vehicles%rowtype;
  v_pending text[] := '{}';
  v_restored_status vehicle_status;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if public.current_user_role() not in ('fleet_manager','administrator') or not coalesce(public.fm_can_manage_vehicle(p_vehicle_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

  select * into v_vehicle from vehicles
    where id = p_vehicle_id and organization_id = current_organization_id()
    for update;
  if not found or v_vehicle.status <> 'blocked' then
    raise exception 'Vehicle is not blocked';
  end if;

  if v_vehicle.has_blocking_damage then v_pending := v_pending || 'has_blocking_damage'::text; end if;
  if not v_vehicle.documentation_valid then v_pending := v_pending || 'documentation_invalid'::text; end if;
  if coalesce(cardinality(v_vehicle.missing_safety_equipment), 0) > 0 then v_pending := v_pending || 'missing_safety_equipment'::text; end if;
  if cardinality(v_pending) > 0 then
    raise exception 'VEHICLE_UNBLOCK_CONDITIONS_PENDING' using detail = array_to_string(v_pending, ',');
  end if;

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
$function$

