-- Rollback of 0200. The exception table is evidence: it is NOT dropped (DEC-03); the command is removed and cancel_reservation
-- returns to the 0181/0194 definition.
drop function if exists public.fm_operation_exception(uuid,text,text,uuid);
CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_locked_vehicle_id uuid;
  v_requester_id uuid;
  v_reservation_status reservation_status;
  v_vehicle_status vehicle_status;
  v_caller_role user_role;
  v_other_confirmed_count integer;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
  select vehicle_id into v_locked_vehicle_id from reservations where id=p_reservation_id and organization_id=v_org_id;
  perform 1 from vehicles where id=v_locked_vehicle_id and organization_id=v_org_id for update;
  select r.vehicle_id, r.status, tr.requester_id
    into v_vehicle_id, v_reservation_status, v_requester_id
    from reservations r
    join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id
    for update of r;
  if v_vehicle_id is distinct from v_locked_vehicle_id then raise exception 'CONCURRENT_UPDATE';end if;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_requester_id
     and v_caller_role not in ('fleet_manager', 'administrator') then
    raise exception 'Not authorized to cancel this reservation';
  end if;

  if v_reservation_status not in ('pending_approval', 'confirmed') then
    raise exception 'Cannot cancel a reservation with status %', v_reservation_status;
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status in ('in_use', 'returning') then
    raise exception 'This trip is already underway (vehicle status: %); it can no longer be cancelled, only returned', v_vehicle_status;
  end if;

  update reservations
    set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = p_reason
    where id = p_reservation_id and status = v_reservation_status;
  if not found then
    raise exception 'Reservation was modified concurrently, try again';
  end if;

  if v_reservation_status = 'confirmed' and v_vehicle_status = 'reserved' then
    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_vehicle_id and id <> p_reservation_id and status = 'confirmed';
    if v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now() where id = v_vehicle_id;
    end if;
  end if;

  if auth.uid() is distinct from v_requester_id then
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (
      v_org_id, v_requester_id, 'Reserva cancelada',
      case when p_reason is not null and length(trim(p_reason)) > 0
        then 'Sua reserva foi cancelada: ' || p_reason
        else 'Sua reserva foi cancelada.'
      end,
      'reservation', p_reservation_id
    );
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_cancelled', 'reservation', p_reservation_id,
    jsonb_build_object('status', v_reservation_status),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason)
  );
end;
$function$;
revoke all on function public.cancel_reservation(uuid,text) from public,anon;
grant execute on function public.cancel_reservation(uuid,text) to authenticated;
