-- FleetMind Smart Carpool & Geospatial Intelligence — Phase C4, part 2 of 3: internal
-- helpers + the notification SUBSCRIBER.
--
-- Notification design (see Phase C4 report): the lifecycle RPCs (0059) only emit rows into
-- carpool_events via carpool_emit_event. A single AFTER INSERT trigger on carpool_events
-- (carpool_events_notify) is the subscriber that creates `notifications` rows. It is
-- SQL-side (not an app-side listener) because (a) this repo's notifications are in-app rows
-- written by RPCs in the same transaction, never by app code; (b) event + notification must
-- commit or roll back together — an app-side subscriber could lose notifications on a
-- crash/timeout, and could be skipped by the cron route, the voice dispatcher or a direct
-- RPC call; (c) the business RPCs stay free of notification logic — to replace the delivery
-- mechanism (e.g. add email, a queue) only this one trigger function changes.
--
-- Every notification sets entity_type='reservation' + entity_id = the host trip's
-- reservation id so the bell (NotificationBell.tsx notificationHref) links to
-- /reservations/{id}. Reservations are readable org-wide (RLS), so riders can open it.
--
-- All function names here are NEW (carpool_*), so there is no overload risk; the explicit
-- drop-if-exists lines make re-applying this file idempotent instead of creating a second
-- signature. Grants: every function here is internal — revoked from public, anon AND
-- authenticated (Supabase default privileges grant EXECUTE to anon/authenticated
-- separately from PUBLIC; see 0055 -> 0056).

drop function if exists carpool_policy_for_org(uuid);
drop function if exists carpool_norm_text(text);
drop function if exists carpool_host_trip_is_active(uuid);
drop function if exists carpool_vehicle_free_seats(uuid);
drop function if exists carpool_seats_taken(uuid);
drop function if exists carpool_emit_event(uuid, text, uuid, uuid, uuid, uuid, jsonb);
drop function if exists carpool_notify_user(uuid, uuid, text, text, uuid, boolean);
drop function if exists carpool_events_notify() cascade;

-- Latest policy for an org, with the pack's defaults when the org has no row (matches
-- defaultCarpoolPolicyConfig in packages/domain/src/carpool/carpoolPolicy.ts).
create function carpool_policy_for_org(p_org uuid)
returns table (
  policy_version integer,
  carpool_enabled boolean,
  host_approval_required boolean,
  departure_window_minutes integer,
  max_additional_distance_km numeric,
  max_additional_time_minutes numeric,
  request_expiry_minutes integer
)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select s.policy_version, s.carpool_enabled, s.host_approval_required,
           s.departure_window_minutes, s.max_additional_distance_km,
           s.max_additional_time_minutes, s.request_expiry_minutes
      from carpool_policy_settings s
      where s.organization_id = p_org
      order by s.policy_version desc
      limit 1
  )
  select * from p
  union all
  select 0, true, true, 15, 5::numeric, 10::numeric, 30
  where not exists (select 1 from p);
$$;

