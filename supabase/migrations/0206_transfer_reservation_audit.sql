-- 0206 (FIX-SQL-2 / SQL-2): transfer_reservation changed the requester without an audit_log row, unlike approve / cancel /
-- vehicle reassignment. Adds the 'reservation_transferred' event (entity reservation; before/after requester), written in the same
-- transaction as the change. Authorization, validations and error messages are unchanged (still SECURITY INVOKER: RLS of
-- trip_requests decides who may transfer); the old requester is read under the reservation row lock already taken.
-- Classification: EXPAND (additive audit). Grants unchanged.
create or replace function public.transfer_reservation(p_reservation_id uuid, p_new_requester_id uuid)
 returns void
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
  v_trip_request_id uuid;
  v_reservation_status reservation_status;
  v_org_id uuid := current_organization_id();
  v_new_requester_org uuid;
  v_old_requester_id uuid;
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

  select requester_id into v_old_requester_id from trip_requests where id = v_trip_request_id;

  update trip_requests set requester_id = p_new_requester_id where id = v_trip_request_id;
  if not found then
    raise exception 'Not authorized to transfer this reservation, or its trip request no longer exists';
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_transferred', 'reservation', p_reservation_id,
    jsonb_build_object('requester_id', v_old_requester_id, 'status', v_reservation_status),
    jsonb_build_object('requester_id', p_new_requester_id, 'trip_request_id', v_trip_request_id)
  );
end;
$function$;

revoke all on function public.transfer_reservation(uuid,uuid) from public, anon;
grant execute on function public.transfer_reservation(uuid,uuid) to authenticated;
