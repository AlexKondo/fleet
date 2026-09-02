-- W5 Digital Check-out/Check-in + W6 Maintenance/Energy/Cleaning workflows +
-- carpooling participants + reservation approval tracking. Extends 0001_init_schema.sql,
-- mirrors packages/domain/src/{carpool,state-machine,workflow}/*.ts.

alter table reservations
  add column approved_by uuid references profiles (id),
  add column approved_at timestamptz;

alter table organization_settings
  add column carpool_departure_tolerance_minutes integer not null default 30,
  add column carpool_return_tolerance_minutes integer not null default 30;

-- ---------------------------------------------------------------------------
-- Carpooling: joining an existing trip is a participant row, never a second
-- reservation on the same vehicle (that would collide with the double-booking
-- EXCLUDE constraint by design — correctly, since it is the same vehicle/time).
-- ---------------------------------------------------------------------------

create table trip_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  trip_request_id uuid not null references trip_requests (id) on delete cascade,
  passenger_id uuid not null references profiles (id),
  passenger_count integer not null default 1 check (passenger_count >= 1),
  joined_at timestamptz not null default now(),
  unique (trip_request_id, passenger_id)
);

create index trip_participants_organization_id_idx on trip_participants (organization_id);

-- ---------------------------------------------------------------------------
-- Digital Check-out / Check-in (§9-10): one row per inspection performed (by the
-- traveler or by security), each with standardized photo evidence.
-- ---------------------------------------------------------------------------

create type inspection_type as enum ('pickup', 'return');
create type inspection_role as enum ('traveler', 'security');

create table inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  reservation_id uuid not null references reservations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id),
  type inspection_type not null,
  performed_by uuid not null references profiles (id),
  performed_by_role inspection_role not null,
  odometer_km integer not null check (odometer_km >= 0),
  fuel_level_percent numeric check (fuel_level_percent between 0 and 100),
  battery_level_percent numeric check (battery_level_percent between 0 and 100),
  has_new_damage boolean not null default false,
  damage_notes text,
  missing_safety_equipment text[] not null default '{}',
  is_dirty_exterior boolean not null default false,
  is_dirty_interior boolean not null default false,
  created_at timestamptz not null default now()
);

create index inspections_organization_id_idx on inspections (organization_id);
create index inspections_reservation_id_idx on inspections (reservation_id);

create type photo_angle as enum ('front', 'back', 'left_side', 'right_side', 'wheels', 'interior', 'damage');

create table inspection_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id uuid not null references inspections (id) on delete cascade,
  angle photo_angle not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index inspection_photos_inspection_id_idx on inspection_photos (inspection_id);

-- ---------------------------------------------------------------------------
-- Checklist -> Automatic Workflow (§11): the task queue that
-- packages/domain/src/workflow/deriveReturnOutcome.ts routes into.
-- ---------------------------------------------------------------------------

create type workflow_task_type as enum (
  'repair', 'safety', 'preventive_maintenance', 'cleaning', 'fuel', 'charging'
);
create type workflow_task_status as enum ('open', 'in_progress', 'done', 'cancelled');

create table workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id),
  type workflow_task_type not null,
  status workflow_task_status not null default 'open',
  source_inspection_id uuid references inspections (id),
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index workflow_tasks_organization_id_idx on workflow_tasks (organization_id);
create index workflow_tasks_vehicle_id_idx on workflow_tasks (vehicle_id, status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table trip_participants enable row level security;
alter table inspections enable row level security;
alter table inspection_photos enable row level security;
alter table workflow_tasks enable row level security;

create policy "members read own organization trip participants" on trip_participants
  for select using (organization_id = current_organization_id());

create policy "members join trips in own organization" on trip_participants
  for insert with check (
    organization_id = current_organization_id()
    and passenger_id = auth.uid()
  );

create policy "members read own organization inspections" on inspections
  for select using (organization_id = current_organization_id());

create policy "members create inspections in own organization" on inspections
  for insert with check (
    organization_id = current_organization_id()
    and performed_by = auth.uid()
  );

create policy "members read own organization inspection photos" on inspection_photos
  for select using (organization_id = current_organization_id());

create policy "members attach photos to own organization inspections" on inspection_photos
  for insert with check (organization_id = current_organization_id());

create policy "members read own organization workflow tasks" on workflow_tasks
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage workflow tasks" on workflow_tasks
  for all using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('fleet_manager', 'administrator', 'maintenance_operator')
    )
  );

create policy "system creates workflow tasks from inspections" on workflow_tasks
  for insert with check (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- Storage: standardized inspection photo evidence (§10). Objects are stored under
-- <organization_id>/<inspection_id>/<angle>.<ext> so RLS can enforce tenant isolation
-- purely from the path.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', false)
on conflict (id) do nothing;

create policy "members read own organization vehicle photos" on storage.objects
  for select using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = current_organization_id()::text
  );

create policy "members upload vehicle photos to own organization" on storage.objects
  for insert with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = current_organization_id()::text
  );
