-- BR-019/BR-020/J-13 (docs/instruction.md's referenced Controlled Engineering Set):
-- "the system must search for eligible alternative vehicles" when a delay impacts the
-- next reservation — previously post_reservation_message (0017) only detected impact and
-- notified; a fleet_manager had to reassign manually. This migration:
--   1. changes post_reservation_message to RETURN which reservations it just marked
--      impacted, so the application layer (which owns the Mobility Decision Engine —
--      packages/domain/src/mobility-engine/recommend.ts — see the "why not in SQL" note
--      below) can attempt automatic reassignment for each one;
--   2. adds auto_reassign_reservation_vehicle, a service-role-only sibling of
--      swap_reservation_vehicle (0005) for that automated step; and
--   3. has swap_reservation_vehicle (manual path too) clear impacted_at/impacted_reason
--      on a successful swap, so a resolved impact stops showing as at-risk.
--
-- Why the eligibility decision is NOT made in SQL: recommendVehicle already encodes
-- capacity/cargo/Trip-Specific-Readiness/energy-range eligibility and ranking — the same
-- engine every other recommendation in this product goes through. Re-implementing that in
-- plpgsql would duplicate and risk diverging from it (the exact anti-pattern King-Kondo's
-- own rules warn against: "não transforme o Mobility Decision Engine em um filtro").
-- Postgres has no path to call into the TypeScript domain package, so the decision is made
-- in the Next.js server action (apps/web/app/reservations/[id]/actions.ts) instead, which
-- then calls auto_reassign_reservation_vehicle to execute whatever it decided.

-- ---------------------------------------------------------------------------
-- post_reservation_message: return type changes from uuid to jsonb (drop first — same
-- reason record_return's stale-overload bug in 0009_fixes.sql explains: `create or
-- replace` cannot change a function's return type, only `drop` + `create` can).
-- ---------------------------------------------------------------------------
drop function if exists post_reservation_message(uuid, message_type, text, timestamptz);

create function post_reservation_message(
  p_reservation_id uuid,
  p_message_type message_type,
  p_body text,
  p_new_expected_return_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_requester_id uuid;
  v_source_end_at timestamptz;
  v_source_trip_in_progress boolean;
  v_caller_role user_role;
  v_message_id uuid;
  v_impacted record;
  v_impacted_ids uuid[] := '{}';
begin
  select r.vehicle_id, tr.requester_id, r.end_at into v_vehicle_id, v_requester_id, v_source_end_at
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_requester_id
     and v_caller_role not in ('fleet_manager', 'administrator', 'security') then
    raise exception 'Not authorized to message on this reservation';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Message body cannot be empty';
  end if;

  insert into reservation_messages (organization_id, reservation_id, sender_id, message_type, body)
  values (v_org_id, p_reservation_id, auth.uid(), p_message_type, p_body)
  returning id into v_message_id;

  -- Round-3 review fix: a 'delay' message only means something if the SOURCE
  -- RESERVATION's own trip is actually underway. Round 2's fix checked
  -- vehicles.status = 'in_use' instead, which turned out to still be bypassable:
  -- vehicles.status is one field shared by every reservation that has ever used that
  -- vehicle (a fleet vehicle is legitimately booked by many sequential reservations —
  -- that's the entire premise of "the next reservation on this vehicle"), so "the
  -- vehicle is in_use" only proves SOME reservation on it is active, not that
  -- p_reservation_id specifically is. Without this, any requester could post a
  -- fabricated delay on their own not-yet-started (or already-completed) reservation
  -- whenever that same vehicle happened to be genuinely in_use for someone else's
  -- unrelated current trip, and trigger impact detection/notifications/automatic
  -- reassignment against a third reservation with no real delay anywhere. Scoping to
  -- p_reservation_id itself via its own pickup/return inspection history (record_pickup
  -- inserts a 'pickup' inspection row per reservation; record_return inserts 'return')
  -- closes that: only true if THIS reservation was picked up and not yet returned. The
  -- message itself is still recorded either way (informational); only the cascading
  -- side effects below are gated on this.
  select
    exists (select 1 from inspections where reservation_id = p_reservation_id and type = 'pickup')
    and not exists (select 1 from inspections where reservation_id = p_reservation_id and type = 'return')
    into v_source_trip_in_progress;

  -- Only reservations genuinely scheduled AFTER the delayed trip's own original end
  -- (v_source_end_at) are "next" and at risk — see 0017's original comment for why this
  -- lower bound exists (round-1 review fix).
  if p_message_type = 'delay' and p_new_expected_return_at is not null
     and v_source_trip_in_progress then
    for v_impacted in
      select r2.id, tr2.requester_id
      from reservations r2
      join trip_requests tr2 on tr2.id = r2.trip_request_id
      where r2.organization_id = v_org_id
        and r2.vehicle_id = v_vehicle_id
        and r2.id <> p_reservation_id
        and r2.status in ('pending_approval', 'confirmed')
        and r2.start_at >= v_source_end_at
        and r2.start_at < p_new_expected_return_at
    loop
      update reservations set impacted_at = now(), impacted_reason = p_body
        where id = v_impacted.id;
      v_impacted_ids := array_append(v_impacted_ids, v_impacted.id);

      insert into notifications (organization_id, user_id, title, body)
      values (
        v_org_id, v_impacted.requester_id, 'Sua próxima reserva pode ser afetada',
        'Um atraso na viagem anterior deste veículo pode afetar o horário da sua reserva. Buscando um veículo alternativo automaticamente.'
      );

      insert into notifications (organization_id, user_id, title, body)
      select v_org_id, profiles.id, 'Reserva marcada como impactada',
        'Um atraso pode afetar a próxima reserva deste veículo — o sistema tentará reatribuir automaticamente.'
      from profiles
      where profiles.organization_id = v_org_id
        and profiles.role in ('fleet_manager', 'administrator');
    end loop;
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_message_posted', 'reservation', p_reservation_id,
    null, jsonb_build_object('message_type', p_message_type)
  );

  return jsonb_build_object('message_id', v_message_id, 'impacted_reservation_ids', to_jsonb(v_impacted_ids));
end;
$$;

grant execute on function post_reservation_message(uuid, message_type, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- swap_reservation_vehicle (manual path, dashboard "Trocar Veículo") — same body as
-- 0015, plus clearing impacted_at/impacted_reason on the swapped reservation: a manual
-- reassignment resolves being at-risk exactly as an automatic one does.
-- ---------------------------------------------------------------------------
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
    update reservations
      set vehicle_id = p_new_vehicle_id, impacted_at = null, impacted_reason = null
      where id = p_reservation_id;
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

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_vehicle_reassigned', 'reservation',
    p_reservation_id,
    jsonb_build_object('vehicle_id', v_old_vehicle_id),
    jsonb_build_object('vehicle_id', p_new_vehicle_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- auto_reassign_reservation_vehicle: automated counterpart to swap_reservation_vehicle,
-- called from apps/web/app/reservations/[id]/actions.ts via the service-role admin
-- client after the Mobility Decision Engine (recommendVehicle) has already picked a
-- fully-ready replacement. NOT a thin service-role wrapper around
-- swap_reservation_vehicle — that function is SECURITY INVOKER and relies entirely on
-- its caller's own RLS ("fleet managers manage reservations") for tenant/authorization
-- scoping; RLS is bypassed for service_role, so calling it as-is via the admin client
-- would let it touch any organization's reservation. This function re-derives every
-- scoping check explicitly instead (p_organization_id verified against both the
-- reservation and the target vehicle), the same pattern
-- update_member_role/lock_and_require_multiple_administrators (0013) already use for
-- service-role-only automation — and is granted to service_role alone, never
-- authenticated, for the same reason those two are.
--
-- Why this needs to be system-triggered rather than running as the reporting user's own
-- session: the person posting the delay message is very often the affected driver
-- themself (an 'employee'), who has no general right to reassign a DIFFERENT
-- reservation's vehicle (ACTORS_AND_PERMISSIONS.md scopes that to Fleet Manager). The
-- reassignment is the system executing a documented rule (BR-019/BR-020), not the
-- reporting user's own action — matching ACTORS_AND_PERMISSIONS.md's SYSTEM_AUTOMATION
-- actor ("can... execute reallocation where rule allows").
create function auto_reassign_reservation_vehicle(
  p_organization_id uuid,
  p_reservation_id uuid,
  p_new_vehicle_id uuid
) returns void
language plpgsql
security definer
set search_path = public
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
    from reservations
    where id = p_reservation_id and organization_id = p_organization_id
    for update;
  if v_old_vehicle_id is null then
    raise exception 'Reservation not found in this organization';
  end if;
  if v_reservation_status not in ('pending_approval', 'confirmed') then
    raise exception 'Cannot auto-reassign a reservation with status %', v_reservation_status;
  end if;
  if p_new_vehicle_id = v_old_vehicle_id then
    raise exception 'New vehicle is the same as the currently assigned vehicle';
  end if;

  if v_old_vehicle_id < p_new_vehicle_id then
    v_first_id := v_old_vehicle_id;
    v_second_id := p_new_vehicle_id;
  else
    v_first_id := p_new_vehicle_id;
    v_second_id := v_old_vehicle_id;
  end if;
  perform 1 from vehicles where id = v_first_id and organization_id = p_organization_id for update;
  perform 1 from vehicles where id = v_second_id and organization_id = p_organization_id for update;

  select status into v_old_vehicle_status
    from vehicles where id = v_old_vehicle_id and organization_id = p_organization_id;
  select status into v_new_vehicle_status
    from vehicles where id = p_new_vehicle_id and organization_id = p_organization_id;
  if v_new_vehicle_status is null then
    raise exception 'Target vehicle not found in this organization';
  end if;
  -- Deliberately NO "old vehicle already in_use/returning" guard here, unlike
  -- swap_reservation_vehicle: this function only ever runs for a reservation that
  -- hasn't started yet (p_reservation_id's own status is still pending_approval/
  -- confirmed, checked above) whose vehicle_id happens to point at the SAME vehicle a
  -- DIFFERENT, currently in-progress reservation just reported a delay on — that
  -- vehicle being 'in_use' right now is the entire reason this function is being
  -- called, not a reason to refuse. p_reservation_id's own trip was never underway on
  -- it. (This guard's absence was a confirmed bug in the first version of this
  -- function — it made every real invocation raise unconditionally, since the source
  -- vehicle is reliably 'in_use' whenever a delay is actually being reported on it.)
  if v_new_vehicle_status is distinct from 'available' then
    raise exception 'Target vehicle is not available (current status: %)', v_new_vehicle_status;
  end if;

  begin
    update reservations
      set vehicle_id = p_new_vehicle_id, impacted_at = null, impacted_reason = null
      where id = p_reservation_id and organization_id = p_organization_id;
    if not found then
      raise exception 'Reservation no longer exists in this organization';
    end if;
  exception
    when exclusion_violation then
      raise exception 'Target vehicle already has a conflicting reservation for this time window';
  end;

  if v_reservation_status = 'confirmed' then
    update vehicles set status = 'reserved', updated_at = now()
      where id = p_new_vehicle_id and organization_id = p_organization_id;

    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_old_vehicle_id and id <> p_reservation_id and status = 'confirmed';

    if v_old_vehicle_status = 'reserved' and v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now()
        where id = v_old_vehicle_id and organization_id = p_organization_id;
    end if;
  end if;

  -- p_actor_id is null on purpose: this is a system-initiated action, not a specific
  -- user's — log_audit_event's own guard (0015) only validates actor/org when
  -- auth.uid() is non-null, which it never is under the service-role key this function
  -- is restricted to.
  perform log_audit_event(
    p_organization_id, null, 'reservation_vehicle_auto_reassigned', 'reservation',
    p_reservation_id,
    jsonb_build_object('vehicle_id', v_old_vehicle_id),
    jsonb_build_object('vehicle_id', p_new_vehicle_id, 'trigger', 'delay_impact')
  );
end;
$$;

revoke all on function auto_reassign_reservation_vehicle(uuid, uuid, uuid) from public;
grant execute on function auto_reassign_reservation_vehicle(uuid, uuid, uuid) to service_role;
