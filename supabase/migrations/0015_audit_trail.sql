-- AUDIT_TRAIL.md (docs/instruction.md's referenced Controlled Engineering Set): an
-- append-only ledger for critical actions — "audit records are append-only from normal
-- application flows," immutable to normal users/admin flows, queryable only by
-- fleet_manager/administrator. Previously there was no dedicated audit table anywhere;
-- created_at/updated_at columns on individual tables are not a substitute (no actor, no
-- before/after, easily overwritten by the next UPDATE).

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  actor_id uuid references profiles (id) on delete set null,
  actor_role user_role,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index audit_log_organization_id_created_at_idx on audit_log (organization_id, created_at desc);

alter table audit_log enable row level security;

create policy "fleet managers read own organization audit log" on audit_log
  for select using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles where id = auth.uid() and role in ('fleet_manager', 'administrator')
    )
  );

-- Deliberately no insert/update/delete policy for `authenticated` at all — the only writer
-- is log_audit_event below (SECURITY DEFINER), so the log is append-only from every normal
-- application code path, matching AUDIT_TRAIL.md.
--
-- p_organization_id/p_actor_id are explicit parameters rather than derived internally via
-- current_organization_id()/auth.uid() because this function has two kinds of callers:
-- SECURITY INVOKER RPCs running under the acting user's own session (where those two
-- would resolve correctly) AND service-role app-layer calls for actions that have no RPC
-- of their own (e.g. team-management writes in settings/users/actions.ts) — auth.uid() is
-- NULL under the service-role key (no user JWT), so relying on it there would silently
-- write a blank actor. Callers in both cases already know their own organization/actor id,
-- so this takes them explicitly instead of guessing which context it's in.
--
-- SECURITY: because this is granted to `authenticated` (not just `service_role`), an
-- `authenticated` caller could otherwise pass ANY p_organization_id/p_actor_id — forging
-- an audit row attributed to a coworker, in an org they don't even belong to — since a
-- SECURITY DEFINER body bypasses audit_log's own RLS regardless of what the caller could
-- see. The guard below closes that: whenever there IS a real user session (auth.uid() is
-- not null — true for a direct `authenticated` call and for every nested call from the 7
-- RPCs below, which all pass their own auth.uid()/current_organization_id()), the given
-- actor/org must match that session exactly. Only a service-role call (auth.uid() is
-- null — no user JWT) skips this and is trusted as-is, same precedent as
-- lock_and_require_multiple_administrators/update_member_role in
-- 0013_atomic_last_administrator_guard.sql, which are granted to service_role alone.
create function log_audit_event(
  p_organization_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb default null,
  p_after jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role user_role;
begin
  if auth.uid() is not null then
    if p_actor_id is distinct from auth.uid() then
      raise exception 'log_audit_event: actor does not match the calling session';
    end if;
    if p_organization_id is distinct from current_organization_id() then
      raise exception 'log_audit_event: organization does not match the calling session';
    end if;
  end if;

  select role into v_actor_role from profiles where id = p_actor_id;
  insert into audit_log (
    organization_id, actor_id, actor_role, action, entity_type, entity_id, before, after
  ) values (
    p_organization_id, p_actor_id, v_actor_role, p_action, p_entity_type, p_entity_id, p_before, p_after
  );
end;
$$;

revoke all on function log_audit_event(uuid, uuid, text, text, uuid, jsonb, jsonb) from public;
grant execute on function log_audit_event(uuid, uuid, text, text, uuid, jsonb, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Instrument the existing critical-action RPCs. Each is `create or replace` with its
-- exact current signature (see the migration named in each comment for the version this
-- was copied from) plus one added `perform log_audit_event(...)` call — same transaction
-- as the state change itself, so the audit row can never be lost independently of it.
-- ---------------------------------------------------------------------------

-- approve_reservation — current body from 0008_notifications.sql.
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

  select tr.requester_id into v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id;

  insert into notifications (organization_id, user_id, title, body)
  values (
    current_organization_id(), v_requester_id, 'Reserva aprovada',
    'Sua reserva foi aprovada e o veículo está confirmado.'
  );

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_approved', 'reservation',
    p_reservation_id, null, jsonb_build_object('status', 'confirmed')
  );
end;
$$;

-- cancel_reservation — current body from 0010_cancel_reservation.sql.
create or replace function cancel_reservation(p_reservation_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_requester_id uuid;
  v_reservation_status reservation_status;
  v_vehicle_status vehicle_status;
  v_caller_role user_role;
  v_other_confirmed_count integer;
begin
  select r.vehicle_id, r.status, tr.requester_id
    into v_vehicle_id, v_reservation_status, v_requester_id
    from reservations r
    join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id
    for update of r;
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
    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_requester_id, 'Reserva cancelada',
      case when p_reason is not null and length(trim(p_reason)) > 0
        then 'Sua reserva foi cancelada: ' || p_reason
        else 'Sua reserva foi cancelada.'
      end
    );
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_cancelled', 'reservation', p_reservation_id,
    jsonb_build_object('status', v_reservation_status),
    jsonb_build_object('status', 'cancelled', 'reason', p_reason)
  );
