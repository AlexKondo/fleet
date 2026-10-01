-- FleetMind Smart Carpool — Phase C4 audit fixes.
--
-- 1. WRITE LOCKDOWN. 0052 gave riders/hosts/fleet managers direct write policies on
--    carpool_offers and carpool_ride_requests, and Supabase default privileges give
--    `authenticated` (and `anon`) every table privilege. A normal employee JWT could therefore
--    INSERT a request with status='ACCEPTED', PATCH a request to ACCEPTED, or PATCH an offer to
--    seats_available=99 over PostgREST — bypassing the seat check, events, notifications, audit
--    and trip_participants. All writes now go through the security-definer RPCs only: the write
--    policies are dropped (SELECT policies stay) and the table privileges are revoked.
--    The only app access outside the RPCs is a SELECT (apps/web/app/carpool/actions.ts).
--
--    Same lens applied to the other C1-C4 tables:
--      carpool_events              no write policy existed (RLS already blocked) -> privileges revoked too
--      geo_provider_quota_counters no write policy existed (service-role writes only) -> privileges revoked too
--      carpool_policy_settings     manager INSERT (insert-only, versioned) is by design and stays;
--                                  UPDATE/DELETE had no policy -> privileges revoked (defense in depth)
--      corporate_mobility_points   manager write via RLS is intentional (admin UI) and stays;
--                                  anon loses all write privileges
--
-- 2. SERVER-ONLY CREATE. create_carpool_ride_request accepted route-evaluation numbers and
--    coordinates asserted by any authenticated caller (a direct call with 0/0 skipped the
--    server-side route search). It is DROPPED and replaced by create_carpool_ride_request_as_rider,
--    callable by service_role only, taking an explicit p_rider_id. apps/web authenticates the user
--    with the normal client, re-runs searchCompatibleCarpool server-side, and calls this with the
--    admin client using only server-derived numbers/coordinates.
--
-- 3. Trigger hardening: revalidation inside the trip_requests / reservations triggers can no
--    longer abort the underlying statement (cancel_reservation etc.): a failure is logged as a
--    WARNING and swallowed. Same function signatures (create or replace, no new overload).
--
-- Overload note: the old 8-arg create_carpool_ride_request signature is dropped in this file;
-- the new function has a different, unique name.

-- ---------------------------------------------------------------------------
-- 1. Write lockdown
-- ---------------------------------------------------------------------------

drop policy if exists "hosts manage their own carpool offers" on carpool_offers;
drop policy if exists "fleet managers manage carpool offers" on carpool_offers;
drop policy if exists "riders manage their own carpool ride requests" on carpool_ride_requests;
drop policy if exists "offer hosts respond to ride requests on their own offers" on carpool_ride_requests;
drop policy if exists "fleet managers manage carpool ride requests" on carpool_ride_requests;

revoke insert, update, delete, truncate, references, trigger on carpool_offers from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on carpool_ride_requests from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on carpool_events from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on geo_provider_quota_counters from anon, authenticated;
revoke update, delete, truncate, references, trigger on carpool_policy_settings from anon, authenticated;
revoke insert on carpool_policy_settings from anon;
revoke insert, update, delete, truncate, references, trigger on corporate_mobility_points from anon;
revoke truncate, references, trigger on corporate_mobility_points from authenticated;
-- anon has no business reading any of these either (their SELECT policies need a session anyway).
revoke select on carpool_offers, carpool_ride_requests, carpool_events, geo_provider_quota_counters,
  carpool_policy_settings, corporate_mobility_points from anon;

-- ---------------------------------------------------------------------------
-- 2. Server-only create
-- ---------------------------------------------------------------------------

drop function if exists create_carpool_ride_request(uuid, integer, jsonb, jsonb, timestamptz, uuid, numeric, numeric);
drop function if exists create_carpool_ride_request_as_rider(uuid, uuid, integer, jsonb, jsonb, timestamptz, uuid, numeric, numeric);

