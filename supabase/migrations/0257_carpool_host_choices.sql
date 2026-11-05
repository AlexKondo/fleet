-- Two choices of the administrator in Configurações > Políticas > Política de carona, versioned with the rest of the policy.
-- 1) host_can_accept_over_detour: a ride whose detour passes the policy limits reaches the host, up to twice the limits, and it is always the host's
--    decision, even when requests are accepted automatically. Off by default: nothing changes until an administrator publishes it.
-- 2) host_sees_rider_before_accept: when off, the host answers without the rider's name; it appears once accepted. On by default, which is how it always worked.
-- Function bodies below are the ones running in production, plus these rules. Same signatures, so grants stay. Rollback: rollback/0257_rollback.sql.

alter table public.carpool_policy_settings
  add column if not exists host_can_accept_over_detour boolean not null default false,
  add column if not exists host_sees_rider_before_accept boolean not null default true;

-- carpool_policy_for_org is used by five functions with a fixed return shape, so these two come from their own helper.
create or replace function public.fm_carpool_host_rules(p_org uuid)
returns table(host_can_accept_over_detour boolean, host_sees_rider_before_accept boolean)
language sql stable security definer set search_path = public, pg_temp as $function$
  with p as (
    select s.host_can_accept_over_detour, s.host_sees_rider_before_accept
      from carpool_policy_settings s
      where s.organization_id = p_org
      order by s.policy_version desc
      limit 1
  )
  select * from p
  union all
  select false, true
  where not exists (select 1 from p);
$function$;
revoke all on function public.fm_carpool_host_rules(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_carpool_ride_request_as_rider(p_rider_id uuid, p_offer_id uuid, p_seats integer, p_pickup jsonb, p_dropoff jsonb, p_requested_departure_at timestamp with time zone, p_client_request_id uuid, p_match_additional_distance_km numeric, p_match_additional_time_min numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := p_rider_id;
  v_org uuid;
  v_offer carpool_offers%rowtype;
  v_trip trip_requests%rowtype;
  v_existing carpool_ride_requests%rowtype;
  v_stale record;
  v_policy record;
  v_over_detour boolean;
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
  -- 0257: above the limit only when the policy lets the host decide, and never past twice the limit (MAX_OVER_DETOUR_FACTOR in carpoolPolicy.ts)
  v_over_detour := coalesce(p_match_additional_distance_km > v_policy.max_additional_distance_km
     or p_match_additional_time_min > v_policy.max_additional_time_minutes, false);
  if v_over_detour and not (
       (select h.host_can_accept_over_detour from fm_carpool_host_rules(v_org) h)
       and p_match_additional_distance_km <= v_policy.max_additional_distance_km * 2
       and p_match_additional_time_min <= v_policy.max_additional_time_minutes * 2) then
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

  -- 0257: a detour above the limit is always the host's decision, never accepted automatically
  if not v_policy.host_approval_required and not v_over_detour then
    perform carpool_apply_accept(v_request_id, v_uid, true);
  end if;

  return v_request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fm_carpool_notice(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r record; v_token text; v_limit record;
begin
  select rr.status::text as status, rr.organization_id, rr.requested_seats, rr.pickup_location->>'label' as pickup_label, rider.full_name as rider_name,
         rr.match_additional_distance_km as detour_km, rr.match_additional_time_min as detour_min,
         o.host_id, c.phone_e164, t.destination, t.departure_at, v.plate, v.name as vehicle_name
    into r
    from carpool_ride_requests rr
    join carpool_offers o on o.id = rr.carpool_offer_id
    join trip_requests t on t.id = o.trip_request_id
    join profiles rider on rider.id = rr.rider_id
    left join reservations res on res.trip_request_id = t.id and res.status <> 'cancelled'
    left join vehicles v on v.id = res.vehicle_id
    left join fm_member_access a on a.user_id = o.host_id
    left join fm_whatsapp_contacts c on c.user_id = o.host_id and c.consent_confirmed
   where rr.id = p_request_id and coalesce(a.enabled, true)
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.phone_e164 is null then return jsonb_build_object('ok', false, 'reason', 'no_phone'); end if;
  select * into v_limit from carpool_policy_for_org(r.organization_id) p;
  if r.status = 'PENDING' then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into fm_carpool_response_tokens(request_id, host_id, token_hash, phone_e164, expires_at)
      values (p_request_id, r.host_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), r.phone_e164, now() + interval '24 hours')
      on conflict (request_id) do update set token_hash = excluded.token_hash, phone_e164 = excluded.phone_e164, status = 'pending', reason = null,
        awaiting_since = null, expires_at = excluded.expires_at, created_at = now();
  end if;
  return jsonb_build_object('ok', true, 'phone_e164', r.phone_e164, 'status', r.status,
    'rider_name', case when r.status = 'PENDING' and not (select h.host_sees_rider_before_accept from fm_carpool_host_rules(r.organization_id) h) then null else r.rider_name end,
    'detour_km', r.detour_km, 'detour_min', r.detour_min, 'limit_km', v_limit.max_additional_distance_km, 'limit_min', v_limit.max_additional_time_minutes,
    'seats', r.requested_seats,
    'pickup_label', r.pickup_label, 'destination', r.destination, 'departure_at', r.departure_at, 'plate', r.plate, 'vehicle_name', r.vehicle_name,
    'token', v_token);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fm_carpool_token_resolve(p_token text, p_from_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q record; v_email text; v_rider text; v_status text; v_org uuid;
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into q from fm_carpool_response_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if fm_phone_digits_norm(p_from_phone) is distinct from fm_phone_digits_norm(q.phone_e164) or coalesce(fm_phone_digits_norm(p_from_phone), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'phone_mismatch');
  end if;
  if q.status = 'done' then return jsonb_build_object('ok', false, 'reason', 'already_done'); end if;
  if q.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select rr.status, p.full_name, rr.organization_id into v_status, v_rider, v_org from carpool_ride_requests rr join profiles p on p.id = rr.rider_id where rr.id = q.request_id;
  if v_status is distinct from 'PENDING' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  select u.email into v_email from auth.users u left join fm_member_access a on a.user_id = u.id where u.id = q.host_id and coalesce(a.enabled, true);
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  return jsonb_build_object('ok', true, 'request_id', q.request_id, 'host_id', q.host_id, 'host_email', v_email,
    'rider_name', case when (select h.host_sees_rider_before_accept from fm_carpool_host_rules(v_org) h) then v_rider end, 'rider_name_accepted', v_rider, 'token_status', q.status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fm_carpool_pending_reason(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q record; v_norm text := fm_phone_digits_norm(case when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) in (10, 11) then '55' || regexp_replace(p_phone, '[^0-9]', '', 'g') else p_phone end);
begin
  if v_norm is null or length(v_norm) < 10 then return jsonb_build_object('ok', false); end if;
  select t.request_id, t.host_id, u.email, p.full_name as rider_name, rr.organization_id into q
    from fm_carpool_response_tokens t
    join carpool_ride_requests rr on rr.id = t.request_id and rr.status = 'PENDING'
    join profiles p on p.id = rr.rider_id
    join auth.users u on u.id = t.host_id
   where t.status = 'awaiting_reason' and t.awaiting_since > now() - interval '15 minutes' and t.expires_at > now()
     and fm_phone_digits_norm(t.phone_e164) = v_norm
   order by t.awaiting_since desc limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'request_id', q.request_id, 'host_id', q.host_id, 'host_email', q.email,
    'rider_name', case when (select h.host_sees_rider_before_accept from fm_carpool_host_rules(q.organization_id) h) then q.rider_name end);
end;
$function$;
