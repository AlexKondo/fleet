-- post_reservation_message (0017/0018) only ever created a notification for the specific
-- "delay impacts the next reservation" side effect — a plain message ('text', a reply, a
-- vehicle_issue report, etc.) was recorded in reservation_messages but never surfaced in
-- the recipient's notification bell at all, so the other side of a conversation had no
-- way to know a message was waiting short of opening the reservation page themselves.
-- Adds one notification per message to "the other side" of the thread: the requester if
-- staff (fleet_manager/administrator/security) sent it, or every fleet_manager/
-- administrator in the org if the requester sent it — mirrors who
-- "eligible members read reservation messages" already lets read the thread, so nobody
-- gets notified about a conversation they can't open.
--
-- entity_type/entity_id let the notification bell link straight to the reservation the
-- message belongs to instead of only a fixed per-title destination (NotificationBell.tsx)
-- — nullable and unused by every other notification kind, which keep linking (or not) the
-- same way they always have.
alter table notifications
  add column entity_type text,
  add column entity_id uuid;

create or replace function post_reservation_message(
  p_reservation_id uuid,
  p_message_type message_type,
  p_body text,
  p_new_expected_return_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_requester_id uuid;
  v_source_end_at timestamptz;
  v_source_trip_in_progress boolean;
  v_caller_role user_role;
  v_message_id uuid;
  v_impacted record;
  v_impacted_ids uuid[] := '{}';
  v_body_preview text;
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

  v_body_preview := left(trim(p_body), 140);

  if auth.uid() = v_requester_id then
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    select v_org_id, profiles.id, 'Nova mensagem na reserva', v_body_preview, 'reservation', p_reservation_id
    from profiles
    where profiles.organization_id = v_org_id
      and profiles.role in ('fleet_manager', 'administrator');
  else
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (v_org_id, v_requester_id, 'Nova mensagem na reserva', v_body_preview, 'reservation', p_reservation_id);
  end if;

  select
    exists (select 1 from inspections where reservation_id = p_reservation_id and type = 'pickup')
    and not exists (select 1 from inspections where reservation_id = p_reservation_id and type = 'return')
    into v_source_trip_in_progress;

  if p_message_type = 'delay' and p_new_expected_return_at is not null
     and v_source_trip_in_progress then
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
      v_impacted_ids := array_append(v_impacted_ids, v_impacted.id);

      insert into notifications (organization_id, user_id, title, body)
      values (
        v_org_id, v_impacted.requester_id, 'Sua próxima reserva pode ser afetada',
        'Um atraso na viagem anterior deste veículo pode afetar o horário da sua reserva. Buscando um veículo alternativo automaticamente.'
      );

      insert into notifications (organization_id, user_id, title, body)
      select v_org_id, profiles.id, 'Reserva marcada como impactada',
        'Um atraso pode afetar a próxima reserva deste veículo — o sistema tentará reatribuir automaticamente.'
      from profiles
      where profiles.organization_id = v_org_id
        and profiles.role in ('fleet_manager', 'administrator');
    end loop;
  end if;

  perform log_audit_event(
    v_org_id, auth.uid(), 'reservation_message_posted', 'reservation', p_reservation_id,
    null, jsonb_build_object('message_type', p_message_type)
  );

  return jsonb_build_object('message_id', v_message_id, 'impacted_reservation_ids', to_jsonb(v_impacted_ids));
end;
$$;

grant execute on function post_reservation_message(uuid, message_type, text, timestamptz) to authenticated;
