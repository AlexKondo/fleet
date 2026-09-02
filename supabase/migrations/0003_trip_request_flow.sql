-- Closes a gap in 0001: only fleet_manager/administrator could INSERT into
-- reservations, but §5 ("Request -> Approval -> Reservation Confirmed") requires the
-- requester to create their own pending_approval reservation at request time — approval
-- is a separate later step, not a precondition for the request itself.
create policy "members create pending reservations for their own trip requests" on reservations
  for insert with check (
    organization_id = current_organization_id()
    and status = 'pending_approval'
    and exists (
      select 1 from trip_requests
      where trip_requests.id = reservations.trip_request_id
        and trip_requests.requester_id = auth.uid()
    )
  );

-- Atomic trip_request + reservation creation (Mobility Decision Engine "vehicle" path,
-- fleet-car-saas.txt §17). Runs as the caller (security invoker, the default) so RLS on
-- both inserts still applies; if the reservation insert loses the double-booking
-- EXCLUDE race, the whole function raises and the trip_request insert rolls back too —
-- no orphan trip_requests left behind.
create or replace function create_vehicle_reservation(
  p_departure_at timestamptz,
  p_expected_return_at timestamptz,
  p_origin text,
  p_destination text,
  p_distance_km numeric,
  p_passenger_count integer,
  p_requires_cargo boolean,
  p_justification text,
  p_vehicle_id uuid
) returns uuid
language plpgsql
as $$
declare
  v_org_id uuid := current_organization_id();
  v_trip_id uuid;
  v_reservation_id uuid;
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

  insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at)
  values (v_org_id, p_vehicle_id, v_trip_id, 'pending_approval', p_departure_at, p_expected_return_at)
  returning id into v_reservation_id;

  return v_reservation_id;
end;
$$;

grant execute on function create_vehicle_reservation(
  timestamptz, timestamptz, text, text, numeric, integer, boolean, text, uuid
) to authenticated;

-- Atomic trip_request + trip_participants creation (Mobility Decision Engine "carpool"
-- path, §4). No approval step for joining — the request itself represents the
-- passenger accepting the existing trip's schedule.
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

  insert into trip_participants (organization_id, trip_request_id, passenger_id, passenger_count)
  values (v_org_id, p_existing_trip_request_id, auth.uid(), p_passenger_count)
  returning id into v_participant_id;

  return v_participant_id;
end;
$$;

grant execute on function create_carpool_participation(
  timestamptz, timestamptz, text, text, numeric, integer, boolean, text, uuid
) to authenticated;
