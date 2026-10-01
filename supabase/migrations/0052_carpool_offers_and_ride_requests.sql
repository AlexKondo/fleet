-- FleetMind Smart Carpool & Geospatial Intelligence — Phase C1 (Domain & Data Model).
-- Implementation pack: docs/FleetMind_Smart_Carpool_Geospatial_Implementation_Pack_v1.0/.
--
-- Today carpooling only exists as a one-time consent flag (`trip_requests.allow_carpool`,
-- 0047_carpool_consent_and_tolerance.sql) and an implicit join (`trip_participants`,
-- 0002_operational_cycle.sql) — there is no explicit host "offer N seats" action and no
-- durable, auditable ride-request lifecycle (rejections hard-delete the row today, per
-- 0020_carpool_host_acceptance.sql's own comment). This migration adds the two new tables
-- the pack's lifecycle needs, additive only: no existing RPC signature is touched, and
-- `trip_participants`/`create_carpool_participation`/`respond_to_carpool_request` are left
-- fully in place and unused by this phase (C4 wires the new RPCs on top of these tables).

create table carpool_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  trip_request_id uuid not null references trip_requests (id) on delete cascade,
  host_id uuid not null references profiles (id),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'disabled', 'completed')),
  seats_offered integer not null check (seats_offered >= 1),
  seats_available integer not null check (seats_available >= 0),
  policy_version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An offer never has more seats currently available than it was published with.
  check (seats_available <= seats_offered)
);

create index carpool_offers_organization_id_idx on carpool_offers (organization_id);
create index carpool_offers_trip_request_id_idx on carpool_offers (trip_request_id);
create index carpool_offers_host_id_idx on carpool_offers (host_id);

create table carpool_ride_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  carpool_offer_id uuid not null references carpool_offers (id) on delete cascade,
  rider_id uuid not null references profiles (id),
  requested_seats integer not null check (requested_seats >= 1),
  pickup_location jsonb,
  dropoff_location jsonb,
  requested_departure_at timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'INVALIDATED')),
  match_additional_distance_km numeric,
  match_additional_time_min numeric,
  policy_version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references profiles (id),
  -- Idempotency key for the RPC that creates this row (C4's `create_carpool_ride_request`):
  -- a client retrying a timed-out request must not create a second row. Nullable + unique
  -- (not part of the primary key) so historical callers without a key are unaffected, same
  -- pattern this repo already uses for optional-but-unique columns elsewhere.
  client_request_id uuid unique
);

create index carpool_ride_requests_organization_id_idx on carpool_ride_requests (organization_id);
create index carpool_ride_requests_carpool_offer_id_idx on carpool_ride_requests (carpool_offer_id);
create index carpool_ride_requests_rider_id_idx on carpool_ride_requests (rider_id);

-- ---------------------------------------------------------------------------
-- RLS — same house style as trip_participants (0002_operational_cycle.sql) and its
-- delete policy (0012_leave_carpool.sql): members read within their own organization,
-- writers are scoped to the row they own, with an explicit exists() carve-out for the
-- other party in the relationship (host <-> rider) rather than a blanket org-wide policy.
-- ---------------------------------------------------------------------------

alter table carpool_offers enable row level security;
alter table carpool_ride_requests enable row level security;

create policy "members read own organization carpool offers" on carpool_offers
  for select using (organization_id = current_organization_id());

create policy "hosts manage their own carpool offers" on carpool_offers
  for all using (
    organization_id = current_organization_id()
    and host_id = auth.uid()
  )
  with check (
    organization_id = current_organization_id()
    and host_id = auth.uid()
  );

create policy "members read own organization carpool ride requests" on carpool_ride_requests
  for select using (organization_id = current_organization_id());

create policy "riders manage their own carpool ride requests" on carpool_ride_requests
  for all using (
    organization_id = current_organization_id()
    and rider_id = auth.uid()
  )
  with check (
    organization_id = current_organization_id()
    and rider_id = auth.uid()
  );

-- The host of the linked offer can respond (accept/reject) to a ride request on their own
-- offer even though they are not the rider — mirrors respond_to_carpool_request's existing
-- "host or fleet_manager/administrator" authorization shape (0020/0021), expressed here as
-- an RLS carve-out rather than an RPC-only check, since C4's RPCs will run as the caller,
-- not security definer, unless a later phase decides otherwise.
create policy "offer hosts respond to ride requests on their own offers" on carpool_ride_requests
  for update using (
    organization_id = current_organization_id()
    and exists (
      select 1 from carpool_offers
      where carpool_offers.id = carpool_ride_requests.carpool_offer_id
        and carpool_offers.host_id = auth.uid()
    )
  )
  with check (
    organization_id = current_organization_id()
    and exists (
      select 1 from carpool_offers
      where carpool_offers.id = carpool_ride_requests.carpool_offer_id
        and carpool_offers.host_id = auth.uid()
    )
  );

create policy "fleet managers manage carpool offers" on carpool_offers
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

create policy "fleet managers manage carpool ride requests" on carpool_ride_requests
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );
