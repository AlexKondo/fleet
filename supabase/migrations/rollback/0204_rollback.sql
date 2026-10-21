-- Rollback of 0204: unblock_vehicle back to the 0029 definition (no condition check). Grants unchanged.
CREATE OR REPLACE FUNCTION public.unblock_vehicle(p_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$

;
