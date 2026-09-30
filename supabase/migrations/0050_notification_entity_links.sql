-- The notification bell (NotificationBell.tsx's notificationHref) only links a
-- notification straight to its reservation when entity_type/entity_id are set
-- (0040_message_notifications.sql added the columns, but only ever populated them for
-- reservation-message notifications) — "Reserva aprovada"/"Reserva cancelada" left them
-- null, so clicking either did nothing at all. Both functions are redefined here with the
-- exact same signature as their current live definition (CREATE OR REPLACE on an unchanged
-- parameter list replaces in place rather than creating a second overload — see 0049's
-- comment for what goes wrong when the signature itself changes instead).

create or replace function approve_reservation(p_reservation_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
  v_requester_id uuid;
begin
  select vehicle_id into v_vehicle_id from reservations where id = p_reservation_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status in ('maintenance', 'blocked') then
    raise exception 'Vehicle is not available to approve (current status: %)', v_vehicle_status;
  end if;

  update reservations
    set status = 'confirmed', approved_by = auth.uid(), approved_at = now()
    where id = p_reservation_id and status = 'pending_approval';
  if not found then
    raise exception 'Reservation is not pending approval';
  end if;

  if v_vehicle_status = 'available' then
    update vehicles set status = 'reserved', updated_at = now() where id = v_vehicle_id;
  end if;

  select tr.requester_id into v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id;

  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
  values (
    current_organization_id(), v_requester_id, 'Reserva aprovada',
    'Sua reserva foi aprovada e o veículo está confirmado.',
    'reservation', p_reservation_id
  );

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_approved', 'reservation',
    p_reservation_id, null, jsonb_build_object('status', 'confirmed')
  );
end;
$$;

create or replace function cancel_reservation(p_reservation_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_requester_id uuid;
  v_reservation_status reservation_status;
  v_vehicle_status vehicle_status;
  v_caller_role user_role;
  v_other_confirmed_count integer;
begin
  select r.vehicle_id, r.status, tr.requester_id
    into v_vehicle_id, v_reservation_status, v_requester_id
    from reservations r
    join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id
    for update of r;
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
$$;