end;
$$;

-- swap_reservation_vehicle — current body from 0005_fleet_manager_advanced_actions.sql.
create or replace function swap_reservation_vehicle(p_reservation_id uuid, p_new_vehicle_id uuid)
returns void
language plpgsql
as $$
declare
  v_old_vehicle_id uuid;
  v_reservation_status reservation_status;
  v_old_vehicle_status vehicle_status;
  v_new_vehicle_status vehicle_status;
  v_first_id uuid;
  v_second_id uuid;
  v_other_confirmed_count integer;
begin
  select vehicle_id, status into v_old_vehicle_id, v_reservation_status
    from reservations where id = p_reservation_id for update;
  if v_old_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;
  if v_reservation_status not in ('pending_approval', 'confirmed') then
    raise exception 'Cannot swap vehicle on a reservation with status %', v_reservation_status;
  end if;
  if p_new_vehicle_id = v_old_vehicle_id then
    raise exception 'New vehicle is the same as the currently assigned vehicle';
  end if;

  if v_old_vehicle_id < p_new_vehicle_id then
    v_first_id := v_old_vehicle_id;
    v_second_id := p_new_vehicle_id;
  else
    v_first_id := p_new_vehicle_id;
    v_second_id := v_old_vehicle_id;
  end if;
  perform 1 from vehicles where id = v_first_id for update;
  perform 1 from vehicles where id = v_second_id for update;

  select status into v_old_vehicle_status from vehicles where id = v_old_vehicle_id;
  select status into v_new_vehicle_status from vehicles where id = p_new_vehicle_id;
  if v_new_vehicle_status is null then
    raise exception 'Target vehicle not found';
  end if;
  if v_old_vehicle_status in ('in_use', 'returning') then
    raise exception 'This trip is already underway on the current vehicle (status: %); cannot swap', v_old_vehicle_status;
  end if;
  if v_new_vehicle_status is distinct from 'available' then
    raise exception 'Target vehicle is not available (current status: %)', v_new_vehicle_status;
  end if;

  begin
    update reservations set vehicle_id = p_new_vehicle_id where id = p_reservation_id;
    if not found then
      raise exception 'Not authorized to swap this reservation, or it no longer exists';
    end if;
  exception
    when exclusion_violation then
      raise exception 'Target vehicle already has a conflicting reservation for this time window';
  end;

  if v_reservation_status = 'confirmed' then
    update vehicles set status = 'reserved', updated_at = now() where id = p_new_vehicle_id;

    select count(*) into v_other_confirmed_count
      from reservations
      where vehicle_id = v_old_vehicle_id and id <> p_reservation_id and status = 'confirmed';

    if v_old_vehicle_status = 'reserved' and v_other_confirmed_count = 0 then
      update vehicles set status = 'available', updated_at = now() where id = v_old_vehicle_id;
    end if;
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_vehicle_reassigned', 'reservation',
    p_reservation_id,
    jsonb_build_object('vehicle_id', v_old_vehicle_id),
    jsonb_build_object('vehicle_id', p_new_vehicle_id)
  );
end;
$$;

-- block_vehicle — current body from 0008_notifications.sql.
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

  insert into notifications (organization_id, user_id, title, body)
  select current_organization_id(), profiles.id, 'Veículo bloqueado',
    coalesce('Motivo: ' || p_reason, 'Um veículo foi bloqueado.')
  from profiles
  where profiles.organization_id = current_organization_id()
    and profiles.role in ('fleet_manager', 'administrator');

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'vehicle_blocked', 'vehicle', p_vehicle_id,
    null, jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- unblock_vehicle — current body from 0004_operational_actions.sql, unchanged since.
