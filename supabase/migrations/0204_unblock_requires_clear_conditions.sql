-- 0204 (FIX-SQL-2 / SQL-1): "Desbloquear" (unblock_vehicle) restored pre_block_status without looking at the conditions that keep a
-- vehicle out of service, so a car with invalid documentation and a blocking damage became 'available' again.
-- The rule is the one the platform already applies elsewhere (no new business rule):
--   * departure (fm_v3_command gate.record, DEPARTURE_BLOCKED): has_blocking_damage / not documentation_valid / missing_safety_equipment;
--   * restore of an archived vehicle (fm_fleet_lifecycle, 0185): the same three conditions keep it 'blocked'.
-- Unblocking is refused with VEHICLE_UNBLOCK_CONDITIONS_PENDING (DETAIL lists the pending conditions) while any of them persists.
-- The conditions are cleared by their own paths (repair task / incident resolution - 0205, safety task completion, documentation).
-- Still SECURITY INVOKER (RLS of vehicles decides who may unblock, unchanged); the vehicle row is locked before the check so a
-- concurrent pickup report or block cannot interleave between the check and the update. Grants unchanged (CREATE OR REPLACE).
-- Classification: CONTRACT (narrows an existing mutation). Apply after the app; the app shows the generic action error banner.
create or replace function public.unblock_vehicle(p_vehicle_id uuid)
 returns void
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
  v_vehicle vehicles%rowtype;
  v_pending text[] := '{}';
  v_restored_status vehicle_status;
begin
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
$function$;

revoke all on function public.unblock_vehicle(uuid) from public, anon;
grant execute on function public.unblock_vehicle(uuid) to authenticated;
