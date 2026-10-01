-- FleetMind Smart Carpool & Geospatial Intelligence — Phase C1 (Domain & Data Model).
--
-- `organization_settings.carpool_departure_tolerance_minutes` /
-- `carpool_return_tolerance_minutes` (0002_operational_cycle.sql, defaults adjusted in
-- 0047_carpool_consent_and_tolerance.sql) are two bare columns with no versioning — a
-- match can never record *which* policy decided it, which the pack's audit requirements
-- (§06) need. This migration introduces a dedicated, versioned, insert-only policy table:
-- every org gets an explicit policy_version 1 row seeded from the pack's own TEST/UAT
-- defaults, then immediately overwritten field-by-field with that org's *existing*
-- departure/return tolerance values so no org silently loses its current tuning.
--
-- The old organization_settings columns are deliberately left in place, unused by this
-- migration — `findCarpoolMatches.ts`'s caller (`loadOrgConfig`, apps/web) still reads them
-- today and this phase does not touch the matching engine (C1 is additive-only, see the
-- plan). They become dead weight only once a later phase migrates that read path over.

create table carpool_policy_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  policy_version integer not null,
  carpool_enabled boolean not null default true,
  carpool_first_enabled boolean not null default true,
  host_opt_in_required boolean not null default true,
  host_approval_required boolean not null default true,
  departure_window_minutes integer not null,
  -- Kept distinct from max_additional_time_minutes (the route-detour budget, §C3): this is
  -- the schedule-compatibility window on the *return* leg, the direct successor of
  -- organization_settings.carpool_return_tolerance_minutes, migrated in below.
  return_window_minutes integer not null,
  max_additional_distance_km numeric not null,
  max_additional_time_minutes numeric not null,
  max_candidates_for_precise_routing integer not null default 5,
  request_expiry_minutes integer not null default 30,
  allow_intermediate_pickup boolean not null default true,
  allow_intermediate_dropoff boolean not null default true,
  -- "minimum seats = requested passenger seats" (pack default): expressed here as the
  -- floor for how many seats a rider may require an offer to still satisfy, not a fixed
  -- global number — see carpoolPolicy.ts for how it's actually evaluated per-request.
  minimum_seat_availability integer not null default 1,
  created_at timestamptz not null default now(),
  -- Insert-only / append-only by convention (documented, not DB-enforced — same style as
  -- audit_log's append-only guarantee coming from "no writer other than one function" rather
  -- than a trigger): application code must never UPDATE an existing row, only INSERT a new
  -- policy_version. One row per (organization, policy_version).
  unique (organization_id, policy_version)
);

create index carpool_policy_settings_organization_id_idx
  on carpool_policy_settings (organization_id, policy_version desc);

alter table carpool_policy_settings enable row level security;

create policy "members read own organization carpool policy settings" on carpool_policy_settings
  for select using (organization_id = current_organization_id());

create policy "fleet managers insert carpool policy settings" on carpool_policy_settings
  for insert with check (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

-- No update/delete policy for anyone, by design — matches audit_log's precedent
-- (0015_audit_trail.sql) of relying on "no policy grants it" rather than a trigger to
-- enforce append-only.

-- Seed policy_version 1 for every existing organization: pack TEST/UAT defaults first,
-- then the org's own current tolerance values override the two fields organization_settings
-- already expresses, so no org's real tuning is silently discarded.
insert into carpool_policy_settings (
  organization_id, policy_version,
  carpool_enabled, carpool_first_enabled, host_opt_in_required, host_approval_required,
  departure_window_minutes, return_window_minutes,
  max_additional_distance_km, max_additional_time_minutes,
  max_candidates_for_precise_routing, request_expiry_minutes,
  allow_intermediate_pickup, allow_intermediate_dropoff, minimum_seat_availability
)
select
  os.organization_id,
  1,
  true,
  true,
  true,
  true,
  os.carpool_departure_tolerance_minutes,
  os.carpool_return_tolerance_minutes,
  5,
  10,
  5,
  30,
  true,
  true,
  1
from organization_settings os
on conflict (organization_id, policy_version) do nothing;
