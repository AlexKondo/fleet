-- FleetMind Smart Carpool & Geospatial Intelligence — Phase C2 (Geospatial Layer).
--
-- Corporate Mobility Points (pack §9) are pre-resolved, org-curated locations (offices,
-- plants, hubs) that let the matching engine skip a live geocoding/places call entirely
-- when a trip's origin/destination matches one — the single biggest lever to reduce Google
-- API cost from day one (per the plan's Decisions section). Read is org-scoped for all
-- members (any employee may see/select a known company location when creating a trip);
-- write is restricted to fleet_manager/administrator, same RBAC shape as
-- `safety_equipment_items` (0041) and `carpool_policy_settings` (0053).
--
-- Also adds `geo_provider_quota_counters`, the DB-backed counter Cost Guard
-- (apps/web/lib/geospatial/costGuard.ts) uses to enforce per-organization/day call caps
-- across Vercel's multiple serverless instances — an in-memory counter would reset per
-- instance and undercount, so this must be a real table with an atomic UPSERT increment.

create table corporate_mobility_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  address_label text not null,
  latitude numeric not null check (latitude >= -90 and latitude <= 90),
  longitude numeric not null check (longitude >= -180 and longitude <= 180),
  is_active boolean not null default true,
  category text,
  provider_place_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index corporate_mobility_points_organization_id_idx
  on corporate_mobility_points (organization_id);

alter table corporate_mobility_points enable row level security;

create policy "members read own organization corporate mobility points" on corporate_mobility_points
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage corporate mobility points" on corporate_mobility_points
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  )
  with check (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

-- ---------------------------------------------------------------------------
-- Cost Guard: DB-backed quota counter (one row per organization per UTC day per provider
-- call kind). Incremented via an atomic upsert (`insert ... on conflict do update set
-- call_count = geo_provider_quota_counters.call_count + 1`) from the service-role client
-- only — no end-user RLS write path is needed since Cost Guard always runs server-side with
-- the admin client, same as other server-only counters in this repo. Read access is
-- restricted to fleet_manager/administrator for the telemetry dashboard (Phase C7).
-- ---------------------------------------------------------------------------

create table geo_provider_quota_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider_call_kind text not null
    check (provider_call_kind in ('geocode', 'place_search', 'routing')),
  day date not null,
  call_count integer not null default 0 check (call_count >= 0),
  consecutive_failure_count integer not null default 0 check (consecutive_failure_count >= 0),
  circuit_state text not null default 'closed'
    check (circuit_state in ('closed', 'open', 'half_open')),
  circuit_opened_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_call_kind, day)
);

create index geo_provider_quota_counters_org_day_idx
  on geo_provider_quota_counters (organization_id, day);

alter table geo_provider_quota_counters enable row level security;

create policy "fleet managers read geo provider quota counters" on geo_provider_quota_counters
  for select using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

-- No insert/update/delete policy for the `authenticated` role by design — Cost Guard writes
-- exclusively through the service-role (admin) client from server-only code, matching this
-- migration's own comment above and the same "no policy grants it to end users" append-only
-- style used by `carpool_policy_settings` (0053) and `audit_log` (0015).