create function create_carpool_ride_request_as_rider(
  p_rider_id uuid,
  p_offer_id uuid,
  p_seats integer,
  p_pickup jsonb,
  p_dropoff jsonb,
  p_requested_departure_at timestamptz,
  p_client_request_id uuid,
  p_match_additional_distance_km numeric,
  p_match_additional_time_min numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := p_rider_id;
  v_org uuid;
  v_offer carpool_offers%rowtype;
  v_trip trip_requests%rowtype;
  v_existing carpool_ride_requests%rowtype;
  v_stale record;
  v_policy record;
  v_loc jsonb;
  v_request_id uuid;
begin
  if p_rider_id is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  -- The rider's organization comes from THEIR profile; the offer must be in that same org
  -- (a forged cross-org pairing is indistinguishable from a non-existent offer).
  select organization_id into v_org from profiles where id = p_rider_id;
  if v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  if p_client_request_id is null then
    raise exception 'CARPOOL_CLIENT_REQUEST_ID_REQUIRED';
  end if;

  -- Offer lock FIRST (same lock order as every other RPC): serializes requests/accepts on the
  -- offer and makes the idempotency check race-free.
  select * into v_offer from carpool_offers where id = p_offer_id and organization_id = v_org for update;
  if not found then
    raise exception 'CARPOOL_OFFER_NOT_FOUND';
  end if;

  select * into v_existing from carpool_ride_requests where client_request_id = p_client_request_id;
  if found then
    if v_existing.rider_id = v_uid and v_existing.organization_id = v_org
       and v_existing.carpool_offer_id = p_offer_id then
      return v_existing.id; -- idempotent replay: same key, same rider, same offer
    end if;
    raise exception 'CARPOOL_CLIENT_REQUEST_ID_CONFLICT';
  end if;

  if p_seats is null or p_seats < 1 then
    raise exception 'CARPOOL_INVALID_SEATS';
  end if;
  if p_requested_departure_at is null then
    raise exception 'CARPOOL_INVALID_DEPARTURE';
  end if;
  if p_match_additional_distance_km is null or p_match_additional_time_min is null
     or p_match_additional_distance_km < 0 or p_match_additional_time_min < 0 then
    raise exception 'CARPOOL_ROUTE_EVALUATION_REQUIRED';
  end if;
  foreach v_loc in array array[p_pickup, p_dropoff] loop
    -- CASE (not OR) so the numeric casts only run after the typeof checks pass.
    if v_loc is not null and not coalesce(
         case
           when jsonb_typeof(v_loc) <> 'object' then false
           when jsonb_typeof(v_loc #> '{coordinates,lat}') is distinct from 'number' then false
           when jsonb_typeof(v_loc #> '{coordinates,lng}') is distinct from 'number' then false
           else (v_loc #>> '{coordinates,lat}')::numeric between -90 and 90
                and (v_loc #>> '{coordinates,lng}')::numeric between -180 and 180
         end, false) then
      raise exception 'CARPOOL_INVALID_LOCATION';
    end if;
  end loop;

  select * into v_policy from carpool_policy_for_org(v_org) p;
  if not v_policy.carpool_enabled then
    raise exception 'CARPOOL_DISABLED_BY_POLICY';
  end if;

  select * into v_trip from trip_requests where id = v_offer.trip_request_id;
  if v_offer.host_id = v_uid then
    raise exception 'CARPOOL_CANNOT_REQUEST_OWN_OFFER';
  end if;
  if v_offer.status <> 'active' then
    raise exception 'CARPOOL_OFFER_NOT_ACTIVE';
  end if;
  if not carpool_host_trip_is_active(v_offer.trip_request_id) or v_trip.departure_at <= now() then
    raise exception 'CARPOOL_HOST_TRIP_INACTIVE';
  end if;

  -- Stale PENDING request by this rider on this offer: treat as expired NOW so the one-live-
  -- request unique index does not block a re-request until the daily cron runs.
  for v_stale in
    select id from carpool_ride_requests
      where carpool_offer_id = p_offer_id and rider_id = v_uid and status = 'PENDING'
        and created_at + make_interval(mins => v_policy.request_expiry_minutes) < now()
      for update
  loop
    -- DOMAIN-MIRROR rideRequest.expire: PENDING
    update carpool_ride_requests
      set status = 'EXPIRED', responded_at = now(), updated_at = now()
      where id = v_stale.id and status = 'PENDING';
    perform carpool_emit_event(v_org, 'RideExpired', p_offer_id, v_stale.id, v_offer.trip_request_id, null,
      jsonb_build_object('trigger', 're_request'));
    perform log_audit_event(v_org, null, 'carpool_ride_expired', 'carpool_ride_request', v_stale.id,
      jsonb_build_object('status', 'PENDING'),
      jsonb_build_object('status', 'EXPIRED', 'rider_id', v_uid, 'trigger', 're_request'));
  end loop;

  if v_offer.seats_offered - carpool_seats_taken(v_offer.id) < p_seats then
    raise exception 'CARPOOL_NO_SEATS_AVAILABLE';
  end if;
  if abs(extract(epoch from (p_requested_departure_at - v_trip.departure_at))) / 60.0 > v_policy.departure_window_minutes then
    raise exception 'CARPOOL_OUTSIDE_DEPARTURE_WINDOW';
  end if;
  if p_match_additional_distance_km > v_policy.max_additional_distance_km
     or p_match_additional_time_min > v_policy.max_additional_time_minutes then
    raise exception 'CARPOOL_DETOUR_EXCEEDS_POLICY';
  end if;

  insert into carpool_ride_requests (
    organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location,
    requested_departure_at, status, match_additional_distance_km, match_additional_time_min,
    policy_version, client_request_id, host_origin_snapshot, host_destination_snapshot
  ) values (
    v_org, p_offer_id, v_uid, p_seats, p_pickup, p_dropoff,
    p_requested_departure_at, 'PENDING', p_match_additional_distance_km, p_match_additional_time_min,
    v_policy.policy_version, p_client_request_id, v_trip.origin, v_trip.destination
  )
  on conflict (client_request_id) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select * into v_existing from carpool_ride_requests where client_request_id = p_client_request_id;
    if found and v_existing.rider_id = v_uid and v_existing.organization_id = v_org then
      return v_existing.id;
    end if;
    raise exception 'CARPOOL_CLIENT_REQUEST_ID_CONFLICT';
  end if;

  perform carpool_emit_event(v_org, 'RideRequested', p_offer_id, v_request_id, v_offer.trip_request_id, v_uid,
    jsonb_build_object('rider_id', v_uid, 'requested_seats', p_seats, 'policy_version', v_policy.policy_version));
  perform log_audit_event(v_org, v_uid, 'carpool_ride_requested', 'carpool_ride_request', v_request_id,
    null,
    jsonb_build_object('status', 'PENDING', 'offer_id', p_offer_id, 'host_id', v_offer.host_id,
                       'requested_seats', p_seats, 'policy_version', v_policy.policy_version,
                       'match_additional_distance_km', p_match_additional_distance_km,
                       'match_additional_time_min', p_match_additional_time_min,
                       'requested_departure_at', p_requested_departure_at,
                       'server_derived', true));

  if not v_policy.host_approval_required then
    perform carpool_apply_accept(v_request_id, v_uid, true);
  end if;

  return v_request_id;
end;
$$;

revoke all on function create_carpool_ride_request_as_rider(uuid, uuid, integer, jsonb, jsonb, timestamptz, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function create_carpool_ride_request_as_rider(uuid, uuid, integer, jsonb, jsonb, timestamptz, uuid, numeric, numeric)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Trigger hardening (same signatures as 0059 -> create or replace replaces in place)
-- ---------------------------------------------------------------------------

create or replace function carpool_trip_requests_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed text[] := array[]::text[];
begin
  if new.departure_at is distinct from old.departure_at then v_changed := array_append(v_changed, 'departure_at'); end if;
  if new.origin is distinct from old.origin then v_changed := array_append(v_changed, 'origin'); end if;
  if new.destination is distinct from old.destination then v_changed := array_append(v_changed, 'destination'); end if;
  if cardinality(v_changed) > 0 then
    begin
      perform carpool_revalidate_trip(new.id, auth.uid(), v_changed);
    exception when others then
      -- Carpool revalidation must never abort the host's own trip update.
      raise warning 'carpool_trip_requests_changed: revalidation failed for trip %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

create or replace function carpool_reservation_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform carpool_revalidate_trip(new.trip_request_id, auth.uid(), array[]::text[]);
  exception when others then
    -- Carpool revalidation must never abort cancel_reservation (or any other cancellation).
    raise warning 'carpool_reservation_cancelled: revalidation failed for trip %: %', new.trip_request_id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function carpool_trip_requests_changed() from public, anon, authenticated;
revoke all on function carpool_reservation_cancelled() from public, anon, authenticated;
