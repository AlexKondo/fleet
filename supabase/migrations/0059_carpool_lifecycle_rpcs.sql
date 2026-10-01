-- FleetMind Smart Carpool & Geospatial Intelligence — Phase C4, part 3 of 3: the public
-- lifecycle RPCs, the revalidation engine, the expiry sweep and the host-trip triggers.
--
-- OVERLOAD AUDIT: every function below is NEW (no earlier migration defines any of these
-- names). Each `create function` is preceded by `drop function if exists <exact signature>`
-- so re-applying this file can never leave a second overload behind (0047 -> 0049). The
-- legacy create_carpool_participation / respond_to_carpool_request are NOT touched.
--
-- GRANT AUDIT: Supabase default privileges grant EXECUTE on new public functions to anon and
-- authenticated; `revoke ... from public` does not remove those (0055 -> 0056). Each public
-- RPC therefore does `revoke all ... from public, anon` and grants only `authenticated`.
-- Internal helpers/triggers/cron RPC revoke anon AND authenticated and grant service_role only.
--
-- SECURITY MODEL: every RPC is SECURITY DEFINER with a fixed search_path and re-authenticates
-- by hand (auth.uid(), current_organization_id(), profile role) because it must touch rows the
-- caller does not own (host <-> rider). Every lookup is filtered by the caller's organization,
-- so a forged id from another tenant is indistinguishable from a non-existent id.
--
-- LOCK ORDER (deadlock-free): offer row FIRST (FOR UPDATE), then the ride-request row
-- (FOR UPDATE). seats_available is re-derived inside the lock as
-- seats_offered - sum(ACCEPTED requested_seats), never trusted from a prior read.
--
-- TRANSITION MIRRORS: the guards below mirror the pure functions in
-- packages/domain/src/carpool/{rideRequest,carpoolOffer,revalidation}.ts. Lines of the form
--   -- DOMAIN-MIRROR <module.function>: <allowed from-statuses>
-- are parsed by packages/domain/src/carpool/sqlMirror.test.ts, which fails if the SQL and the
-- domain function ever disagree.

-- ---------------------------------------------------------------------------
-- Internal: seat recompute, invalidation of a single live request
-- ---------------------------------------------------------------------------

drop function if exists carpool_recompute_seats(uuid);
drop function if exists carpool_invalidate_request(uuid, text, uuid);
drop function if exists carpool_apply_accept(uuid, uuid, boolean);
drop function if exists carpool_revalidate_trip(uuid, uuid, text[]);
drop function if exists carpool_trip_requests_changed() cascade;
drop function if exists carpool_reservation_cancelled() cascade;