create or replace function unblock_vehicle(p_vehicle_id uuid)
returns void
language plpgsql
as $$
begin
  update vehicles set status = 'available', updated_at = now()
    where id = p_vehicle_id and organization_id = current_organization_id() and status = 'blocked';
  if not found then
    raise exception 'Vehicle is not blocked';
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'vehicle_unblocked', 'vehicle', p_vehicle_id, null, null
  );
end;
$$;

-- complete_workflow_task — current body from 0004_operational_actions.sql, unchanged since.
create or replace function complete_workflow_task(p_task_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
  select vehicle_id into v_vehicle_id from workflow_tasks where id = p_task_id;
  if v_vehicle_id is null then
    raise exception 'Workflow task not found';
  end if;

  update workflow_tasks set status = 'done', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  select
    count(*) filter (where type in ('repair', 'safety', 'preventive_maintenance')),
    count(*) filter (where type = 'cleaning'),
    count(*) filter (where type = 'charging')
    into v_open_maintenance_like, v_open_cleaning, v_open_charging
    from workflow_tasks
    where vehicle_id = v_vehicle_id and status in ('open', 'in_progress');

  select status into v_current_status from vehicles where id = v_vehicle_id;
  if v_current_status not in ('maintenance', 'cleaning', 'charging') then
    perform log_audit_event(
      current_organization_id(), auth.uid(), 'workflow_task_completed', 'workflow_task',
      p_task_id, null, null
    );
    return;
  end if;

  if v_open_maintenance_like > 0 then
    update vehicles set status = 'maintenance', updated_at = now() where id = v_vehicle_id;
  elsif v_open_cleaning > 0 then
    update vehicles set status = 'cleaning', updated_at = now() where id = v_vehicle_id;
  elsif v_open_charging > 0 then
    update vehicles set status = 'charging', updated_at = now() where id = v_vehicle_id;
  else
    update vehicles
      set status = 'available', has_blocking_damage = false, updated_at = now()
      where id = v_vehicle_id;
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'workflow_task_completed', 'workflow_task',
    p_task_id, null, null
  );
end;
$$;

-- cancel_workflow_task — current body from 0011_cancel_workflow_task.sql.
create or replace function cancel_workflow_task(p_task_id uuid)
returns void
language plpgsql
as $$
declare
  v_vehicle_id uuid;
  v_current_status vehicle_status;
  v_open_maintenance_like integer;
  v_open_cleaning integer;
  v_open_charging integer;
begin
  select vehicle_id into v_vehicle_id from workflow_tasks where id = p_task_id;
  if v_vehicle_id is null then
    raise exception 'Workflow task not found';
  end if;

  update workflow_tasks set status = 'cancelled', resolved_at = now()
    where id = p_task_id and status in ('open', 'in_progress');
  if not found then
    raise exception 'Task is not open';
  end if;

  select
    count(*) filter (where type in ('repair', 'safety', 'preventive_maintenance')),
    count(*) filter (where type = 'cleaning'),
    count(*) filter (where type = 'charging')
    into v_open_maintenance_like, v_open_cleaning, v_open_charging
    from workflow_tasks
    where vehicle_id = v_vehicle_id and status in ('open', 'in_progress');

  select status into v_current_status from vehicles where id = v_vehicle_id;
  if v_current_status not in ('maintenance', 'cleaning', 'charging') then
    perform log_audit_event(
      current_organization_id(), auth.uid(), 'workflow_task_cancelled', 'workflow_task',
      p_task_id, null, null
    );
    return;
  end if;

  if v_open_maintenance_like > 0 then
    update vehicles set status = 'maintenance', updated_at = now() where id = v_vehicle_id;
  elsif v_open_cleaning > 0 then
    update vehicles set status = 'cleaning', updated_at = now() where id = v_vehicle_id;
  elsif v_open_charging > 0 then
    update vehicles set status = 'charging', updated_at = now() where id = v_vehicle_id;
  else
    update vehicles
      set status = 'available', has_blocking_damage = false, updated_at = now()
      where id = v_vehicle_id;
  end if;

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'workflow_task_cancelled', 'workflow_task',
    p_task_id, null, null
  );
end;
$$;
