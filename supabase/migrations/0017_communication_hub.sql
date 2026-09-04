-- COMMUNICATION_HUB.md / DV-004 / ADR-008 (docs/instruction.md's referenced Controlled
-- Engineering Set): "Core component linked primarily to Reservation... a message can
-- trigger domain behavior" — specifically BR-019/GT-007 delay impact analysis: a DELAY
-- message with a new estimated return time marks the vehicle's next reservation
-- IMPACTED and notifies both sides. Previously there was no messaging feature at all, and
-- no way to represent "impacted" short of overloading reservation_status (which also
-- drives the double-booking EXCLUDE constraint — deliberately left untouched here).
--
-- Scope note: this implements detection + notification, not automatic reassignment
-- ("search alternative" in BR-019/J-07). A fleet_manager still reassigns manually via
-- swap_reservation_vehicle (0005_fleet_manager_advanced_actions.sql) once notified — the
-- capability already exists, it just isn't auto-triggered by a delay report.

create type message_type as enum (
  'text', 'delay', 'vehicle_issue', 'return_time_change', 'vehicle_not_found', 'system_alert'
);

create table reservation_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  reservation_id uuid not null references reservations (id) on delete cascade,
  sender_id uuid references profiles (id),
  message_type message_type not null default 'text',
  body text not null,
  created_at timestamptz not null default now()
);

create index reservation_messages_reservation_id_created_at_idx
  on reservation_messages (reservation_id, created_at);

-- Additive-only "impacted" flag (not a reservation_status value): a value in
-- reservation_status also drives active_status/the EXCLUDE constraint
-- (0001_init_schema.sql), and a still-active, still-'confirmed' reservation whose vehicle
-- is delayed genuinely is still confirmed — impacted is a separate, orthogonal fact about
-- it, surfaced as a badge rather than a state-machine transition.
alter table reservations
  add column impacted_at timestamptz,
  add column impacted_reason text;

alter table reservation_messages enable row level security;

create policy "eligible members read reservation messages" on reservation_messages
  for select using (
    organization_id = current_organization_id()
    and (
      exists (
        select 1 from profiles
        where id = auth.uid() and role in ('fleet_manager', 'administrator', 'security')
      )
      or exists (
        select 1 from reservations r
        join trip_requests tr on tr.id = r.trip_request_id
        where r.id = reservation_messages.reservation_id and tr.requester_id = auth.uid()
      )
    )
  );

-- No insert policy for `authenticated` — every write goes through
-- post_reservation_message below (SECURITY DEFINER), which does the same eligibility
-- check once and keeps the DELAY side-effect atomic with the message row.
create or replace function post_reservation_message(
  p_reservation_id uuid,
  p_message_type message_type,
  p_body text,
  p_new_expected_return_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_requester_id uuid;
  v_source_end_at timestamptz;
  v_caller_role user_role;
  v_message_id uuid;
  v_impacted record;
begin
  select r.vehicle_id, tr.requester_id, r.end_at into v_vehicle_id, v_requester_id, v_source_end_at
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_requester_id
     and v_caller_role not in ('fleet_manager', 'administrator', 'security') then
    raise exception 'Not authorized to message on this reservation';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Message body cannot be empty';
  end if;

  insert into reservation_messages (organization_id, reservation_id, sender_id, message_type, body)
  values (v_org_id, p_reservation_id, auth.uid(), p_message_type, p_body)
  returning id into v_message_id;

  -- Only reservations genuinely scheduled AFTER the delayed trip's own original end
  -- (v_source_end_at) are "next" and at risk — without that lower bound this would also
  -- match an unrelated, already-earlier/in-progress reservation on the same vehicle that
  -- has nothing to do with this delay (e.g. reporting a delay on an afternoon trip must
  -- not mark that same vehicle's still-ongoing morning trip as impacted).
  if p_message_type = 'delay' and p_new_expected_return_at is not null then
    for v_impacted in
      select r2.id, tr2.requester_id
      from reservations r2
      join trip_requests tr2 on tr2.id = r2.trip_request_id
      where r2.organization_id = v_org_id
        and r2.vehicle_id = v_vehicle_id
        and r2.id <> p_reservation_id
        and r2.status in ('pending_approval', 'confirmed')
        and r2.start_at >= v_source_end_at
        and r2.start_at < p_new_expected_return_at
    loop
      update reservations set impacted_at = now(), impacted_reason = p_body
        where id = v_impacted.id;

      insert into notifications (organization_id, user_id, title, body)
      values (
        v_org_id, v_impacted.requester_id, 'Sua próxima reserva pode ser afetada',
        'Um atraso na viagem anterior deste veículo pode afetar o horário da sua reserva.'
      );

      insert into notifications (organization_id, user_id, title, body)
      select v_org_id, profiles.id, 'Reserva marcada como impactada',
        'Um atraso pode afetar a próxima reserva deste veículo — avalie reatribuição.'
      from profiles
      where profiles.organization_id = v_org_id
        and profiles.role in ('fleet_manager', 'administrator');
    end loop;
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_message_posted', 'reservation', p_reservation_id,
    null, jsonb_build_object('message_type', p_message_type)
  );

  return v_message_id;
end;
$$;

grant execute on function post_reservation_message(uuid, message_type, text, timestamptz) to authenticated;
