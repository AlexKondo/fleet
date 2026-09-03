-- In-app notifications for the dashboard's NotificationBell
-- (apps/web/app/dashboard/NotificationBell.tsx). Explicitly scoped to in-app only — no
-- external email/SMS provider. Rows are written exclusively as a side effect of the
-- operational RPC functions extended below (create_vehicle_reservation,
-- approve_reservation, record_return, block_vehicle); there is no product surface that
-- lets a user compose and send an arbitrary notification.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- "Unread count" / "recent notifications" queries both filter by user first, so a
-- composite index leads with user_id in both cases.
create index notifications_user_id_read_at_idx on notifications (user_id, read_at);
create index notifications_user_id_created_at_idx on notifications (user_id, created_at desc);
create index notifications_organization_id_idx on notifications (organization_id);

alter table notifications enable row level security;

create policy "members read own notifications" on notifications
  for select using (
    organization_id = current_organization_id()
    and user_id = auth.uid()
  );

create policy "members mark own notifications as read" on notifications
  for update using (
    organization_id = current_organization_id()
    and user_id = auth.uid()
  )
  with check (
    organization_id = current_organization_id()
    and user_id = auth.uid()
  );

-- No policy restricts insert to a specific role/function the way it might in an ideal
-- world — Postgres RLS has no notion of "only this SECURITY DEFINER function may
-- insert." create_vehicle_reservation / approve_reservation / block_vehicle all run
-- SECURITY INVOKER (see the authorization note at the bottom of
-- 0004_operational_actions.sql), so their new `insert into notifications` statements
-- execute with the calling user's own privileges and need a permissive INSERT policy to
-- succeed at all — the exact same situation 0002_operational_cycle.sql already solved
-- for workflow_tasks with "system creates workflow tasks from inspections" (insert with
-- check (organization_id = current_organization_id()), no role restriction). This
-- mirrors that precedent: it does not let a client target a notification outside their
-- own organization, but (like the workflow_tasks policy it mirrors) does not stop an
-- authenticated user from directly calling PostgREST to insert a notification for
-- another user_id inside their own org. No product surface does this; documented here
-- as a known, accepted limitation matching existing code, not a new one.
create policy "system creates notifications from operational actions" on notifications
  for insert with check (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- Extend four existing RPCs with one additive notification insert each. Every function
-- body below is copied verbatim from its current definition (record_return's current
-- body is the one from 0006_vehicle_location_tracking.sql, which already replaced
-- 0004's version by adding p_current_location_id — that is the version this migration
-- must build on, not the older 0004 text). No existing guard, exception, return value,
-- or security context (SECURITY DEFINER vs the default INVOKER) is changed — each
-- change is marked "-- NEW:" below.
-- ---------------------------------------------------------------------------

-- create_vehicle_reservation (0003_trip_request_flow.sql) — SECURITY INVOKER (default),
-- unchanged.
create or replace function create_vehicle_reservation(
  p_departure_at timestamptz,
  p_expected_return_at timestamptz,
  p_origin text,
  p_destination text,
  p_distance_km numeric,
  p_passenger_count integer,
  p_requires_cargo boolean,
  p_justification text,
  p_vehicle_id uuid
) returns uuid
language plpgsql
as $$
declare
  v_org_id uuid := current_organization_id();
  v_trip_id uuid;
  v_reservation_id uuid;
begin
  insert into trip_requests (
    organization_id, requester_id, departure_at, expected_return_at, origin, destination,
    distance_km, passenger_count, requires_cargo, justification
  )
  values (
    v_org_id, auth.uid(), p_departure_at, p_expected_return_at, p_origin, p_destination,
    p_distance_km, p_passenger_count, p_requires_cargo, p_justification
  )
  returning id into v_trip_id;

  insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at)
  values (v_org_id, p_vehicle_id, v_trip_id, 'pending_approval', p_departure_at, p_expected_return_at)
  returning id into v_reservation_id;

  -- NEW: notify every fleet manager / administrator in this organization that a
  -- reservation is waiting on their approval.
  insert into notifications (organization_id, user_id, title, body)
  select v_org_id, profiles.id, 'Nova reserva aguardando aprovação',
    'Uma nova viagem para ' || p_destination || ' aguarda aprovação.'
  from profiles
  where profiles.organization_id = v_org_id
    and profiles.role in ('fleet_manager', 'administrator');

  return v_reservation_id;
end;
$$;

