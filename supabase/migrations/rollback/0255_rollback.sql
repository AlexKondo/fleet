-- back to one shared thread (0181 body, 0031 policy). Conversations collapse into it: every message becomes readable by the three sides again.
drop function if exists public.post_reservation_message(uuid, message_type, text, timestamptz, text);

CREATE OR REPLACE FUNCTION public.post_reservation_message(p_reservation_id uuid, p_message_type message_type, p_body text, p_new_expected_return_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
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
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
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
$function$
;
revoke all on function public.post_reservation_message(uuid, message_type, text, timestamptz) from public, anon;
grant execute on function public.post_reservation_message(uuid, message_type, text, timestamptz) to authenticated;

drop policy if exists "eligible members read reservation messages" on public.reservation_messages;
create policy "eligible members read reservation messages" on public.reservation_messages
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

drop index if exists public.reservation_messages_reservation_channel_created_at_idx;
create index if not exists reservation_messages_reservation_id_created_at_idx
  on public.reservation_messages (reservation_id, created_at);
alter table public.reservation_messages drop column if exists channel;
