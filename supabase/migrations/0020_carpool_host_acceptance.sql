-- ISSUE-016 (MVP Remediation Pack v1.0, Wave A — Integrity & Safety): "Carpool must be
-- prioritized and require host-driver acceptance." Prioritization already worked
-- (planMobility checks carpool matches before recommending a new vehicle), but
-- create_carpool_participation (0003_trip_request_flow.sql) inserted the joining
-- passenger directly into trip_participants with no approval step at all — its own
-- comment said so explicitly: "the request itself represents the passenger accepting the
-- existing trip's schedule," backwards from the spec (the HOST driver, not the joining
-- passenger, must accept).
--
-- status defaults to 'accepted' so any pre-existing trip_participants rows (created
-- before this migration, under the old auto-accept model) remain valid without a backfill
-- — this migration changes no existing carpool's observed behavior, only how NEW join
-- requests are handled from here on.

alter table trip_participants
  add column status text not null default 'accepted' check (status in ('pending', 'accepted', 'rejected'));

-- create_carpool_participation — same signature as 0003_trip_request_flow.sql. New join
-- requests now start 'pending' instead of being auto-accepted, and the host driver is
-- notified (mirrors the existing "new reservation awaiting approval" notification pattern
-- for fleet managers in 0008_notifications.sql).
create or replace function create_carpool_participation(
  p_departure_at timestamptz,
  p_expected_return_at timestamptz,
  p_origin text,
  p_destination text,
  p_distance_km numeric,
  p_passenger_count integer,
  p_requires_cargo boolean,
  p_justification text,
  p_existing_trip_request_id uuid
) returns uuid
language plpgsql
as $$
declare
  v_org_id uuid := current_organization_id();
  v_trip_id uuid;
  v_participant_id uuid;
  v_host_id uuid;
begin
  insert into trip_requests (
    organization_id, requester_id, departure_at, expected_return_at, origin, destination,
    distance_km, passenger_count, requires_cargo, justification
  )
  values (
    v_org_id, auth.uid(), p_departure_at, p_expected_return_at, p_origin, p_destination,
    p_distance_km, p_passenger_count, p_requires_cargo, p_justification
  )
  returning id into v_trip_id;

  insert into trip_participants (organization_id, trip_request_id, passenger_id, passenger_count, status)
  values (v_org_id, p_existing_trip_request_id, auth.uid(), p_passenger_count, 'pending')
  returning id into v_participant_id;

  select requester_id into v_host_id from trip_requests where id = p_existing_trip_request_id;
  if v_host_id is not null then
    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_host_id, 'Pedido de carona na sua viagem',
      'Alguém pediu para participar da sua viagem para ' || p_destination || '. Acesse os detalhes da reserva para aceitar ou recusar.'
    );
  end if;

  return v_participant_id;
end;
$$;

-- Host-only accept/reject for a pending carpool join request. security definer because
-- the host driver does not own the trip_participants row (the joining passenger does) —
-- same shape as approve_reservation/cancel_reservation's manual role/ownership check
-- instead of a new RLS policy, which would have to let a direct PostgREST call rewrite
-- arbitrary trip_participants rows for "the trip you host," not just your own.
create or replace function respond_to_carpool_request(p_participant_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_trip_request_id uuid;
  v_passenger_id uuid;
  v_passenger_count integer;
  v_status text;
  v_host_id uuid;
  v_destination text;
  v_caller_role user_role;
  v_vehicle_capacity integer;
  v_accepted_occupancy integer;
  v_host_base_passengers integer;
begin
  select tp.trip_request_id, tp.passenger_id, tp.passenger_count, tp.status,
         tr.requester_id, tr.destination, tr.passenger_count
    into v_trip_request_id, v_passenger_id, v_passenger_count, v_status,
         v_host_id, v_destination, v_host_base_passengers
    from trip_participants tp
    join trip_requests tr on tr.id = tp.trip_request_id
    where tp.id = p_participant_id and tp.organization_id = v_org_id
    for update of tp;

  if v_trip_request_id is null then
    raise exception 'Carpool request not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_host_id
     and v_caller_role not in ('fleet_manager', 'administrator') then
    raise exception 'Not authorized to respond to this carpool request';
  end if;

  -- Re-derived, not trusted from a prior read — a second pending request could have been
  -- accepted between when the host's screen loaded and this call, same defense-in-depth
  -- principle as every other state transition in this app.
  if v_status is distinct from 'pending' then
    raise exception 'CARPOOL_REQUEST_ALREADY_RESOLVED';
  end if;

  if p_accept then
    select vc.passenger_capacity into v_vehicle_capacity
      from reservations r
      join vehicles v on v.id = r.vehicle_id
      join vehicle_categories vc on vc.id = v.category_id
      where r.trip_request_id = v_trip_request_id
      limit 1;

    select coalesce(sum(passenger_count), 0) into v_accepted_occupancy
      from trip_participants
      where trip_request_id = v_trip_request_id and status = 'accepted';

    if v_vehicle_capacity is not null
       and (coalesce(v_host_base_passengers, 0) + v_accepted_occupancy + v_passenger_count) > v_vehicle_capacity then
      raise exception 'CARPOOL_FULL';
    end if;

    update trip_participants set status = 'accepted' where id = p_participant_id;

    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_passenger_id, 'Carona aceita',
      'Sua solicitação de carona para ' || v_destination || ' foi aceita pelo motorista.'
    );
  else
    -- Rejected requests are deleted rather than kept as a 'rejected' row (mirrors
    -- leave_carpool's own reasoning, 0012_leave_carpool.sql): trip_participants
    -- membership is ephemeral, not an append-only ledger, and keeping the row would
    -- collide with the (trip_request_id, passenger_id) unique constraint if the same
    -- passenger ever wants to request again.
    delete from trip_participants where id = p_participant_id;

    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_passenger_id, 'Carona recusada',
      'Sua solicitação de carona para ' || v_destination || ' foi recusada pelo motorista.'
    );
  end if;
end;
$$;

grant execute on function respond_to_carpool_request(uuid, boolean) to authenticated;
