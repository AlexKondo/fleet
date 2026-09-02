-- §5 Fleet Manager advanced actions: "Substituir veículos" (swap the vehicle assigned to
-- an existing reservation) and "Transferir reservas" (transfer a reservation to a
-- different requester). Same conventions as 0004_operational_actions.sql: SECURITY
-- INVOKER (the default), one plpgsql function body = one transaction, and the resulting
-- vehicle status is re-derived from DB state rather than trusted from the client.

-- ---------------------------------------------------------------------------
-- swap_reservation_vehicle: move an active reservation from its current vehicle to a
-- different one.
--
-- Guards:
--   * the reservation must still be pending_approval or confirmed (once completed, or
--     once the vehicle for this reservation is already in_use/returning, the trip is
--     already underway and swapping the vehicle out from under it makes no sense);
--   * the target vehicle must currently be 'available' — anything else (reserved,
--     in_use, maintenance, blocked, ...) means it is already committed elsewhere and is
--     not a safe swap target;
--   * the target vehicle must not have a conflicting active reservation for this
--     reservation's time window. This is NOT re-implemented here — moving
--     reservations.vehicle_id re-triggers the same btree_gist EXCLUDE constraint
--     (0001_init_schema.sql) that prevents double booking on INSERT, so a genuine
--     conflict raises a Postgres exclusion_violation, caught below and turned into a
--     clean error instead of the raw constraint message.
--
-- Status transition: mirrors approve_reservation in 0004 — a 'confirmed' reservation
-- implies its vehicle was moved to 'reserved' by approve_reservation, so the new vehicle
-- makes the same transition and the old vehicle is offered back to 'available' (unless
-- some other confirmed reservation still legitimately holds it 'reserved' — vehicle
-- status is one field shared across all of a vehicle's reservations, so this is
-- re-derived by counting, the same defensive style complete_workflow_task uses for
-- workflow_tasks). A 'pending_approval' reservation never touched vehicle status in the
-- first place (only approve_reservation does), so neither vehicle's status changes.
create or replace function swap_reservation_vehicle(p_reservation_id uuid, p_new_vehicle_id uuid)
returns void
language plpgsql
as $$
declare
  v_old_vehicle_id uuid;
  v_reservation_status reservation_status;
  v_old_vehicle_status vehicle_status;
  v_new_vehicle_status vehicle_status;
  v_first_id uuid;
  v_second_id uuid;
  v_other_confirmed_count integer;
begin
  select vehicle_id, status into v_old_vehicle_id, v_reservation_status
    from reservations where id = p_reservation_id for update;
  if v_old_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;
  if v_reservation_status not in ('pending_approval', 'confirmed') then
    raise exception 'Cannot swap vehicle on a reservation with status %', v_reservation_status;
  end if;
  if p_new_vehicle_id = v_old_vehicle_id then
    raise exception 'New vehicle is the same as the currently assigned vehicle';
  end if;

  -- Lock both vehicle rows in a stable (id-ascending) order, regardless of which one is
  -- "old" and which is "new" for this call — otherwise two concurrent swaps between the
  -- same pair of vehicles in opposite directions could deadlock against each other.
  if v_old_vehicle_id < p_new_vehicle_id then
    v_first_id := v_old_vehicle_id;
    v_second_id := p_new_vehicle_id;
  else
    v_first_id := p_new_vehicle_id;
    v_second_id := v_old_vehicle_id;
  end if;
  perform 1 from vehicles where id = v_first_id for update;
  perform 1 from vehicles where id = v_second_id for update;

  select status into v_old_vehicle_status from vehicles where id = v_old_vehicle_id;
  select status into v_new_vehicle_status from vehicles where id = p_new_vehicle_id;
  if v_new_vehicle_status is null then
    raise exception 'Target vehicle not found';
  end if;
  if v_old_vehicle_status in ('in_use', 'returning') then
    raise exception 'This trip is already underway on the current vehicle (status: %); cannot swap', v_old_vehicle_status;
  end if;
  if v_new_vehicle_status is distinct from 'available' then
    raise exception 'Target vehicle is not available (current status: %)', v_new_vehicle_status;
  end if;

  begin
    update reservations set vehicle_id = p_new_vehicle_id where id = p_reservation_id;
    if not found then
      raise exception 'Not authorized to swap this reservation, or it no longer exists';
    end if;
  exception
    when exclusion_violation then
      raise exception 'Target vehicle already has a conflicting reservation for this time window';
  end;

  if v_reservation_status = 'confirmed' then
    update vehicles set status = 'reserved', updated_at = now() where id = p_new_vehicle_id;

    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_old_vehicle_id and id <> p_reservation_id and status = 'confirmed';

    if v_old_vehicle_status = 'reserved' and v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now() where id = v_old_vehicle_id;
    end if;
  end if;
end;
$$;

grant execute on function swap_reservation_vehicle(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- transfer_reservation: reassign the requester on a reservation's underlying
-- trip_request to a different profile in the same organization. Purely an identity
-- change — it never touches the vehicle or the reservation's time window, so none of
-- the double-booking machinery is relevant here.
--
-- Guard: blocked once the reservation is 'completed' (the trip already happened under
-- the original requester; reassigning it after the fact would rewrite history rather
-- than transfer an upcoming trip).
create or replace function transfer_reservation(p_reservation_id uuid, p_new_requester_id uuid)
returns void
language plpgsql
as $$
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
$$;

grant execute on function transfer_reservation(uuid, uuid) to authenticated;

-- Authorization model for this file:
-- Both functions run as SECURITY INVOKER (the default, same as most of 0004). Neither
-- hand-rolls a role check — the operative statement in each function is a plain UPDATE
-- (`update reservations set vehicle_id = ...` / `update trip_requests set requester_id
-- = ...`) governed by the existing RLS policies "fleet managers manage reservations" and
-- "fleet managers manage all trip requests" (0001_init_schema.sql), both scoped to
-- fleet_manager/administrator. A caller without that role updates 0 rows on the gating
-- statement and hits the explicit `if not found` guard right after it — same pattern
-- 0004's approve_reservation/block_vehicle/unblock_vehicle rely on. The earlier SELECTs
-- (reading the reservation, locking both vehicles, reading the target profile's
-- organization_id) all use the more permissive "members read own organization ..."
-- SELECT policies, which is fine: they only ever gate on organization membership, never
-- on write authorization, and returning early with "not found" for a cross-organization
-- id leaks nothing beyond what any org member could already see via a normal SELECT.
