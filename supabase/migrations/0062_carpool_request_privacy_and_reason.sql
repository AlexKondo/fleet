-- FleetMind Smart Carpool — Phase C5 (UI) data-layer prerequisites.
--
-- 1. PRIVACY: 0052 let every member of the organization SELECT every carpool_ride_requests row
--    ("members read own organization carpool ride requests"). A ride request carries the rider's
--    pickup/drop-off coordinates and requested departure, so any employee could read every
--    coworker's journey over PostgREST - exactly the "browseable directory of coworkers'
--    journeys" the pack forbids (06 privacy). SELECT is narrowed to: the rider, the host of the
--    offer, and fleet_manager/administrator of the organization. (carpool_offers stays
--    org-readable: the matching search needs it and an offer exposes no rider data.)
--
-- 2. status_reason. The rider / host UI must show WHY a request ended (REJECTED with the host's
--    optional reason, INVALIDATED with HOST_TRIP_CANCELLED / HOST_SCHEDULE_CHANGED /
--    HOST_ROUTE_CHANGED / OFFER_DISABLED). The reason only lived in carpool_events (readable by
--    managers only) and the audit log. It is now also a column on the request row, written by
--    carpool_invalidate_request and reject_carpool_ride_request (same signatures, create or
--    replace - NO new overloads; bodies are identical to 0059 apart from the status_reason write).

alter table carpool_ride_requests add column if not exists status_reason text;

drop policy if exists "members read own organization carpool ride requests" on carpool_ride_requests;
drop policy if exists "riders hosts and managers read carpool ride requests" on carpool_ride_requests;
create policy "riders hosts and managers read carpool ride requests" on carpool_ride_requests
  for select using (
    organization_id = (select current_organization_id())
    and (
      rider_id = (select auth.uid())
      or exists (
        select 1 from carpool_offers o
          where o.id = carpool_offer_id and o.host_id = (select auth.uid())
      )
      or exists (
        select 1 from profiles p
          where p.id = (select auth.uid()) and p.role in ('fleet_manager', 'administrator')
      )
    )
  );

create or replace function carpool_invalidate_request(p_request_id uuid, p_reason text, p_actor_id uuid)
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
    set status = 'INVALIDATED', status_reason = left(p_reason, 200), responded_at = now(), responded_by = p_actor_id, updated_at = now()
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

create or replace function reject_carpool_ride_request(p_request_id uuid, p_reason text)
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
    set status = 'REJECTED', status_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), ''), responded_at = now(), responded_by = v_uid, updated_at = now()
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

revoke all on function carpool_invalidate_request(uuid, text, uuid) from public, anon, authenticated;
grant execute on function carpool_invalidate_request(uuid, text, uuid) to service_role;
revoke all on function reject_carpool_ride_request(uuid, text) from public, anon;
grant execute on function reject_carpool_ride_request(uuid, text) to authenticated;