-- Same normalisation as normalizeAddress() in packages/domain/src/carpool/revalidation.ts:
-- trim, collapse runs of whitespace, lowercase.
create function carpool_norm_text(p_text text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')));
$$;

-- "Host trip is active" = at least one pending_approval/confirmed reservation for the trip
-- (the same tripStatusOK definition apps/web/app/carpool/actions.ts uses for matching).
create function carpool_host_trip_is_active(p_trip_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from reservations r
    where r.trip_request_id = p_trip_request_id
      and r.status in ('pending_approval', 'confirmed')
  );
$$;

-- Free passenger seats the host vehicle can hold beyond the host's own party; null when the
-- trip has no reservation/vehicle yet. Same formula as respond_to_carpool_request (0020).
create function carpool_vehicle_free_seats(p_trip_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select vc.passenger_capacity - tr.passenger_count
    from reservations r
    join vehicles v on v.id = r.vehicle_id
    join vehicle_categories vc on vc.id = v.category_id
    join trip_requests tr on tr.id = r.trip_request_id
    where r.trip_request_id = p_trip_request_id
      and r.status in ('pending_approval', 'confirmed')
    limit 1;
$$;

-- Seats currently held by ACCEPTED requests. The offer's seats_available is always
-- re-derived as seats_offered - carpool_seats_taken(offer) inside the locking transaction,
-- never trusted from a prior read.
create function carpool_seats_taken(p_offer_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(requested_seats), 0)::integer
    from carpool_ride_requests
    where carpool_offer_id = p_offer_id and status = 'ACCEPTED';
$$;

create function carpool_emit_event(
  p_organization_id uuid,
  p_event_type text,
  p_offer_id uuid,
  p_request_id uuid,
  p_trip_request_id uuid,
  p_actor_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into carpool_events (
    organization_id, event_type, carpool_offer_id, carpool_ride_request_id, trip_request_id,
    actor_id, payload
  ) values (
    p_organization_id, p_event_type, p_offer_id, p_request_id, p_trip_request_id,
    p_actor_id, coalesce(p_payload, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Insert a notification, or (p_group) refresh an existing UNREAD one for the same
-- user/title/entity instead of stacking duplicates (pack 05: "avoid notification spam;
-- group/update where appropriate").
create function carpool_notify_user(
  p_org uuid,
  p_user uuid,
  p_title text,
  p_body text,
  p_entity_id uuid,
  p_group boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if p_user is null then
    return;
  end if;

  if p_group and p_entity_id is not null then
    select id into v_existing
      from notifications
      where user_id = p_user and title = p_title and read_at is null
        and entity_type = 'reservation' and entity_id = p_entity_id
      order by created_at desc
      limit 1
      for update;
    if v_existing is not null then
      update notifications set body = p_body, created_at = now() where id = v_existing;
      return;
    end if;
  end if;

  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
  values (
    p_org, p_user, p_title, p_body,
    case when p_entity_id is null then null else 'reservation' end,
    p_entity_id
  );
end;
$$;

-- THE SUBSCRIBER. Maps each domain event to notifications (mirrors notificationTargetsFor
-- in packages/domain/src/carpool/events.ts). Never raises: a notification problem must not
-- roll back the business action that emitted the event.
create function carpool_events_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_rider_id uuid;
  v_destination text;
  v_reservation_id uuid;
  v_pending integer;
  v_reason text;
  v_prev text;
  v_survivor text;
begin
  select o.host_id into v_host_id from carpool_offers o where o.id = new.carpool_offer_id;
  select tr.destination into v_destination from trip_requests tr where tr.id = new.trip_request_id;
  select r.id into v_reservation_id
    from reservations r
    where r.trip_request_id = new.trip_request_id
    order by r.active_status desc, r.created_at desc
    limit 1;
  if new.carpool_ride_request_id is not null then
    select rr.rider_id into v_rider_id from carpool_ride_requests rr where rr.id = new.carpool_ride_request_id;
  end if;
  v_destination := coalesce(v_destination, '');

  if new.event_type = 'RideRequested' then
    select count(*)::integer into v_pending
      from carpool_ride_requests where carpool_offer_id = new.carpool_offer_id and status = 'PENDING';
    if v_pending > 0 and new.actor_id is distinct from v_host_id then
      perform carpool_notify_user(
        new.organization_id, v_host_id, 'Pedido de carona na sua viagem',
        case when v_pending = 1
          then 'Alguém pediu para participar da sua viagem para ' || v_destination || '. Acesse os detalhes da reserva para aceitar ou recusar.'
          else v_pending || ' pessoas pediram para participar da sua viagem para ' || v_destination || '. Acesse os detalhes da reserva para aceitar ou recusar.'
        end,
        v_reservation_id, true
      );
    end if;

  elsif new.event_type = 'RideAccepted' then
    -- Auto-accept (host approval not required by policy): the rider is the actor but still
    -- needs the confirmation, and the host needs to know someone joined.
    if new.actor_id is distinct from v_rider_id or coalesce((new.payload ->> 'auto')::boolean, false) then
      perform carpool_notify_user(
        new.organization_id, v_rider_id, 'Carona aceita',
        'Sua solicitação de carona para ' || v_destination || ' foi aceita pelo motorista.',
        v_reservation_id, false
      );
    end if;
    if coalesce((new.payload ->> 'auto')::boolean, false) then
      perform carpool_notify_user(
        new.organization_id, v_host_id, 'Carona confirmada na sua viagem',
        'Um colega entrou na sua viagem para ' || v_destination || '.',
        v_reservation_id, false
      );
    end if;

  elsif new.event_type = 'RideRejected' then
    perform carpool_notify_user(
      new.organization_id, v_rider_id, 'Carona recusada',
      'Sua solicitação de carona para ' || v_destination || ' foi recusada pelo motorista.',
      v_reservation_id, false
    );

  elsif new.event_type = 'RideExpired' then
    perform carpool_notify_user(
      new.organization_id, v_rider_id, 'Solicitação de carona expirada',
      'Sua solicitação de carona para ' || v_destination || ' expirou sem resposta do motorista.',
      v_reservation_id, false
    );

  elsif new.event_type = 'RideCancelled' then
    v_prev := new.payload ->> 'previous_status';
    -- Host hears about a cancellation only when it actually changes their shared trip
    -- (an ACCEPTED rider leaving); a withdrawn PENDING request just disappears.
    if v_prev = 'ACCEPTED' and new.actor_id is distinct from v_host_id then
      perform carpool_notify_user(
        new.organization_id, v_host_id, 'Carona cancelada',
        'Um colega cancelou a carona na sua viagem para ' || v_destination || '.',
        v_reservation_id, false
      );
    end if;
    if new.actor_id is distinct from v_rider_id then
      perform carpool_notify_user(
        new.organization_id, v_rider_id, 'Carona cancelada',
        'Sua solicitação de carona para ' || v_destination || ' foi cancelada pela gestão.',
        v_reservation_id, false
      );
    end if;

  elsif new.event_type = 'RideInvalidated' then
    v_reason := new.payload ->> 'reason';
    perform carpool_notify_user(
      new.organization_id, v_rider_id, 'Carona invalidada',
      case v_reason
        when 'HOST_TRIP_CANCELLED' then 'Sua carona para ' || v_destination || ' foi invalidada porque a viagem do motorista foi cancelada.'
        when 'OFFER_DISABLED' then 'Sua carona para ' || v_destination || ' foi invalidada porque o motorista desativou a oferta de carona.'
        else 'Sua carona para ' || v_destination || ' foi invalidada porque a viagem do motorista foi alterada.'
      end,
      v_reservation_id, false
    );

  elsif new.event_type = 'HostTripChanged' then
    -- Riders whose request SURVIVED revalidation (e.g. a small time shift inside the
    -- window) get a heads-up; riders who were invalidated already got "Carona invalidada".
    for v_survivor in select jsonb_array_elements_text(coalesce(new.payload -> 'surviving_rider_ids', '[]'::jsonb))
    loop
      perform carpool_notify_user(
        new.organization_id, v_survivor::uuid, 'Viagem do motorista alterada',
        'A viagem do motorista para ' || v_destination || ' foi alterada. Confira os novos detalhes.',
        v_reservation_id, true
      );
    end loop;
    if new.actor_id is distinct from v_host_id then
      perform carpool_notify_user(
        new.organization_id, v_host_id, 'Viagem do motorista alterada',
        'Sua viagem para ' || v_destination || ' foi alterada. As solicitações de carona foram revalidadas.',
        v_reservation_id, true
      );
    end if;

  elsif new.event_type = 'HostTripCancelled' then
    if new.actor_id is distinct from v_host_id then
      perform carpool_notify_user(
        new.organization_id, v_host_id, 'Viagem com carona cancelada',
        'Sua viagem para ' || v_destination || ' foi cancelada e as solicitações de carona foram encerradas.',
        v_reservation_id, false
      );
    end if;
  end if;

  return new;
exception when others then
  -- Notification delivery is best-effort relative to the business action; the event row
  -- itself (and the audit_log entry) remain the source of truth.
  raise warning 'carpool_events_notify failed for event %: %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger carpool_events_notify_trg
  after insert on carpool_events
  for each row execute function carpool_events_notify();

-- Internal-only: revoke every default grant explicitly (public, anon AND authenticated).
revoke all on function carpool_policy_for_org(uuid) from public, anon, authenticated;
revoke all on function carpool_norm_text(text) from public, anon, authenticated;
revoke all on function carpool_host_trip_is_active(uuid) from public, anon, authenticated;
revoke all on function carpool_vehicle_free_seats(uuid) from public, anon, authenticated;
revoke all on function carpool_seats_taken(uuid) from public, anon, authenticated;
revoke all on function carpool_emit_event(uuid, text, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function carpool_notify_user(uuid, uuid, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function carpool_events_notify() from public, anon, authenticated;
grant execute on function carpool_policy_for_org(uuid) to service_role;
grant execute on function carpool_norm_text(text) to service_role;
grant execute on function carpool_host_trip_is_active(uuid) to service_role;
grant execute on function carpool_vehicle_free_seats(uuid) to service_role;
grant execute on function carpool_seats_taken(uuid) to service_role;
grant execute on function carpool_emit_event(uuid, text, uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function carpool_notify_user(uuid, uuid, text, text, uuid, boolean) to service_role;