-- approve_reservation (0004_operational_actions.sql) — SECURITY INVOKER (default),
-- unchanged.
create or replace function approve_reservation(p_reservation_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
  v_requester_id uuid;
begin
  select vehicle_id into v_vehicle_id from reservations where id = p_reservation_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status is distinct from 'available' then
    raise exception 'Vehicle is not available to approve (current status: %)', v_vehicle_status;
  end if;

  update reservations
    set status = 'confirmed', approved_by = auth.uid(), approved_at = now()
    where id = p_reservation_id and status = 'pending_approval';
  if not found then
    raise exception 'Reservation is not pending approval';
  end if;

  update vehicles set status = 'reserved', updated_at = now() where id = v_vehicle_id;

  -- NEW: notify the requester that their reservation was approved.
  select tr.requester_id into v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id;

  insert into notifications (organization_id, user_id, title, body)
  values (
    current_organization_id(), v_requester_id, 'Reserva aprovada',
    'Sua reserva foi aprovada e o veículo está confirmado.'
  );
end;
$$;

-- record_return — SECURITY DEFINER, unchanged. Body copied from
-- 0006_vehicle_location_tracking.sql (the current definition, which already added
-- p_current_location_id on top of 0004's original — not from 0004 directly).
create or replace function record_return(
  p_reservation_id uuid,
  p_odometer_km integer,
  p_fuel_level_percent numeric,
  p_battery_level_percent numeric,
  p_has_new_damage boolean,
  p_damage_notes text,
  p_missing_safety_equipment text[],
  p_is_dirty_exterior boolean,
  p_is_dirty_interior boolean,
  p_role inspection_role,
  p_vehicle_event text,
  p_workflow_tasks workflow_task_type[],
  p_current_location_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
  v_inspection_id uuid;
  v_task workflow_task_type;
  v_requester_id uuid;
  v_caller_role user_role;
begin
  select r.vehicle_id, tr.requester_id into v_vehicle_id, v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_requester_id
     and v_caller_role not in ('security', 'fleet_manager', 'administrator') then
    raise exception 'Not authorized to perform this inspection';
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status not in ('in_use', 'returning') then
    raise exception 'Vehicle is not on an active trip (current status: %)', v_vehicle_status;
  end if;
  if p_odometer_km < (select odometer_km from vehicles where id = v_vehicle_id) then
    raise exception 'Odometer cannot go backwards';
  end if;

  -- Defense in depth (same rationale as the CASE-derived status re-derivation below): the
  -- client picks the location from a dropdown sourced from this org's vehicle_locations,
  -- but a malformed or cross-tenant id must never be written to vehicles.current_location_id.
  if p_current_location_id is not null
     and not exists (
       select 1 from vehicle_locations
       where id = p_current_location_id and organization_id = v_org_id
     ) then
    raise exception 'Invalid current location for this organization';
  end if;

  insert into inspections (
    organization_id, reservation_id, vehicle_id, type, performed_by, performed_by_role,
    odometer_km, fuel_level_percent, battery_level_percent, has_new_damage, damage_notes,
    missing_safety_equipment, is_dirty_exterior, is_dirty_interior
  ) values (
    v_org_id, p_reservation_id, v_vehicle_id, 'return', auth.uid(), p_role,
    p_odometer_km, p_fuel_level_percent, p_battery_level_percent, p_has_new_damage, p_damage_notes,
    p_missing_safety_equipment, p_is_dirty_exterior, p_is_dirty_interior
  ) returning id into v_inspection_id;

  update reservations set status = 'completed' where id = p_reservation_id;

  update vehicles set
    odometer_km = p_odometer_km,
    fuel_level_percent = coalesce(p_fuel_level_percent, fuel_level_percent),
    battery_level_percent = coalesce(p_battery_level_percent, battery_level_percent),
    has_blocking_damage = has_blocking_damage or p_has_new_damage,
    missing_safety_equipment = p_missing_safety_equipment,
    is_clean_exterior = not p_is_dirty_exterior,
    is_clean_interior = not p_is_dirty_interior,
    current_location_id = coalesce(p_current_location_id, current_location_id),
    status = case p_vehicle_event
      when 'COMPLETE_RETURN_INSPECTION_CLEAN' then 'available'
      when 'COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING' then 'cleaning'
      when 'COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING' then 'charging'
      when 'COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE' then 'maintenance'
      else (select status from vehicles where id = v_vehicle_id)
    end,
    updated_at = now()
    where id = v_vehicle_id;

  foreach v_task in array p_workflow_tasks loop
    insert into workflow_tasks (organization_id, vehicle_id, type, source_inspection_id)
    values (v_org_id, v_vehicle_id, v_task, v_inspection_id);
  end loop;

  -- NEW: one notification per return that created tasks (not one per task) for the
  -- org's fleet managers / administrators.
  if coalesce(array_length(p_workflow_tasks, 1), 0) > 0 then
    insert into notifications (organization_id, user_id, title, body)
    select v_org_id, profiles.id, 'Novas tarefas operacionais',
      'Uma devolução de veículo gerou novas tarefas operacionais.'
    from profiles
    where profiles.organization_id = v_org_id
      and profiles.role in ('fleet_manager', 'administrator');
  end if;

  return v_inspection_id;
end;
$$;

-- block_vehicle (0004_operational_actions.sql) — SECURITY INVOKER (default), unchanged.
create or replace function block_vehicle(p_vehicle_id uuid, p_reason text)
returns void
language plpgsql
as $$
begin
  update vehicles set status = 'blocked', updated_at = now()
    where id = p_vehicle_id
      and organization_id = current_organization_id()
      and status not in ('in_use', 'returning');
  if not found then
    raise exception 'Vehicle cannot be blocked from its current status';
  end if;

  insert into workflow_tasks (organization_id, vehicle_id, type, notes)
  values (current_organization_id(), p_vehicle_id, 'safety', p_reason);

  -- NEW: notify the org's fleet managers / administrators that a vehicle went out of
  -- rotation.
  insert into notifications (organization_id, user_id, title, body)
  select current_organization_id(), profiles.id, 'Veículo bloqueado',
    coalesce('Motivo: ' || p_reason, 'Um veículo foi bloqueado.')
  from profiles
  where profiles.organization_id = current_organization_id()
    and profiles.role in ('fleet_manager', 'administrator');
end;
$$;

-- All four functions above already have `grant execute ... to authenticated` from their
-- original migrations; grants are attached to the function object and persist across
-- `create or replace function`, so none are re-granted here. None of the four signatures
-- changed (record_return keeps the 13-arg signature from 0006), so no existing grant is
-- left dangling either.
