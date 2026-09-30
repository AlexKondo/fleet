-- Two related fixes from a live user report:
--
-- 1. Carpool matching was fully automatic and implicit — whoever booked first was never
--    asked whether they're okay sharing the vehicle with a stranger going the same way.
--    Adds an explicit opt-in the requester answers at booking time (defaults to true so
--    existing carpool-matching behavior for prior bookings is unaffected retroactively —
--    only new requests carry a real answer).
--
-- 2. The return-time tolerance for treating two trips as carpool-compatible was 30 minutes
--    (0002_operational_cycle.sql) — too tight for what the user actually wants ("mesma
--    região e diferença de 2hrs no retorno deveria permitir"). Raised the default to 120
--    minutes; existing organization_settings rows are updated in place. Departure
--    tolerance is left at 30 minutes — only return was reported as too strict.

alter table trip_requests
  add column allow_carpool boolean not null default true;

alter table organization_settings
  alter column carpool_return_tolerance_minutes set default 120;

update organization_settings
  set carpool_return_tolerance_minutes = 120
  where carpool_return_tolerance_minutes = 30;

-- create_vehicle_reservation (last redefined in 0008_notifications.sql) — same body, plus
-- the new p_allow_carpool param stored on the trip_requests row. Defaulted to true so any
-- caller that hasn't been updated yet (there should be none after this deploy, but RPC
-- signature changes are not atomic with the app deploy) keeps working.
create or replace function create_vehicle_reservation(
  p_departure_at timestamptz,
  p_expected_return_at timestamptz,
  p_origin text,
  p_destination text,
  p_distance_km numeric,
  p_passenger_count integer,
  p_requires_cargo boolean,
  p_justification text,
  p_vehicle_id uuid,
  p_allow_carpool boolean default true
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
    distance_km, passenger_count, requires_cargo, justification, allow_carpool
  )
  values (
    v_org_id, auth.uid(), p_departure_at, p_expected_return_at, p_origin, p_destination,
    p_distance_km, p_passenger_count, p_requires_cargo, p_justification, p_allow_carpool
  )
  returning id into v_trip_id;

  insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at)
  values (v_org_id, p_vehicle_id, v_trip_id, 'pending_approval', p_departure_at, p_expected_return_at)
  returning id into v_reservation_id;

  insert into notifications (organization_id, user_id, title, body)
  select v_org_id, profiles.id, 'Nova reserva aguardando aprovação',
    'Uma nova viagem para ' || p_destination || ' aguarda aprovação.'
  from profiles
  where profiles.organization_id = v_org_id
    and profiles.role in ('fleet_manager', 'administrator');

  return v_reservation_id;
end;
$$;