create function carpool_recompute_seats(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update carpool_offers
    set seats_available = greatest(0, seats_offered - carpool_seats_taken(p_offer_id)),
        updated_at = now()
    where id = p_offer_id;
end;
$$;

-- Moves ONE live (PENDING/ACCEPTED) request to INVALIDATED, removes its participant row if it
-- had been accepted, emits RideInvalidated and audits. Caller holds the offer lock and calls
-- carpool_recompute_seats afterwards.
create function carpool_invalidate_request(p_request_id uuid, p_reason text, p_actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req carpool_ride_requests%rowtype;
  v_trip_request_id uuid;
begin
  select * into v_req from carpool_ride_requests where id = p_request_id for update;
  if not found then
    return false;
  end if;
  -- DOMAIN-MIRROR revalidation.invalidateLiveRequest: PENDING, ACCEPTED
  if v_req.status not in ('PENDING', 'ACCEPTED') then
    return false;
  end if;

  select trip_request_id into v_trip_request_id from carpool_offers where id = v_req.carpool_offer_id;

  update carpool_ride_requests
    set status = 'INVALIDATED', responded_at = now(), responded_by = p_actor_id, updated_at = now()
    where id = p_request_id;

  if v_req.status = 'ACCEPTED' then
    delete from trip_participants
      where trip_request_id = v_trip_request_id and passenger_id = v_req.rider_id;
  end if;

  perform carpool_emit_event(
    v_req.organization_id, 'RideInvalidated', v_req.carpool_offer_id, v_req.id, v_trip_request_id,
    p_actor_id, jsonb_build_object('reason', p_reason, 'previous_status', v_req.status,
                                   'seats_released', case when v_req.status = 'ACCEPTED' then v_req.requested_seats else 0 end)
  );
  perform log_audit_event(
    v_req.organization_id, p_actor_id, 'carpool_ride_invalidated', 'carpool_ride_request', v_req.id,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', 'INVALIDATED', 'reason', p_reason, 'policy_version', v_req.policy_version,
                       'rider_id', v_req.rider_id)
  );
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: revalidation core (used by the public RPC and by the host-trip triggers)
-- ---------------------------------------------------------------------------
-- For every ACTIVE offer on the trip, every live request is re-checked against the trip's
-- CURRENT state and invalidated with a reason when:
--   HOST_TRIP_CANCELLED   - the trip has no active reservation any more
--   HOST_SCHEDULE_CHANGED - |requested_departure_at - trip.departure_at| > policy window
--   HOST_ROUTE_CHANGED    - trip origin/destination text differs from the snapshot taken at
--                           request time (no provider call is possible in SQL, so a changed
--                           route fails closed; the rider simply searches again)
-- p_changed_fields non-empty => the caller observed a real change and a HostTripChanged event
-- is emitted when the offer had live requests.
create function carpool_revalidate_trip(p_trip_request_id uuid, p_actor_id uuid, p_changed_fields text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip trip_requests%rowtype;
  v_active boolean;
  v_offer carpool_offers%rowtype;
  v_req carpool_ride_requests%rowtype;
  v_window integer;
  v_reason text;
  v_live_before integer;
  v_invalidated integer;
  v_total_invalidated integer := 0;
  v_survivors jsonb;
begin
  select * into v_trip from trip_requests where id = p_trip_request_id;
  if not found then
    return jsonb_build_object('invalidated', 0, 'kept', 0);
  end if;
  v_active := carpool_host_trip_is_active(p_trip_request_id);

  for v_offer in
    select * from carpool_offers
      where trip_request_id = p_trip_request_id and status = 'active'
      order by id
      for update
  loop
    select p.departure_window_minutes into v_window from carpool_policy_for_org(v_offer.organization_id) p;
    v_live_before := 0;
    v_invalidated := 0;
    v_survivors := '[]'::jsonb;

    for v_req in
      select * from carpool_ride_requests
        where carpool_offer_id = v_offer.id and status in ('PENDING', 'ACCEPTED')
        order by created_at, id
        for update
    loop
      v_live_before := v_live_before + 1;
      v_reason := null;
      if not v_active then
        v_reason := 'HOST_TRIP_CANCELLED';
      elsif abs(extract(epoch from (v_req.requested_departure_at - v_trip.departure_at))) / 60.0 > v_window then
        v_reason := 'HOST_SCHEDULE_CHANGED';
      elsif (v_req.host_destination_snapshot is not null
             and carpool_norm_text(v_req.host_destination_snapshot) <> carpool_norm_text(v_trip.destination))
         or (v_req.host_origin_snapshot is not null
             and carpool_norm_text(v_req.host_origin_snapshot) <> carpool_norm_text(v_trip.origin)) then
        v_reason := 'HOST_ROUTE_CHANGED';
      end if;

      if v_reason is not null then
        if carpool_invalidate_request(v_req.id, v_reason, p_actor_id) then
          v_invalidated := v_invalidated + 1;
        end if;
      else
        v_survivors := v_survivors || to_jsonb(v_req.rider_id::text);
      end if;
    end loop;

    v_total_invalidated := v_total_invalidated + v_invalidated;

    if not v_active then
      update carpool_offers set status = 'disabled', updated_at = now() where id = v_offer.id;
    end if;
    perform carpool_recompute_seats(v_offer.id);

    if not v_active then
      perform carpool_emit_event(
        v_offer.organization_id, 'HostTripCancelled', v_offer.id, null, p_trip_request_id, p_actor_id,
        jsonb_build_object('invalidated_requests', v_invalidated)
      );
      perform log_audit_event(
        v_offer.organization_id, p_actor_id, 'carpool_host_trip_cancelled', 'carpool_offer', v_offer.id,
        jsonb_build_object('status', 'active'),
        jsonb_build_object('status', 'disabled', 'invalidated_requests', v_invalidated,
                           'policy_version', v_offer.policy_version)
      );
    elsif coalesce(cardinality(p_changed_fields), 0) > 0 and v_live_before > 0 then
      perform carpool_emit_event(
        v_offer.organization_id, 'HostTripChanged', v_offer.id, null, p_trip_request_id, p_actor_id,
        jsonb_build_object('changed_fields', to_jsonb(p_changed_fields),
                           'invalidated_requests', v_invalidated,
                           'surviving_rider_ids', v_survivors)
      );
      perform log_audit_event(
        v_offer.organization_id, p_actor_id, 'carpool_host_trip_changed', 'carpool_offer', v_offer.id,
        null,
        jsonb_build_object('changed_fields', to_jsonb(p_changed_fields),
                           'invalidated_requests', v_invalidated, 'policy_version', v_offer.policy_version)
      );
    end if;
  end loop;

  return jsonb_build_object('invalidated', v_total_invalidated, 'trip_active', v_active);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: accept core (shared by accept_carpool_ride_request and auto-accept)
-- ---------------------------------------------------------------------------
-- Caller has locked the offer row and the request row (in that order).
create function carpool_apply_accept(p_request_id uuid, p_actor_id uuid, p_auto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req carpool_ride_requests%rowtype;
  v_offer carpool_offers%rowtype;
  v_trip trip_requests%rowtype;
  v_expiry integer;
  v_available integer;
begin
  select * into v_req from carpool_ride_requests where id = p_request_id;
  select * into v_offer from carpool_offers where id = v_req.carpool_offer_id;
  select * into v_trip from trip_requests where id = v_offer.trip_request_id;

  -- DOMAIN-MIRROR rideRequest.accept: PENDING
  if v_req.status <> 'PENDING' then
    raise exception 'CARPOOL_REQUEST_NOT_PENDING';
  end if;
  if v_offer.status <> 'active' then
    raise exception 'CARPOOL_OFFER_NOT_ACTIVE';
  end if;
  if not carpool_host_trip_is_active(v_offer.trip_request_id) or v_trip.departure_at <= now() then
    raise exception 'CARPOOL_HOST_TRIP_INACTIVE';
  end if;

  select p.request_expiry_minutes into v_expiry from carpool_policy_for_org(v_offer.organization_id) p;
  if not p_auto and v_req.created_at + make_interval(mins => v_expiry) < now() then
    raise exception 'CARPOOL_REQUEST_EXPIRED';
  end if;

  v_available := v_offer.seats_offered - carpool_seats_taken(v_offer.id);
  if v_available < v_req.requested_seats then
    raise exception 'CARPOOL_NO_SEATS_AVAILABLE';
  end if;

  update carpool_offers
    set seats_available = v_available - v_req.requested_seats, updated_at = now()
    where id = v_offer.id;

  -- Keep the existing participant lifecycle working (check-in lists, leave_carpool, the
  -- reservation page's accepted-occupancy math all read trip_participants).
  insert into trip_participants (organization_id, trip_request_id, passenger_id, passenger_count, status)
  values (v_req.organization_id, v_offer.trip_request_id, v_req.rider_id, v_req.requested_seats, 'accepted')
  on conflict (trip_request_id, passenger_id)
  do update set status = 'accepted', passenger_count = excluded.passenger_count;

  update carpool_ride_requests
    set status = 'ACCEPTED', responded_at = now(), responded_by = p_actor_id, updated_at = now()
    where id = v_req.id;

  perform carpool_emit_event(
    v_req.organization_id, 'RideAccepted', v_offer.id, v_req.id, v_offer.trip_request_id, p_actor_id,
    jsonb_build_object('auto', p_auto, 'requested_seats', v_req.requested_seats,
                       'seats_available_after', v_available - v_req.requested_seats)
  );
  perform log_audit_event(
    v_req.organization_id, p_actor_id, 'carpool_ride_accepted', 'carpool_ride_request', v_req.id,
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', 'ACCEPTED', 'rider_id', v_req.rider_id,
                       'requested_seats', v_req.requested_seats,
                       'seats_available_after', v_available - v_req.requested_seats,
                       'policy_version', v_req.policy_version,
                       'match_additional_distance_km', v_req.match_additional_distance_km,
                       'match_additional_time_min', v_req.match_additional_time_min,
                       'auto', p_auto)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs — host side
-- ---------------------------------------------------------------------------

drop function if exists enable_carpool_offer(uuid, integer);
drop function if exists update_carpool_offer(uuid, integer);
drop function if exists disable_carpool_offer(uuid);

create function enable_carpool_offer(p_trip_request_id uuid, p_seats integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_trip trip_requests%rowtype;
  v_offer carpool_offers%rowtype;
  v_offer_id uuid;
  v_policy_version integer;
  v_policy_enabled boolean;
  v_free integer;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  select role into v_role from profiles where id = v_uid;

  -- Serializes concurrent enables for the same trip (no duplicate offer rows).
  select * into v_trip from trip_requests where id = p_trip_request_id and organization_id = v_org for update;
  if not found then
    raise exception 'CARPOOL_TRIP_NOT_FOUND';
  end if;
  if v_uid is distinct from v_trip.requester_id and v_role not in ('fleet_manager', 'administrator') then
    raise exception 'CARPOOL_NOT_AUTHORIZED';
  end if;
  if p_seats is null or p_seats < 1 then
    raise exception 'CARPOOL_INVALID_SEATS';
  end if;

  select p.policy_version, p.carpool_enabled into v_policy_version, v_policy_enabled
    from carpool_policy_for_org(v_org) p;
  if not v_policy_enabled then
    raise exception 'CARPOOL_DISABLED_BY_POLICY';
  end if;
  if not carpool_host_trip_is_active(p_trip_request_id) then
    raise exception 'CARPOOL_HOST_TRIP_INACTIVE';
  end if;
  if v_trip.departure_at <= now() then
    raise exception 'CARPOOL_HOST_TRIP_STARTED';
  end if;
  v_free := carpool_vehicle_free_seats(p_trip_request_id);
  if v_free is not null and p_seats > v_free then
    raise exception 'CARPOOL_SEATS_EXCEED_CAPACITY';
  end if;

  select * into v_offer from carpool_offers
    where trip_request_id = p_trip_request_id and organization_id = v_org
    order by created_at desc, id desc limit 1
    for update;

  if found then
    -- DOMAIN-MIRROR carpoolOffer.enableOffer: draft, disabled
    if v_offer.status = 'completed' then
      raise exception 'CARPOOL_OFFER_COMPLETED';
    end if;
    if v_offer.status = 'active' then
      raise exception 'CARPOOL_OFFER_ALREADY_ACTIVE';
    end if;
    update carpool_offers
      set status = 'active', seats_offered = p_seats, seats_available = p_seats,
          policy_version = v_policy_version, updated_at = now()
      where id = v_offer.id;
    v_offer_id := v_offer.id;
  else
    insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version)
    values (v_org, p_trip_request_id, v_trip.requester_id, 'active', p_seats, p_seats, v_policy_version)
    returning id into v_offer_id;
  end if;

  perform carpool_emit_event(v_org, 'CarpoolOfferEnabled', v_offer_id, null, p_trip_request_id, v_uid,
    jsonb_build_object('seats_offered', p_seats, 'policy_version', v_policy_version));
  perform log_audit_event(v_org, v_uid, 'carpool_offer_enabled', 'carpool_offer', v_offer_id,
    null, jsonb_build_object('status', 'active', 'seats_offered', p_seats, 'policy_version', v_policy_version,
                             'host_id', v_trip.requester_id));
  return v_offer_id;
end;
$$;

create function update_carpool_offer(p_offer_id uuid, p_seats integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer carpool_offers%rowtype;
  v_taken integer;
  v_next_available integer;
  v_free integer;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  select role into v_role from profiles where id = v_uid;

  select * into v_offer from carpool_offers where id = p_offer_id and organization_id = v_org for update;
  if not found then
    raise exception 'CARPOOL_OFFER_NOT_FOUND';
  end if;
  if v_uid is distinct from v_offer.host_id and v_role not in ('fleet_manager', 'administrator') then
    raise exception 'CARPOOL_NOT_AUTHORIZED';
  end if;
  if p_seats is null or p_seats < 1 then
    raise exception 'CARPOOL_INVALID_SEATS';
  end if;
  -- DOMAIN-MIRROR carpoolOffer.updateSeats: active
  if v_offer.status <> 'active' then
    raise exception 'CARPOOL_OFFER_NOT_ACTIVE';
  end if;

  v_taken := carpool_seats_taken(v_offer.id);
  v_next_available := p_seats - v_taken;
  if v_next_available < 0 then
    raise exception 'CARPOOL_CANNOT_REDUCE_BELOW_SEATS_TAKEN';
  end if;
  v_free := carpool_vehicle_free_seats(v_offer.trip_request_id);
  if v_free is not null and p_seats > v_free then
    raise exception 'CARPOOL_SEATS_EXCEED_CAPACITY';
  end if;

  update carpool_offers
    set seats_offered = p_seats, seats_available = v_next_available, updated_at = now()
    where id = v_offer.id;

  perform log_audit_event(v_org, v_uid, 'carpool_offer_updated', 'carpool_offer', v_offer.id,
    jsonb_build_object('seats_offered', v_offer.seats_offered, 'seats_available', v_offer.seats_available),
    jsonb_build_object('seats_offered', p_seats, 'seats_available', v_next_available,
                       'policy_version', v_offer.policy_version));
end;
$$;

create function disable_carpool_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer carpool_offers%rowtype;
  v_req record;
  v_invalidated integer := 0;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  select role into v_role from profiles where id = v_uid;

  select * into v_offer from carpool_offers where id = p_offer_id and organization_id = v_org for update;
  if not found then
    raise exception 'CARPOOL_OFFER_NOT_FOUND';
  end if;
  if v_uid is distinct from v_offer.host_id and v_role not in ('fleet_manager', 'administrator') then
    raise exception 'CARPOOL_NOT_AUTHORIZED';
  end if;
  -- DOMAIN-MIRROR carpoolOffer.disableOffer: draft, active
  if v_offer.status = 'completed' then
    raise exception 'CARPOOL_OFFER_COMPLETED';
  end if;
  if v_offer.status = 'disabled' then
    raise exception 'CARPOOL_OFFER_ALREADY_DISABLED';
  end if;

  update carpool_offers set status = 'disabled', updated_at = now() where id = v_offer.id;

  -- Riders must not stay "accepted" on an offer that no longer exists: every live request is
  -- invalidated (rider notified by the subscriber) and its seat released.
  for v_req in
    select id from carpool_ride_requests
      where carpool_offer_id = v_offer.id and status in ('PENDING', 'ACCEPTED')
      order by created_at, id
      for update
  loop
    if carpool_invalidate_request(v_req.id, 'OFFER_DISABLED', v_uid) then
      v_invalidated := v_invalidated + 1;
    end if;
  end loop;
  perform carpool_recompute_seats(v_offer.id);

  perform log_audit_event(v_org, v_uid, 'carpool_offer_disabled', 'carpool_offer', v_offer.id,
    jsonb_build_object('status', v_offer.status),
    jsonb_build_object('status', 'disabled', 'invalidated_requests', v_invalidated,
                       'policy_version', v_offer.policy_version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs — rider side
-- ---------------------------------------------------------------------------

drop function if exists create_carpool_ride_request(uuid, integer, jsonb, jsonb, timestamptz, uuid, numeric, numeric);
drop function if exists cancel_carpool_ride_request(uuid);

create function create_carpool_ride_request(
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
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_offer carpool_offers%rowtype;
  v_trip trip_requests%rowtype;
  v_existing carpool_ride_requests%rowtype;
  v_policy record;
  v_loc jsonb;
  v_request_id uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  if p_client_request_id is null then
    raise exception 'CARPOOL_CLIENT_REQUEST_ID_REQUIRED';
  end if;

  -- Offer lock FIRST: it serializes concurrent requests/accepts on the same offer, and it
  -- makes the idempotency check below race-free (a second call with the same key waits here
  -- and then sees the first call's committed row).
  select * into v_offer from carpool_offers where id = p_offer_id and organization_id = v_org for update;
  if not found then
    raise exception 'CARPOOL_OFFER_NOT_FOUND';
  end if;

  select * into v_existing from carpool_ride_requests where client_request_id = p_client_request_id;
  if found then
    if v_existing.rider_id = v_uid and v_existing.organization_id = v_org
       and v_existing.carpool_offer_id = p_offer_id then
      return v_existing.id; -- idempotent replay: same key, same caller, same offer
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
  if v_offer.seats_offered - carpool_seats_taken(v_offer.id) < p_seats then
    raise exception 'CARPOOL_NO_SEATS_AVAILABLE';
  end if;
  if abs(extract(epoch from (p_requested_departure_at - v_trip.departure_at))) / 60.0 > v_policy.departure_window_minutes then
    raise exception 'CARPOOL_OUTSIDE_DEPARTURE_WINDOW';
  end if;
  -- Mirrors evaluateRouteMatch (route predicates). The numbers themselves come from the
  -- server action's own provider call (never from client input); the DB re-applies the
  -- policy thresholds as defense in depth.
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
    -- Lost an insert race on the unique key (cannot normally happen under the offer lock).
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
                       'requested_departure_at', p_requested_departure_at));

  if not v_policy.host_approval_required then
    perform carpool_apply_accept(v_request_id, v_uid, true);
  end if;

  return v_request_id;
end;
$$;

create function cancel_carpool_ride_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer_id uuid;
  v_offer carpool_offers%rowtype;
  v_req carpool_ride_requests%rowtype;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  select role into v_role from profiles where id = v_uid;

  select carpool_offer_id into v_offer_id from carpool_ride_requests where id = p_request_id and organization_id = v_org;
  if v_offer_id is null then
    raise exception 'CARPOOL_REQUEST_NOT_FOUND';
  end if;
  select * into v_offer from carpool_offers where id = v_offer_id and organization_id = v_org for update;
  select * into v_req from carpool_ride_requests where id = p_request_id and organization_id = v_org for update;

  if v_uid is distinct from v_req.rider_id and v_role not in ('fleet_manager', 'administrator') then
    raise exception 'CARPOOL_NOT_AUTHORIZED';
  end if;
  -- DOMAIN-MIRROR rideRequest.cancel: PENDING, ACCEPTED
  if v_req.status not in ('PENDING', 'ACCEPTED') then
    raise exception 'CARPOOL_REQUEST_NOT_CANCELLABLE';
  end if;

  update carpool_ride_requests
    set status = 'CANCELLED', responded_at = now(), responded_by = v_uid, updated_at = now()
    where id = v_req.id;

  if v_req.status = 'ACCEPTED' then
    delete from trip_participants
      where trip_request_id = v_offer.trip_request_id and passenger_id = v_req.rider_id;
  end if;
  perform carpool_recompute_seats(v_offer.id);

  perform carpool_emit_event(v_org, 'RideCancelled', v_offer.id, v_req.id, v_offer.trip_request_id, v_uid,
    jsonb_build_object('previous_status', v_req.status,
                       'seats_released', case when v_req.status = 'ACCEPTED' then v_req.requested_seats else 0 end));
  perform log_audit_event(v_org, v_uid, 'carpool_ride_cancelled', 'carpool_ride_request', v_req.id,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', 'CANCELLED', 'rider_id', v_req.rider_id,
                       'seats_released', case when v_req.status = 'ACCEPTED' then v_req.requested_seats else 0 end,
                       'policy_version', v_req.policy_version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs — host decision
-- ---------------------------------------------------------------------------

drop function if exists accept_carpool_ride_request(uuid);
drop function if exists reject_carpool_ride_request(uuid, text);
drop function if exists revalidate_carpool_matches(uuid);
drop function if exists expire_stale_carpool_requests();

create function accept_carpool_ride_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer_id uuid;
  v_offer carpool_offers%rowtype;
  v_req carpool_ride_requests%rowtype;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  select role into v_role from profiles where id = v_uid;

  select carpool_offer_id into v_offer_id from carpool_ride_requests where id = p_request_id and organization_id = v_org;
  if v_offer_id is null then
    raise exception 'CARPOOL_REQUEST_NOT_FOUND';
  end if;
  -- offer lock, then request lock; status/seats re-derived below under both locks.
  select * into v_offer from carpool_offers where id = v_offer_id and organization_id = v_org for update;
  select * into v_req from carpool_ride_requests where id = p_request_id and organization_id = v_org for update;

  if v_req.rider_id = v_uid
     or (v_uid is distinct from v_offer.host_id and v_role not in ('fleet_manager', 'administrator')) then
    raise exception 'CARPOOL_NOT_AUTHORIZED';
  end if;

  perform carpool_apply_accept(v_req.id, v_uid, false);
end;
$$;

create function reject_carpool_ride_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer_id uuid;
  v_offer carpool_offers%rowtype;
  v_req carpool_ride_requests%rowtype;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  select role into v_role from profiles where id = v_uid;

  select carpool_offer_id into v_offer_id from carpool_ride_requests where id = p_request_id and organization_id = v_org;
  if v_offer_id is null then
    raise exception 'CARPOOL_REQUEST_NOT_FOUND';
  end if;
  select * into v_offer from carpool_offers where id = v_offer_id and organization_id = v_org for update;
  select * into v_req from carpool_ride_requests where id = p_request_id and organization_id = v_org for update;

  if v_req.rider_id = v_uid
     or (v_uid is distinct from v_offer.host_id and v_role not in ('fleet_manager', 'administrator')) then
    raise exception 'CARPOOL_NOT_AUTHORIZED';
  end if;
  -- DOMAIN-MIRROR rideRequest.reject: PENDING
  if v_req.status <> 'PENDING' then
    raise exception 'CARPOOL_REQUEST_NOT_PENDING';
  end if;

  -- Status change only: the row is NEVER deleted (audit requirement; the legacy
  -- respond_to_carpool_request hard-deleted).
  update carpool_ride_requests
    set status = 'REJECTED', responded_at = now(), responded_by = v_uid, updated_at = now()
    where id = v_req.id;

  perform carpool_emit_event(v_org, 'RideRejected', v_offer.id, v_req.id, v_offer.trip_request_id, v_uid,
    jsonb_build_object('reason', p_reason));
  perform log_audit_event(v_org, v_uid, 'carpool_ride_rejected', 'carpool_ride_request', v_req.id,
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', 'REJECTED', 'rider_id', v_req.rider_id, 'reason', p_reason,
                       'policy_version', v_req.policy_version,
                       'match_additional_distance_km', v_req.match_additional_distance_km,
                       'match_additional_time_min', v_req.match_additional_time_min));
end;
$$;

create function revalidate_carpool_matches(p_trip_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_trip trip_requests%rowtype;
begin
  if v_uid is null or v_org is null then
    raise exception 'CARPOOL_NOT_AUTHENTICATED';
  end if;
  select role into v_role from profiles where id = v_uid;

  select * into v_trip from trip_requests where id = p_trip_request_id and organization_id = v_org;
  if not found then
    raise exception 'CARPOOL_TRIP_NOT_FOUND';
  end if;
  if v_uid is distinct from v_trip.requester_id and v_role not in ('fleet_manager', 'administrator') then
    raise exception 'CARPOOL_NOT_AUTHORIZED';
  end if;

  return carpool_revalidate_trip(p_trip_request_id, v_uid, array[]::text[]);
end;
$$;

-- Cron/service-role only: expire stale PENDING requests (older than the org policy's
-- request_expiry_minutes, or whose host trip has already departed). Returns how many.
create function expire_stale_carpool_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_locked carpool_ride_requests%rowtype;
  v_count integer := 0;
begin
  for v_row in
    select r.id, r.organization_id, r.carpool_offer_id, o.trip_request_id, r.policy_version
      from carpool_ride_requests r
      join carpool_offers o on o.id = r.carpool_offer_id
      join trip_requests tr on tr.id = o.trip_request_id
      cross join lateral carpool_policy_for_org(r.organization_id) p
      where r.status = 'PENDING'
        and (r.created_at + make_interval(mins => p.request_expiry_minutes) < now()
             or tr.departure_at < now())
      order by r.created_at
      limit 500
  loop
    select * into v_locked from carpool_ride_requests where id = v_row.id and status = 'PENDING' for update skip locked;
    if found then
      -- DOMAIN-MIRROR rideRequest.expire: PENDING
      update carpool_ride_requests
        set status = 'EXPIRED', responded_at = now(), updated_at = now()
        where id = v_locked.id and status = 'PENDING';
      perform carpool_emit_event(v_row.organization_id, 'RideExpired', v_row.carpool_offer_id, v_row.id,
        v_row.trip_request_id, null, '{}'::jsonb);
      perform log_audit_event(v_row.organization_id, null, 'carpool_ride_expired', 'carpool_ride_request', v_row.id,
        jsonb_build_object('status', 'PENDING'),
        jsonb_build_object('status', 'EXPIRED', 'rider_id', v_locked.rider_id, 'policy_version', v_row.policy_version));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Host-trip triggers: "invoked when the host trip changes or is cancelled" cannot depend on
-- every UI/RPC path remembering to call revalidate_carpool_matches, so the DB does it.
-- ---------------------------------------------------------------------------

create function carpool_trip_requests_changed()
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
    perform carpool_revalidate_trip(new.id, auth.uid(), v_changed);
  end if;
  return new;
end;
$$;

create trigger carpool_trip_requests_changed_trg
  after update of departure_at, origin, destination on trip_requests
  for each row
  when (old.departure_at is distinct from new.departure_at
        or old.origin is distinct from new.origin
        or old.destination is distinct from new.destination)
  execute function carpool_trip_requests_changed();

create function carpool_reservation_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform carpool_revalidate_trip(new.trip_request_id, auth.uid(), array[]::text[]);
  return new;
end;
$$;

create trigger carpool_reservation_cancelled_trg
  after update of status on reservations
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function carpool_reservation_cancelled();

-- ---------------------------------------------------------------------------
-- Grants (explicit anon revoke on every function; internal ones also lose authenticated)
-- ---------------------------------------------------------------------------

revoke all on function enable_carpool_offer(uuid, integer) from public, anon;
revoke all on function update_carpool_offer(uuid, integer) from public, anon;
revoke all on function disable_carpool_offer(uuid) from public, anon;
revoke all on function create_carpool_ride_request(uuid, integer, jsonb, jsonb, timestamptz, uuid, numeric, numeric) from public, anon;
revoke all on function cancel_carpool_ride_request(uuid) from public, anon;
revoke all on function accept_carpool_ride_request(uuid) from public, anon;
revoke all on function reject_carpool_ride_request(uuid, text) from public, anon;
revoke all on function revalidate_carpool_matches(uuid) from public, anon;
grant execute on function enable_carpool_offer(uuid, integer) to authenticated;
grant execute on function update_carpool_offer(uuid, integer) to authenticated;
grant execute on function disable_carpool_offer(uuid) to authenticated;
grant execute on function create_carpool_ride_request(uuid, integer, jsonb, jsonb, timestamptz, uuid, numeric, numeric) to authenticated;
grant execute on function cancel_carpool_ride_request(uuid) to authenticated;
grant execute on function accept_carpool_ride_request(uuid) to authenticated;
grant execute on function reject_carpool_ride_request(uuid, text) to authenticated;
grant execute on function revalidate_carpool_matches(uuid) to authenticated;

revoke all on function expire_stale_carpool_requests() from public, anon, authenticated;
grant execute on function expire_stale_carpool_requests() to service_role;

revoke all on function carpool_recompute_seats(uuid) from public, anon, authenticated;
revoke all on function carpool_invalidate_request(uuid, text, uuid) from public, anon, authenticated;
revoke all on function carpool_apply_accept(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function carpool_revalidate_trip(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function carpool_trip_requests_changed() from public, anon, authenticated;
revoke all on function carpool_reservation_cancelled() from public, anon, authenticated;
grant execute on function carpool_recompute_seats(uuid) to service_role;
grant execute on function carpool_invalidate_request(uuid, text, uuid) to service_role;
grant execute on function carpool_apply_accept(uuid, uuid, boolean) to service_role;
grant execute on function carpool_revalidate_trip(uuid, uuid, text[]) to service_role;
