-- W1 Product Contract & Domain Model + W2 Availability/Reservation Core
-- Mirrors packages/domain/src/entities/*.ts. Multi-tenant via organization_id + RLS
-- (fleet-car-saas.txt is treated as a SaaS product per user decision 2026-09-02).

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Tenancy & identity
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create type user_role as enum (
  'employee',
  'fleet_manager',
  'security',
  'maintenance_operator',
  'administrator'
);

-- One row per auth.users member, scoping every user to exactly one organization.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  full_name text not null,
  role user_role not null default 'employee',
  created_at timestamptz not null default now()
);

create index profiles_organization_id_idx on profiles (organization_id);

-- Per-tenant tuning for packages/domain readiness config (ReadinessConfig).
create table organization_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  range_safety_buffer_percent integer not null default 20,
  min_charge_hours_bev numeric not null default 6,
  min_refuel_hours_ice_or_phev numeric not null default 1,
  min_cleaning_hours numeric not null default 1
);

-- Resolves the organization of the currently authenticated user. SECURITY DEFINER so it
-- can read profiles even though profiles itself is RLS-protected; used by every tenant
-- policy below instead of trusting any client-supplied organization_id.
create function current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Fleet reference data
-- ---------------------------------------------------------------------------

create table vehicle_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null
);

create table vehicle_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  passenger_capacity integer not null check (passenger_capacity >= 0),
  supports_cargo boolean not null default false
);

create type energy_type as enum ('ICE', 'PHEV', 'BEV');

create type vehicle_status as enum (
  'available',
  'reserved',
  'awaiting_pickup',
  'in_use',
  'returning',
  'inspection',
  'charging',
  'cleaning',
  'maintenance',
  'blocked'
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  plate text not null,
  category_id uuid not null references vehicle_categories (id),
  energy_type energy_type not null,
  status vehicle_status not null default 'available',
  odometer_km integer not null default 0 check (odometer_km >= 0),
  fuel_level_percent numeric check (fuel_level_percent between 0 and 100),
  battery_level_percent numeric check (battery_level_percent between 0 and 100),
  estimated_range_km numeric not null default 0,
  next_service_odometer_km integer,
  home_location_id uuid references vehicle_locations (id),
  current_location_id uuid references vehicle_locations (id),
  has_blocking_damage boolean not null default false,
  missing_safety_equipment text[] not null default '{}',
  documentation_valid boolean not null default true,
  is_clean_exterior boolean not null default true,
  is_clean_interior boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, plate)
);

create index vehicles_organization_id_idx on vehicles (organization_id);
create index vehicles_status_idx on vehicles (organization_id, status);

-- ---------------------------------------------------------------------------
-- Trip requests & reservations (no double booking, enforced at the DB layer too —
-- see packages/domain/src/reservation/availability.ts for the application-layer guard)
-- ---------------------------------------------------------------------------

create table trip_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  requester_id uuid not null references profiles (id),
  departure_at timestamptz not null,
  expected_return_at timestamptz not null check (expected_return_at > departure_at),
  origin text not null,
  destination text not null,
  distance_km numeric not null check (distance_km >= 0),
  passenger_count integer not null check (passenger_count >= 1),
  requires_cargo boolean not null default false,
  justification text not null,
  created_at timestamptz not null default now()
);

create index trip_requests_organization_id_idx on trip_requests (organization_id);

create type reservation_status as enum (
  'pending_approval',
  'confirmed',
  'cancelled',
  'completed'
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id),
  trip_request_id uuid not null references trip_requests (id),
  status reservation_status not null default 'pending_approval',
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  created_at timestamptz not null default now(),
  -- Defense in depth for the double-booking rule: only active reservations
  -- (pending_approval/confirmed) participate in the exclusion; cancelled/completed
  -- reservations must never block a new booking.
  active_status boolean generated always as (status in ('pending_approval', 'confirmed')) stored,
  exclude using gist (
    vehicle_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (active_status)
);

create index reservations_organization_id_idx on reservations (organization_id);
create index reservations_vehicle_id_idx on reservations (vehicle_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — tenant isolation on every table above
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_settings enable row level security;
alter table vehicle_locations enable row level security;
alter table vehicle_categories enable row level security;
alter table vehicles enable row level security;
alter table trip_requests enable row level security;
alter table reservations enable row level security;

create policy "members read own organization" on organizations
  for select using (id = current_organization_id());

create policy "members read profiles in own organization" on profiles
  for select using (organization_id = current_organization_id());

create policy "members read own organization settings" on organization_settings
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage organization settings" on organization_settings
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

create policy "members read own organization locations" on vehicle_locations
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage locations" on vehicle_locations
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

create policy "members read own organization categories" on vehicle_categories
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage categories" on vehicle_categories
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

create policy "members read own organization vehicles" on vehicles
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage vehicles" on vehicles
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator', 'maintenance_operator', 'security')
    )
  );

create policy "members read own organization trip requests" on trip_requests
  for select using (organization_id = current_organization_id());

create policy "members create own trip requests" on trip_requests
  for insert with check (
    organization_id = current_organization_id()
    and requester_id = auth.uid()
  );

create policy "fleet managers manage all trip requests" on trip_requests
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

create policy "members read own organization reservations" on reservations
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage reservations" on reservations
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );
