-- Reservation chat: the person chooses who to talk to. reservation_messages was ONE thread per reservation that the requester, every
-- manager and the gate all read, and a message from staff only ever notified the requester: the porter could not reach the fleet manager
-- at all, and anything said to the manager was read by the requester. Each reservation now has up to three private conversations:
--   requester_manager  (the existing thread: every message so far stays here, so does whatever the assistant posts)
--   requester_security
--   manager_security
-- Who reads what follows the channel; who is notified is the other side of the channel. Additive for the app in production: the new
-- p_channel argument has a default, so a call without it keeps working (a requester or manager lands on requester_manager, the gate on
-- requester_security). The only thing a person stops seeing is a conversation they are not part of.
alter table public.reservation_messages
  add column if not exists channel text not null default 'requester_manager'
  check (channel in ('requester_manager', 'requester_security', 'manager_security'));

drop index if exists public.reservation_messages_reservation_id_created_at_idx;
create index if not exists reservation_messages_reservation_channel_created_at_idx
  on public.reservation_messages (reservation_id, channel, created_at);

drop policy if exists "eligible members read reservation messages" on public.reservation_messages;
create policy "eligible members read reservation messages" on public.reservation_messages
  for select using (
    organization_id = (select public.current_organization_id())
    and (
      ((select public.current_user_role()) in ('fleet_manager', 'administrator') and channel in ('requester_manager', 'manager_security'))
      or ((select public.current_user_role()) = 'security' and channel in ('requester_security', 'manager_security'))
      or (
        channel in ('requester_manager', 'requester_security')
        and exists (
          select 1 from public.reservations r
          join public.trip_requests tr on tr.id = r.trip_request_id
          where r.id = reservation_messages.reservation_id and tr.requester_id = (select auth.uid())
        )
      )
    )
  );

drop function if exists public.post_reservation_message(uuid, message_type, text, timestamptz);

create function public.post_reservation_message(
  p_reservation_id uuid,
  p_message_type message_type,
  p_body text,
  p_new_expected_return_at timestamptz default null,
  p_channel text default null
) returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_org_id uuid := current_organization_id();
  v_vehicle_id uuid;
  v_requester_id uuid;
  v_source_end_at timestamptz;
  v_source_trip_in_progress boolean;
  v_caller_role user_role;
  v_side text;
  v_channel text;
  v_other text;
  v_message_id uuid;
  v_impacted record;
  v_impacted_ids uuid[] := '{}';
  v_body_preview text;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
  select r.vehicle_id, tr.requester_id, r.end_at into v_vehicle_id, v_requester_id, v_source_end_at
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  -- on their own reservation everybody is the requester, whatever their role
  v_side := case
    when auth.uid() = v_requester_id then 'requester'
    when v_caller_role in ('fleet_manager', 'administrator') then 'manager'
    when v_caller_role = 'security' then 'security'
  end;
  if v_side is null then
    raise exception 'Not authorized to message on this reservation';
  end if;

  v_channel := coalesce(p_channel, case when v_side = 'security' then 'requester_security' else 'requester_manager' end);
  if v_channel not in ('requester_manager', 'requester_security', 'manager_security') or position(v_side in v_channel) = 0 then
    raise exception 'CHANNEL_NOT_ALLOWED';
  end if;
  v_other := case when split_part(v_channel, '_', 1) = v_side then split_part(v_channel, '_', 2) else split_part(v_channel, '_', 1) end;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Message body cannot be empty';
  end if;

  insert into reservation_messages (organization_id, reservation_id, sender_id, message_type, body, channel)
  values (v_org_id, p_reservation_id, auth.uid(), p_message_type, p_body, v_channel)
  returning id into v_message_id;

  v_body_preview := left(trim(p_body), 140);

  if v_other = 'requester' then
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (v_org_id, v_requester_id, 'Nova mensagem na reserva', v_body_preview, 'reservation', p_reservation_id);
  else
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    select v_org_id, profiles.id, 'Nova mensagem na reserva', v_body_preview, 'reservation', p_reservation_id
    from profiles
    where profiles.organization_id = v_org_id
      and profiles.id <> auth.uid()
      and profiles.role = any(case when v_other = 'manager' then array['fleet_manager', 'administrator']::user_role[] else array['security']::user_role[] end);
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
    null, jsonb_build_object('message_type', p_message_type, 'channel', v_channel)
  );

  return jsonb_build_object('message_id', v_message_id, 'impacted_reservation_ids', to_jsonb(v_impacted_ids));
end;
$function$;

revoke all on function public.post_reservation_message(uuid, message_type, text, timestamptz, text) from public, anon;
grant execute on function public.post_reservation_message(uuid, message_type, text, timestamptz, text) to authenticated;
