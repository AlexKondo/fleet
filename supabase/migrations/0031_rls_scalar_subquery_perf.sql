-- Performance: wrap current_organization_id() and auth.uid() in a scalar subquery
-- inside every RLS policy. `current_organization_id()` is already marked `stable`
-- (0001_init_schema.sql), which only guarantees its result is constant *within* a
-- statement — it does not make Postgres hoist the call out of a per-row qual. Wrapped as
-- `(select current_organization_id())`, the planner turns it into a one-time InitPlan
-- instead of re-running the function (a profiles PK lookup through a SECURITY DEFINER
-- context switch) for every row RLS filters. Same reasoning for the bare `auth.uid()`
-- calls. This is the standard Supabase RLS performance pattern — see
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Every policy below is dropped and recreated with IDENTICAL logic to its current
-- definition (cross-checked against 0001/0002/0008/0015/0017) — only the two call sites
-- are wrapped. No authorization behavior changes.

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization" on organizations;
create policy "members read own organization" on organizations
  for select using (id = (select current_organization_id()));

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists "members read profiles in own organization" on profiles;
create policy "members read profiles in own organization" on profiles
  for select using (organization_id = (select current_organization_id()));

-- ---------------------------------------------------------------------------
-- organization_settings
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization settings" on organization_settings;
create policy "members read own organization settings" on organization_settings
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "fleet managers manage organization settings" on organization_settings;
create policy "fleet managers manage organization settings" on organization_settings
  for all using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

-- ---------------------------------------------------------------------------
-- vehicle_locations
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization locations" on vehicle_locations;
create policy "members read own organization locations" on vehicle_locations
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "fleet managers manage locations" on vehicle_locations;
create policy "fleet managers manage locations" on vehicle_locations
  for all using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

-- ---------------------------------------------------------------------------
-- vehicle_categories
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization categories" on vehicle_categories;
create policy "members read own organization categories" on vehicle_categories
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "fleet managers manage categories" on vehicle_categories;
create policy "fleet managers manage categories" on vehicle_categories
  for all using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization vehicles" on vehicles;
create policy "members read own organization vehicles" on vehicles
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "fleet managers manage vehicles" on vehicles;
create policy "fleet managers manage vehicles" on vehicles
  for all using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('fleet_manager', 'administrator', 'maintenance_operator', 'security')
    )
  );

-- ---------------------------------------------------------------------------
-- trip_requests
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization trip requests" on trip_requests;
create policy "members read own organization trip requests" on trip_requests
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "members create own trip requests" on trip_requests;
create policy "members create own trip requests" on trip_requests
  for insert with check (
    organization_id = (select current_organization_id())
    and requester_id = (select auth.uid())
  );

drop policy if exists "fleet managers manage all trip requests" on trip_requests;
create policy "fleet managers manage all trip requests" on trip_requests
  for all using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

-- ---------------------------------------------------------------------------
-- reservations
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization reservations" on reservations;
create policy "members read own organization reservations" on reservations
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "fleet managers manage reservations" on reservations;
create policy "fleet managers manage reservations" on reservations
  for all using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('fleet_manager', 'administrator')
    )
  );

drop policy if exists "members create pending reservations for their own trip requests" on reservations;
create policy "members create pending reservations for their own trip requests" on reservations
  for insert with check (
    organization_id = (select current_organization_id())
    and status = 'pending_approval'
    and exists (
      select 1 from trip_requests
      where trip_requests.id = reservations.trip_request_id
        and trip_requests.requester_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- trip_participants
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization trip participants" on trip_participants;
create policy "members read own organization trip participants" on trip_participants
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "members join trips in own organization" on trip_participants;
create policy "members join trips in own organization" on trip_participants
  for insert with check (
    organization_id = (select current_organization_id())
    and passenger_id = (select auth.uid())
  );

drop policy if exists "members leave trips they joined" on trip_participants;
create policy "members leave trips they joined" on trip_participants
  for delete using (
    organization_id = (select current_organization_id())
    and passenger_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- inspections
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization inspections" on inspections;
create policy "members read own organization inspections" on inspections
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "members create inspections in own organization" on inspections;
create policy "members create inspections in own organization" on inspections
  for insert with check (
    organization_id = (select current_organization_id())
    and performed_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- inspection_photos
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization inspection photos" on inspection_photos;
create policy "members read own organization inspection photos" on inspection_photos
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "members attach photos to own organization inspections" on inspection_photos;
create policy "members attach photos to own organization inspections" on inspection_photos
  for insert with check (organization_id = (select current_organization_id()));

-- ---------------------------------------------------------------------------
-- workflow_tasks
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization workflow tasks" on workflow_tasks;
create policy "members read own organization workflow tasks" on workflow_tasks
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "fleet managers manage workflow tasks" on workflow_tasks;
create policy "fleet managers manage workflow tasks" on workflow_tasks
  for all using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('fleet_manager', 'administrator', 'maintenance_operator')
    )
  );

drop policy if exists "system creates workflow tasks from inspections" on workflow_tasks;
create policy "system creates workflow tasks from inspections" on workflow_tasks
  for insert with check (organization_id = (select current_organization_id()));

-- ---------------------------------------------------------------------------
-- storage.objects (vehicle-photos bucket)
-- ---------------------------------------------------------------------------
drop policy if exists "members read own organization vehicle photos" on storage.objects;
create policy "members read own organization vehicle photos" on storage.objects
  for select using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = (select current_organization_id())::text
  );

drop policy if exists "members upload vehicle photos to own organization" on storage.objects;
create policy "members upload vehicle photos to own organization" on storage.objects
  for insert with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = (select current_organization_id())::text
  );

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
drop policy if exists "members read own notifications" on notifications;
create policy "members read own notifications" on notifications
  for select using (
    organization_id = (select current_organization_id())
    and user_id = (select auth.uid())
  );

drop policy if exists "members mark own notifications as read" on notifications;
create policy "members mark own notifications as read" on notifications
  for update using (
    organization_id = (select current_organization_id())
    and user_id = (select auth.uid())
  )
  with check (
    organization_id = (select current_organization_id())
    and user_id = (select auth.uid())
  );

drop policy if exists "system creates notifications from operational actions" on notifications;
create policy "system creates notifications from operational actions" on notifications
  for insert with check (organization_id = (select current_organization_id()));

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
drop policy if exists "fleet managers read own organization audit log" on audit_log;
create policy "fleet managers read own organization audit log" on audit_log
  for select using (
    organization_id = (select current_organization_id())
    and exists (
      select 1 from profiles where id = (select auth.uid()) and role in ('fleet_manager', 'administrator')
    )
  );

-- ---------------------------------------------------------------------------
-- reservation_messages
-- ---------------------------------------------------------------------------
drop policy if exists "eligible members read reservation messages" on reservation_messages;
create policy "eligible members read reservation messages" on reservation_messages
  for select using (
    organization_id = (select current_organization_id())
    and (
      exists (
        select 1 from profiles
        where id = (select auth.uid()) and role in ('fleet_manager', 'administrator', 'security')
      )
      or exists (
        select 1 from reservations r
        join trip_requests tr on tr.id = r.trip_request_id
        where r.id = reservation_messages.reservation_id and tr.requester_id = (select auth.uid())
      )
    )
  );
