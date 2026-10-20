-- Explicit function definitions, reconciled against the actual 0079 chain.
-- No dynamic SQL rewriting at deployment. Personal-purpose authorization is
-- preserved; staff overrides additionally require the configured vehicle scope.

CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_locked_vehicle_id uuid;
  v_requester_id uuid;
  v_reservation_status reservation_status;
  v_vehicle_status vehicle_status;
  v_caller_role user_role;
  v_other_confirmed_count integer;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
  select vehicle_id into v_locked_vehicle_id from reservations where id=p_reservation_id and organization_id=v_org_id;
  perform 1 from vehicles where id=v_locked_vehicle_id and organization_id=v_org_id for update;
  select r.vehicle_id, r.status, tr.requester_id
    into v_vehicle_id, v_reservation_status, v_requester_id
    from reservations r
    join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id
    for update of r;
  if v_vehicle_id is distinct from v_locked_vehicle_id then raise exception 'CONCURRENT_UPDATE';end if;
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

  if v_reservation_status = 'confirmed' and v_vehicle_status = 'reserved' then
    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_vehicle_id and id <> p_reservation_id and status = 'confirmed';
    if v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now() where id = v_vehicle_id;
    end if;
  end if;

  if auth.uid() is distinct from v_requester_id then
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (
      v_org_id, v_requester_id, 'Reserva cancelada',
      case when p_reason is not null and length(trim(p_reason)) > 0
        then 'Sua reserva foi cancelada: ' || p_reason
        else 'Sua reserva foi cancelada.'
      end,
      'reservation', p_reservation_id
    );
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_cancelled', 'reservation', p_reservation_id,
    jsonb_build_object('status', v_reservation_status),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_reservation_message(p_reservation_id uuid, p_message_type message_type, p_body text, p_new_expected_return_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
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
  v_body_preview text;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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

  v_body_preview := left(trim(p_body), 140);

  if auth.uid() = v_requester_id then
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    select v_org_id, profiles.id, 'Nova mensagem na reserva', v_body_preview, 'reservation', p_reservation_id
    from profiles
    where profiles.organization_id = v_org_id
      and profiles.role in ('fleet_manager', 'administrator');
  else
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (v_org_id, v_requester_id, 'Nova mensagem na reserva', v_body_preview, 'reservation', p_reservation_id);
  end if;

  select
    exists (select 1 from inspections where reservation_id = p_reservation_id and type = 'pickup')
    and not exists (select 1 from inspections where reservation_id = p_reservation_id and type = 'return')
    into v_source_trip_in_progress;

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
$function$
;

CREATE OR REPLACE FUNCTION public.fm_checklist_state(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare v_state jsonb;v_vehicle uuid;v_status vehicle_status;v_res_status reservation_status;v_office boolean;v_delivered boolean;v_received boolean;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 v_state:=fm_gate_checklist_state(p_reservation_id);
 select r.vehicle_id,v.status,r.status into v_vehicle,v_status,v_res_status from reservations r join vehicles v on v.id=r.vehicle_id and v.organization_id=r.organization_id where r.id=p_reservation_id and r.organization_id=current_organization_id();
 v_office:=fm_reservation_workflow(p_reservation_id)='key_custody';
 if not v_office then return v_state||jsonb_build_object('workflow','gate_visual','keys_delivered',false,'keys_received',false);end if;
 select exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered'),exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='received') into v_delivered,v_received;
 return v_state||jsonb_build_object('workflow','key_custody','keys_delivered',v_delivered,'keys_received',v_received,
  'inspection_role',case when v_state->>'inspection_role'='traveler' then 'traveler' else null end,
  'can_pickup',coalesce(v_state->>'inspection_role'='traveler',false) and v_res_status='confirmed' and v_delivered and not v_received and not (v_state->>'own_pickup')::boolean and v_status in ('available','reserved','awaiting_pickup'),
  'can_return',coalesce(v_state->>'inspection_role'='traveler',false) and v_res_status='confirmed' and v_delivered and (v_state->>'pickup_traveler')::boolean and not (v_state->>'own_return')::boolean and v_status in ('in_use','returning','blocked'));
end;$function$
;

CREATE OR REPLACE FUNCTION public.enable_carpool_offer(p_trip_request_id uuid, p_seats integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
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
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_trip(p_trip_request_id) or exists(select 1 from public.trip_requests t where t.id=p_trip_request_id and t.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.revalidate_carpool_matches(p_trip_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_trip trip_requests%rowtype;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_trip(p_trip_request_id) or exists(select 1 from public.trip_requests t where t.id=p_trip_request_id and t.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.disable_carpool_offer(p_offer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer carpool_offers%rowtype;
  v_req record;
  v_invalidated integer := 0;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (exists(select 1 from public.carpool_offers o where o.id=p_offer_id and o.organization_id=public.current_organization_id() and (o.host_id=auth.uid() or public.fm_can_manage_trip(o.trip_request_id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_carpool_offer(p_offer_id uuid, p_seats integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer carpool_offers%rowtype;
  v_taken integer;
  v_next_available integer;
  v_free integer;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (exists(select 1 from public.carpool_offers o where o.id=p_offer_id and o.organization_id=public.current_organization_id() and (o.host_id=auth.uid() or public.fm_can_manage_trip(o.trip_request_id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.accept_carpool_ride_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer_id uuid;
  v_offer carpool_offers%rowtype;
  v_req carpool_ride_requests%rowtype;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (exists(select 1 from public.carpool_ride_requests q join public.carpool_offers o on o.id=q.carpool_offer_id where q.id=p_request_id and q.organization_id=public.current_organization_id() and (o.host_id=auth.uid() or public.fm_can_manage_trip(o.trip_request_id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.reject_carpool_ride_request(p_request_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := current_organization_id();
  v_role user_role;
  v_offer_id uuid;
  v_offer carpool_offers%rowtype;
  v_req carpool_ride_requests%rowtype;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (exists(select 1 from public.carpool_ride_requests q join public.carpool_offers o on o.id=q.carpool_offer_id where q.id=p_request_id and q.organization_id=public.current_organization_id() and (o.host_id=auth.uid() or public.fm_can_manage_trip(o.trip_request_id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_carpool_request(p_participant_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
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
 if coalesce(public.fm_is_limited_manager(),false) and not (exists(select 1 from public.trip_participants p join public.trip_requests t on t.id=p.trip_request_id where p.id=p_participant_id and p.organization_id=public.current_organization_id() and (t.requester_id=auth.uid() or public.fm_can_manage_trip(t.id)))) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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

    perform log_audit_event(
      v_org_id, auth.uid(), 'carpool_request_accepted', 'trip_participant', p_participant_id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'accepted', 'passenger_id', v_passenger_id)
    );
  else
    delete from trip_participants where id = p_participant_id;

    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_passenger_id, 'Carona recusada',
      'Sua solicitação de carona para ' || v_destination || ' foi recusada pelo motorista.'
    );

    -- entity_id still points at the now-deleted participant row — audit_log.entity_id has
    -- no FK constraint (0015_audit_trail.sql, by design: audit history must survive the
    -- entity it describes being deleted), so this remains a valid, permanent record of
    -- who was rejected even though the trip_participants row itself no longer exists.
    perform log_audit_event(
      v_org_id, auth.uid(), 'carpool_request_rejected', 'trip_participant', p_participant_id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'rejected', 'passenger_id', v_passenger_id)
    );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fm_v3_command(p_command text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare
 v_org uuid:=public.current_organization_id();v_actor uuid:=auth.uid();v_role public.user_role;
 v_id uuid;v_vehicle public.vehicles%rowtype;v_order public.fm_work_orders%rowtype;v_res public.reservations%rowtype;
 v_receipt public.fm_command_receipts%rowtype;v_target text;v_start timestamptz;v_end timestamptz;v_task uuid;v_result jsonb;v_before jsonb;
 v_energy public.energy_type;v_kind text;v_changed uuid;v_line public.fm_work_order_lines%rowtype;v_cost numeric;
begin
 perform public.fm_scope_command_guard(p_command,p_payload);
 select role into v_role from public.profiles where id=v_actor and organization_id=v_org;
 if v_actor is null or v_role is null then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
 if p_command like 'work_order.%' and v_role not in ('fleet_manager','administrator','maintenance_operator') then raise exception 'NOT_AUTHORIZED';end if;
 if p_command like 'energy.%' or p_command='vehicle.identity' then
  if v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 end if;
 if p_command in ('gate.record','incident.ack') and v_role not in ('fleet_manager','administrator','security') then raise exception 'NOT_AUTHORIZED';end if;
 insert into public.fm_command_receipts(organization_id,request_id,actor_id,command,payload)
 values(v_org,p_request_id,v_actor,p_command,p_payload) on conflict do nothing returning request_id into v_changed;
 if v_changed is null then
  select * into v_receipt from public.fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>p_command or v_receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return v_receipt.result;
 end if;

 if p_command='work_order.create' then
  select * into v_vehicle from public.vehicles where id=(p_payload->>'vehicle_id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_FOUND';end if;
  insert into public.fm_work_orders(organization_id,vehicle_id,kind,description,supplier,quote_total,created_by)
  values(v_org,v_vehicle.id,p_payload->>'kind',trim(p_payload->>'description'),left(coalesce(p_payload->>'supplier',''),200),coalesce((p_payload->>'quote_total')::numeric,0),v_actor) returning id into v_id;

 elsif p_command in ('work_order.transition','work_order.line','work_order.void_line','work_order.budget') then
  -- Lock vehicle first everywhere; avoid reversed order with reservation triggers.
  select vehicle_id into v_id from public.fm_work_orders where id=(p_payload->>'id')::uuid and organization_id=v_org;
  if v_id is null then raise exception 'NOT_FOUND';end if;
  select * into v_vehicle from public.vehicles where id=v_id and organization_id=v_org for update;
  select * into v_order from public.fm_work_orders where id=(p_payload->>'id')::uuid and organization_id=v_org for update;
  if v_order.version is distinct from (p_payload->>'version')::integer then raise exception 'CONCURRENT_UPDATE';end if;
  v_id:=v_order.id;v_before:=jsonb_build_object('status',v_order.status,'version',v_order.version);
  if p_command='work_order.line' then
   if v_order.status in ('completed','cancelled') then raise exception 'INVALID_STATE_TRANSITION';end if;
   if p_payload->>'stage'='actual' and v_order.status not in ('in_progress','partial') then raise exception 'INVALID_STATE_TRANSITION';end if;
   insert into public.fm_work_order_lines(organization_id,work_order_id,description,stage,category,quantity,unit_price,warranty,created_by)
   values(v_org,v_id,trim(p_payload->>'description'),coalesce(p_payload->>'stage','planned'),p_payload->>'category',(p_payload->>'quantity')::numeric,(p_payload->>'unit_price')::numeric,coalesce((p_payload->>'warranty')::boolean,false),v_actor);
  elsif p_command='work_order.budget' then
   if v_order.status in ('completed','cancelled') or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';end if;
   if v_order.status not in ('draft','budgeted') and v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
   update public.fm_work_orders set quote_total=(p_payload->>'quote_total')::numeric,
    approved_total=case when status not in ('draft','budgeted') then (p_payload->>'quote_total')::numeric else approved_total end,
    approved_by=case when status not in ('draft','budgeted') then v_actor else approved_by end where id=v_id;
   v_before:=v_before||jsonb_build_object('previous_quote',v_order.quote_total,'previous_approved',v_order.approved_total,'reason',left(p_payload->>'reason',500));
  elsif p_command='work_order.void_line' then
   if v_order.status in ('completed','cancelled') or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';end if;
   update public.fm_work_order_lines set voided_at=now(),void_reason=left(p_payload->>'reason',500)
   where id=(p_payload->>'line_id')::uuid and work_order_id=v_id and organization_id=v_org and voided_at is null returning id into v_changed;
   if v_changed is null then raise exception 'NOT_FOUND';end if;
  else
   v_target:=p_payload->>'status';
   if not ((v_order.status='draft' and v_target in ('budgeted','cancelled'))
    or (v_order.status='budgeted' and v_target in ('approved','cancelled'))
    or (v_order.status='approved' and v_target in ('scheduled','cancelled'))
    or (v_order.status='scheduled' and v_target in ('scheduled','in_progress','cancelled'))
    or (v_order.status='in_progress' and v_target in ('partial','completed'))
    or (v_order.status='partial' and v_target in ('in_progress','completed'))) then raise exception 'INVALID_STATE_TRANSITION';end if;
   if v_target in ('approved','scheduled','cancelled') and v_role not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
   if v_target='approved' then
    update public.fm_work_orders set approved_by=v_actor,approved_total=quote_total where id=v_id;
   end if;
   if v_target='scheduled' then
    v_start:=(p_payload->>'scheduled_start')::timestamptz;v_end:=(p_payload->>'scheduled_end')::timestamptz;
    if v_start is null or v_end is null or v_end<=v_start then raise exception 'INVALID_INPUT';end if;
    if exists(select 1 from public.reservations where vehicle_id=v_vehicle.id and organization_id=v_org and status in ('confirmed','pending_approval') and tstzrange(start_at,end_at,'[)')&&tstzrange(v_start,v_end,'[)')) then raise exception 'RESERVATION_CONFLICT';end if;
    if exists(select 1 from public.fm_work_orders where vehicle_id=v_vehicle.id and organization_id=v_org and id<>v_id and status in ('scheduled','in_progress','partial') and tstzrange(scheduled_start,scheduled_end,'[)')&&tstzrange(v_start,v_end,'[)')) then raise exception 'MAINTENANCE_CONFLICT';end if;
    update public.fm_work_orders set scheduled_start=v_start,scheduled_end=v_end where id=v_id;
   end if;
   if v_target='in_progress' and v_order.status='partial' then
    if v_vehicle.status<>'maintenance' or not exists(select 1 from public.workflow_tasks where id=v_order.workflow_task_id and organization_id=v_org and status in ('open','in_progress')) then raise exception 'INVALID_STATE_TRANSITION';end if;
   end if;
   if v_target='in_progress' and v_order.status='scheduled' then
    if now()<v_order.scheduled_start or now()>=v_order.scheduled_end then raise exception 'OUTSIDE_MAINTENANCE_WINDOW';end if;
    if v_vehicle.status in ('in_use','returning','blocked') then raise exception 'VEHICLE_NOT_READY';end if;
    insert into public.workflow_tasks(organization_id,vehicle_id,type,notes,status,assigned_to)
    values(v_org,v_vehicle.id,case when v_order.kind='corrective' then 'repair'::public.workflow_task_type else 'preventive_maintenance'::public.workflow_task_type end,'OS '||v_order.number,'in_progress',v_actor) returning id into v_task;
    update public.fm_work_orders set workflow_task_id=v_task where id=v_id;
    update public.vehicles set status='maintenance',updated_at=now() where id=v_vehicle.id;
   end if;
   if v_target='completed' then
    select coalesce(sum(round(quantity*unit_price,2)) filter(where not warranty),0) into v_cost from public.fm_work_order_lines where work_order_id=v_id and voided_at is null and stage='actual';
    if v_order.approved_total is null or v_cost>v_order.approved_total then raise exception 'APPROVED_BUDGET_EXCEEDED';end if;
    if v_order.workflow_task_id is not null then
     if exists(select 1 from public.workflow_tasks where id=v_order.workflow_task_id and status in ('open','in_progress')) then perform public.complete_workflow_task(v_order.workflow_task_id);
     elsif not exists(select 1 from public.workflow_tasks where id=v_order.workflow_task_id and status='done') then raise exception 'INVALID_STATE_TRANSITION';end if;
    end if;
    update public.fm_work_orders set completed_at=now() where id=v_id;
   end if;
   update public.fm_work_orders set status=v_target where id=v_id;
  end if;
  update public.fm_work_orders set version=version+1 where id=v_id;

 elsif p_command='energy.record' then
  select * into v_vehicle from public.vehicles where id=(p_payload->>'vehicle_id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_FOUND';end if;
  select energy_type into v_energy from public.vehicle_categories where id=v_vehicle.category_id;
  v_kind:=p_payload->>'kind';
  if (v_kind='fuel' and v_energy='BEV') or (v_kind='charge' and v_energy in ('ICE','HEV')) then raise exception 'POWERTRAIN_MISMATCH';end if;
  if (p_payload->>'event_at')::timestamptz>now() then raise exception 'INVALID_INPUT';end if;
  insert into public.fm_energy_events(organization_id,vehicle_id,kind,quantity,fuel_type,total_cost,odometer_km,event_at,supplier,created_by)
  values(v_org,v_vehicle.id,v_kind,(p_payload->>'quantity')::numeric,case when v_kind='fuel' then p_payload->>'fuel_type' else null end,(p_payload->>'total_cost')::numeric,(p_payload->>'odometer_km')::integer,(p_payload->>'event_at')::timestamptz,left(coalesce(p_payload->>'supplier',''),200),v_actor) returning id into v_id;
 elsif p_command='energy.void' then
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';end if;
  update public.fm_energy_events set voided_at=now(),void_reason=left(p_payload->>'reason',500) where id=(p_payload->>'id')::uuid and organization_id=v_org and voided_at is null returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND';end if;

 elsif p_command='gate.record' then
  select * into v_res from public.reservations where id=(p_payload->>'reservation_id')::uuid and organization_id=v_org;
  if not found then raise exception 'NOT_FOUND';end if;
  select * into v_vehicle from public.vehicles where id=v_res.vehicle_id and organization_id=v_org for update;
  select * into v_res from public.reservations where id=v_res.id and organization_id=v_org for update;
  v_kind:=p_payload->>'kind';
  if v_kind='departure' then
   if v_res.status<>'confirmed' or v_vehicle.status not in ('awaiting_pickup','in_use') or v_vehicle.has_blocking_damage or not v_vehicle.documentation_valid or cardinality(v_vehicle.missing_safety_equipment)>0 then raise exception 'DEPARTURE_BLOCKED';end if;
   if not exists(select 1 from public.inspections where reservation_id=v_res.id and organization_id=v_org and type='pickup' and performed_by_role='traveler')
    or not exists(select 1 from public.inspections where reservation_id=v_res.id and organization_id=v_org and type='pickup' and performed_by_role='security') then raise exception 'CHECKLIST_REQUIRED';end if;
   if now()<v_res.start_at or now()>v_res.end_at then raise exception 'OUTSIDE_RESERVATION_WINDOW';end if;
  elsif v_kind='denied' and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'INVALID_INPUT';
  elsif v_kind='arrival' and not exists(select 1 from public.fm_gate_events where reservation_id=v_res.id and kind='departure') and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'LEGACY_ARRIVAL_REASON_REQUIRED';end if;
  insert into public.fm_gate_events(organization_id,reservation_id,vehicle_id,kind,reason,legacy_arrival,created_by)
  values(v_org,v_res.id,v_vehicle.id,v_kind,left(coalesce(p_payload->>'reason',''),1000),v_kind='arrival' and not exists(select 1 from public.fm_gate_events where reservation_id=v_res.id and kind='departure'),v_actor) returning id into v_id;
  if v_kind='departure' then update public.vehicles set status='in_use',updated_at=now() where id=v_vehicle.id;
  elsif v_kind='arrival' and v_res.status='confirmed' and v_vehicle.status in ('in_use','returning','blocked') then update public.vehicles set status=case when status='blocked' then 'blocked'::public.vehicle_status else 'returning'::public.vehicle_status end,updated_at=now() where id=v_vehicle.id;end if;

 elsif p_command='incident.ack' then
  if not exists(select 1 from public.inspections where id=(p_payload->>'inspection_id')::uuid and organization_id=v_org) then raise exception 'NOT_FOUND';end if;
  insert into public.fm_incident_acknowledgements(organization_id,inspection_id,actor_id,notes)
  values(v_org,(p_payload->>'inspection_id')::uuid,v_actor,left(coalesce(p_payload->>'notes',''),1000))
  on conflict(inspection_id,actor_id) do update set notes=public.fm_incident_acknowledgements.notes returning id into v_id;
 elsif p_command='vehicle.identity' then
  select * into v_vehicle from public.vehicles where id=(p_payload->>'vehicle_id')::uuid and organization_id=v_org for update;
  if not found then raise exception 'NOT_FOUND';end if;
  update public.vehicles set vin=nullif(upper(trim(p_payload->>'vin')),''),next_service_date=nullif(p_payload->>'next_service_date','')::date where id=v_vehicle.id;
  v_id:=v_vehicle.id;
 else raise exception 'UNKNOWN_COMMAND';end if;
 v_result:=jsonb_build_object('id',v_id,'ok',true);
 if p_command like 'work_order.%' then select v_result||jsonb_build_object('status',status,'version',version,'quote_total',quote_total,'approved_total',approved_total,'line_id',p_payload->>'line_id') into v_result from public.fm_work_orders where id=v_id and organization_id=v_org;end if;
 perform public.log_audit_event(v_org,v_actor,p_command,case when p_command like 'work_order.%' then 'work_order' when p_command like 'energy.%' then 'energy_event' when p_command='gate.record' then 'gate_event' when p_command='incident.ack' then 'inspection_acknowledgement' else 'vehicle' end,v_id,v_before,v_result);
 update public.fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;
 return v_result;
end;$function$
;

CREATE OR REPLACE FUNCTION public.fm_v3_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare v_org uuid:=public.current_organization_id();v_role public.user_role;v_result jsonb:='{}';
begin
 select role into v_role from public.profiles where id=auth.uid() and organization_id=v_org;
 if v_role is null or v_role='employee' then raise exception 'NOT_AUTHORIZED';end if;
 if v_role in ('fleet_manager','administrator','maintenance_operator') then
  v_result:=v_result||jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.fm_work_orders o where organization_id=v_org and (v_role<>'fleet_manager' or public.fm_can_manage_vehicle(o.vehicle_id))),'[]'::jsonb),
  'lines',coalesce((select jsonb_agg(to_jsonb(l)) from public.fm_work_order_lines l where organization_id=v_org and (v_role<>'fleet_manager' or exists(select 1 from public.fm_work_orders w where w.id=l.work_order_id and public.fm_can_manage_vehicle(w.vehicle_id)))),'[]'::jsonb));
 end if;
 if v_role in ('fleet_manager','administrator') then v_result:=v_result||jsonb_build_object('energy',coalesce((select jsonb_agg(to_jsonb(e) order by event_at desc) from public.fm_energy_events e where organization_id=v_org and (v_role<>'fleet_manager' or public.fm_can_manage_vehicle(e.vehicle_id))),'[]'::jsonb));end if;
 if v_role in ('fleet_manager','administrator','security') then v_result:=v_result||jsonb_build_object('gate',coalesce((select jsonb_agg(to_jsonb(g) order by created_at desc) from public.fm_gate_events g where organization_id=v_org and (v_role<>'fleet_manager' or public.fm_can_manage_vehicle(g.vehicle_id))),'[]'::jsonb));end if;
 if v_role in ('fleet_manager','administrator','security') then v_result:=v_result||jsonb_build_object('acknowledgements',coalesce((select jsonb_agg(to_jsonb(a)) from public.fm_incident_acknowledgements a where organization_id=v_org and (v_role<>'fleet_manager' or exists(select 1 from public.inspections i where i.id=a.inspection_id and public.fm_can_manage_vehicle(i.vehicle_id)))),'[]'::jsonb));end if;
 return v_result;
end;$function$
;

CREATE OR REPLACE FUNCTION public.list_member_licenses()
 RETURNS TABLE(id uuid, drivers_license_number text, drivers_license_category text, drivers_license_expiration date, driver_authorized boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
begin
  if auth.uid() is null or public.current_user_role() not in ('fleet_manager', 'administrator') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select p.id, p.drivers_license_number, p.drivers_license_category, p.drivers_license_expiration, p.driver_authorized
      from public.profiles p
      where p.organization_id = public.current_organization_id() and (not coalesce(public.fm_is_limited_manager(),false) or p.id=auth.uid() or exists(select 1 from public.trip_requests t join public.reservations r on r.trip_request_id=t.id where t.requester_id=p.id and public.fm_can_manage_vehicle(r.vehicle_id)));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fm_key_management_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();
begin
 if v_org is null or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object(
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name)) from fm_units u where u.organization_id=v_org and u.workflow='key_custody' and fm_can_manage_unit(u.id)),'[]'::jsonb),
 'reservations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'unit_id',u.id,'unit',u.name,'plate',v.plate,'requester',p.full_name,'self',p.id=v_actor,'start_at',r.start_at,'end_at',r.end_at,'status',r.status,
 'delivered',exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='delivered'),
 'received',exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='received')) order by r.start_at,r.id)
 from reservations r join vehicles v on v.id=r.vehicle_id and v.organization_id=r.organization_id
 join fm_vehicle_units m on m.vehicle_id=v.id and m.organization_id=r.organization_id join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id

 join trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id join profiles p on p.id=t.requester_id and p.organization_id=r.organization_id
 where r.organization_id=v_org and fm_can_manage_vehicle(r.vehicle_id) and u.enabled and u.workflow='key_custody' and exists(select 1 from fm_reservation_operations o where o.reservation_id=r.id and o.organization_id=r.organization_id and o.unit_id=u.id and o.workflow='key_custody') and ((r.status='confirmed' and r.end_at>=now()-interval '1 day' and r.start_at<now()+interval '7 days')
 or exists(select 1 from fm_key_events e where e.reservation_id=r.id and e.kind='delivered' and not exists(select 1 from fm_key_events x where x.reservation_id=r.id and x.kind='received')))),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
 select e.id,e.unit_id,u.name as unit,v.plate,e.reservation_id,e.kind,e.reason,e.created_at,p.full_name as actor
 from fm_key_events e join fm_units u on u.id=e.unit_id and u.organization_id=e.organization_id
 join vehicles v on v.id=e.vehicle_id and v.organization_id=e.organization_id
 join profiles p on p.id=e.actor_id and p.organization_id=e.organization_id
 where e.organization_id=v_org and fm_can_manage_vehicle(e.vehicle_id)
 order by e.created_at desc,e.id desc limit 100) h),'[]'::jsonb));
end;$function$
;

-- Qualified storage path references fix the legacy vehicle-name/path ambiguity.
-- Reference images are versioned objects; no overwrite/delete of evidence.
create function public.fm_storage_vehicle_id(p_name text) returns uuid language sql immutable set search_path=public as $$
 select case when split_part(split_part(split_part(p_name,'/',3),'_',1),'.',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then split_part(split_part(split_part(p_name,'/',3),'_',1),'.',1)::uuid else null end
$$;
revoke all on function public.fm_storage_vehicle_id(text) from public,anon;
grant execute on function public.fm_storage_vehicle_id(text) to authenticated;
drop policy fm_vehicle_evidence_read on storage.objects;
drop policy fm_vehicle_evidence_insert on storage.objects;
create policy fm_vehicle_evidence_read on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'vehicle-photos' or ((storage.foldername(storage.objects.name))[1]=current_organization_id()::text and (
 exists(select 1 from inspections i where i.id::text=(storage.foldername(storage.objects.name))[2] and i.organization_id=current_organization_id())
 or ((storage.foldername(storage.objects.name))[2]='vehicles' and exists(select 1 from vehicles v where v.id=fm_storage_vehicle_id(storage.objects.name) and v.organization_id=current_organization_id()))))
);
create policy fm_vehicle_evidence_insert on storage.objects as restrictive for insert to authenticated with check(
 bucket_id<>'vehicle-photos' or ((storage.foldername(storage.objects.name))[1]=current_organization_id()::text and (
 exists(select 1 from inspections i where i.id::text=(storage.foldername(storage.objects.name))[2] and i.organization_id=current_organization_id() and i.performed_by=auth.uid())
 or ((storage.foldername(storage.objects.name))[2]='vehicles' and fm_can_manage_vehicle(fm_storage_vehicle_id(storage.objects.name)))))
);
create policy fm_vehicle_evidence_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'vehicle-photos') with check(bucket_id<>'vehicle-photos');
create policy fm_vehicle_evidence_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'vehicle-photos');
