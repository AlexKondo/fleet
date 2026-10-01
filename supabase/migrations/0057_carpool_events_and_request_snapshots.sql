-- FleetMind Smart Carpool & Geospatial Intelligence — Phase C4 (APIs, Events, Idempotency,
-- Notifications), part 1 of 3: schema only. Additive: no existing function is touched, so
-- there is no overload risk in this file (0058/0059 create only brand-new function names).
--
-- 1. carpool_events — the domain-event record. RPCs never write notifications directly: they
--    emit a row here (via carpool_emit_event, 0058) and a separate subscriber trigger
--    (carpool_events_notify, 0058) turns events into notifications. The table doubles as a
--    durable, queryable lifecycle ledger for the C7 telemetry dashboard (audit_log remains
--    the compliance record; this is the operational event stream). Event types mirror
--    packages/domain/src/carpool/events.ts.
-- 2. carpool_ride_requests.host_origin_snapshot / host_destination_snapshot — the host
--    trip's origin/destination text at the moment the rider requested. revalidate_carpool_
--    matches (0059) compares them with the trip's CURRENT values to detect a route change
--    deterministically (no provider call needed in SQL; an unprovable change fails closed).
-- 3. A partial unique index so one rider can hold at most one live (PENDING/ACCEPTED)
--    request per offer, regardless of client_request_id (double-tap with a NEW key, or two
--    tabs, still cannot create a second live request).

create table carpool_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  event_type text not null check (event_type in (
    'CarpoolOfferEnabled', 'RideRequested', 'RideAccepted', 'RideRejected', 'RideCancelled',
    'RideInvalidated', 'RideExpired', 'HostTripChanged', 'HostTripCancelled'
  )),
  carpool_offer_id uuid references carpool_offers (id) on delete cascade,
  carpool_ride_request_id uuid references carpool_ride_requests (id) on delete cascade,
  trip_request_id uuid references trip_requests (id) on delete cascade,
  actor_id uuid references profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index carpool_events_organization_id_created_at_idx on carpool_events (organization_id, created_at desc);
create index carpool_events_carpool_offer_id_idx on carpool_events (carpool_offer_id);
create index carpool_events_carpool_ride_request_id_idx on carpool_events (carpool_ride_request_id);

alter table carpool_events enable row level security;

-- Read: fleet_manager/administrator of the same org only (telemetry/ops). No insert/update/
-- delete policy for anyone: the only writer is the security-definer carpool_emit_event.
create policy "fleet managers read own organization carpool events" on carpool_events
  for select using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

alter table carpool_ride_requests
  add column host_origin_snapshot text,
  add column host_destination_snapshot text;

create unique index carpool_ride_requests_one_live_per_rider_offer_idx
  on carpool_ride_requests (carpool_offer_id, rider_id)
  where status in ('PENDING', 'ACCEPTED');

-- Expiry sweep scans PENDING by age.
create index carpool_ride_requests_pending_created_at_idx
  on carpool_ride_requests (created_at)
  where status = 'PENDING';
