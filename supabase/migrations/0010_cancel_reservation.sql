-- W2 Availability/Reservation Core CRUD completion: cancel/reject a reservation.
-- `reservation_status` has had a 'cancelled' value since 0001_init_schema.sql, but no
-- code path anywhere in the app ever set it — a fleet manager had no way to reject a
-- pending_approval reservation or cancel a confirmed-but-not-yet-picked-up trip, and a
-- requester had no way to cancel their own upcoming trip. The only way to reach
-- 'cancelled' was a raw SQL UPDATE.

alter table reservations
  add column cancelled_by uuid references profiles (id),
  add column cancelled_at timestamptz,
  add column cancellation_reason text;

-- Authorization here is neither "any fleet manager" nor "the reservation's own
-- requester" alone but either/or — the same either/or shape record_return already
-- handles for who may perform a return inspection (0006/0008_*.sql). This mirrors that
-- function's SECURITY DEFINER + manual role/ownership check rather than adding a new
-- RLS policy, which would have to let a direct PostgREST call rewrite arbitrary
-- reservation columns for "your own" rows (start_at, vehicle_id, ...), not just status.
create or replace function cancel_reservation(p_reservation_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
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
  -- Lock the reservation row first, matching swap_reservation_vehicle's order
  -- (0005_fleet_manager_advanced_actions.sql: reservation `for update`, then vehicle rows
  -- `for update`) rather than approve_reservation's (vehicle first, reservation via its
  -- later UPDATE) — those two existing functions are themselves inconsistent with each
  -- other, and swap_reservation_vehicle is the one whose button sits directly next to
  -- Cancelar in the dashboard's active-reservations row, so it is the concrete concurrent
  -- caller this function must not deadlock against. Locking reservation-first here means
  -- a genuine (pre-existing, out of scope for this change) deadlock risk still remains
  -- between cancel_reservation and approve_reservation specifically — documented as a
  -- known residual risk, not fixed by this migration.
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

  -- Release the vehicle back to 'available' only if this cancellation is the thing
  -- holding it 'reserved', and no other confirmed reservation still legitimately needs
  -- it (same re-derivation-by-counting style swap_reservation_vehicle uses for the old
  -- vehicle it releases).
  if v_reservation_status = 'confirmed' and v_vehicle_status = 'reserved' then
    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_vehicle_id and id <> p_reservation_id and status = 'confirmed';
    if v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now() where id = v_vehicle_id;
    end if;
  end if;

  -- Notify the requester only when someone else (a fleet manager) cancelled their trip
  -- — no point notifying a user of their own action.
  if auth.uid() is distinct from v_requester_id then
    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_requester_id, 'Reserva cancelada',
      case when p_reason is not null and length(trim(p_reason)) > 0
        then 'Sua reserva foi cancelada: ' || p_reason
        else 'Sua reserva foi cancelada.'
      end
    );
  end if;
end;
$$;

grant execute on function cancel_reservation(uuid, text) to authenticated;
