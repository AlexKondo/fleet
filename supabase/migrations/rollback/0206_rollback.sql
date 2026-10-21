-- Rollback of 0206: transfer_reservation back to the 0005 definition (no audit event). Grants unchanged.
CREATE OR REPLACE FUNCTION public.transfer_reservation(p_reservation_id uuid, p_new_requester_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_trip_request_id uuid;
  v_reservation_status reservation_status;
  v_org_id uuid := current_organization_id();
  v_new_requester_org uuid;
begin
  select trip_request_id, status into v_trip_request_id, v_reservation_status
    from reservations where id = p_reservation_id for update;
  if v_trip_request_id is null then
    raise exception 'Reservation not found';
  end if;
  if v_reservation_status = 'completed' then
    raise exception 'Cannot transfer a completed reservation';
  end if;

  select organization_id into v_new_requester_org from profiles where id = p_new_requester_id;
  if v_new_requester_org is null or v_new_requester_org is distinct from v_org_id then
    raise exception 'Target user is not a member of this organization';
  end if;

  update trip_requests set requester_id = p_new_requester_id where id = v_trip_request_id;
  if not found then
    raise exception 'Not authorized to transfer this reservation, or its trip request no longer exists';
  end if;
end;
$function$

;
