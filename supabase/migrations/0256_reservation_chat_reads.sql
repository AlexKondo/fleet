-- Reservation chat, two things.
-- 1) Every conversation is tied to the vehicle. reservation_messages only pointed at the reservation, whose vehicle can be swapped: each
-- message now records the vehicle it was about (filled by a trigger, whatever the path that writes it) and the bell notice carries the plate.
-- 2) What each person has already read, so the number on the chat icon means "unread" and goes away once the conversation is
-- opened, on any device. One row per person and conversation (reservation_messages.channel, 0255): a message from someone else after
-- last_read_at is unread. Opening the conversation also clears the matching bell notices of that person, so the two never disagree.
-- Additive: nothing reads this table until the app is deployed.
alter table public.reservation_messages add column if not exists vehicle_id uuid references public.vehicles (id);
update public.reservation_messages m set vehicle_id = r.vehicle_id from public.reservations r where r.id = m.reservation_id and m.vehicle_id is null;
alter table public.reservation_messages alter column vehicle_id set not null;
create index if not exists reservation_messages_vehicle_created_at_idx on public.reservation_messages (vehicle_id, created_at);

create or replace function public.fm_message_vehicle() returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
begin
  select r.vehicle_id into new.vehicle_id from reservations r where r.id = new.reservation_id;
  return new;
end;
$function$;
revoke all on function public.fm_message_vehicle() from public, anon, authenticated;
drop trigger if exists fm_message_vehicle on public.reservation_messages;
create trigger fm_message_vehicle before insert on public.reservation_messages
  for each row execute function public.fm_message_vehicle();

create or replace function public.post_reservation_message(
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
  v_plate text;
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

  -- the notice says which vehicle the conversation is about
  select plate into v_plate from vehicles where id = v_vehicle_id;
  v_body_preview := left(v_plate || ': ' || trim(p_body), 140);

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

create table if not exists public.reservation_chat_reads (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  channel text not null check (channel in ('requester_manager', 'requester_security', 'manager_security')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (reservation_id, channel, user_id)
);

alter table public.reservation_chat_reads enable row level security;
revoke all on public.reservation_chat_reads from public, anon, authenticated;
grant select on public.reservation_chat_reads to authenticated;

drop policy if exists fm_active_account on public.reservation_chat_reads;
create policy fm_active_account on public.reservation_chat_reads as restrictive to authenticated
  using ((select public.fm_account_enabled())) with check ((select public.fm_account_enabled()));
drop policy if exists "own chat reads" on public.reservation_chat_reads;
create policy "own chat reads" on public.reservation_chat_reads for select to authenticated
  using (organization_id = (select public.current_organization_id()) and user_id = (select auth.uid()));

create or replace function public.fm_mark_chat_read(p_reservation_id uuid, p_channel text) returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_org_id uuid := current_organization_id();
  v_requester_id uuid;
  v_role user_role;
  v_side text;
begin
  select tr.requester_id into v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id and r.organization_id = v_org_id;
  if v_requester_id is null then
    raise exception 'Reservation not found';
  end if;

  select role into v_role from profiles where id = auth.uid();
  v_side := case
    when auth.uid() = v_requester_id then 'requester'
    when v_role in ('fleet_manager', 'administrator') then 'manager'
    when v_role = 'security' then 'security'
  end;
  if v_side is null or p_channel not in ('requester_manager', 'requester_security', 'manager_security') or position(v_side in p_channel) = 0 then
    raise exception 'CHANNEL_NOT_ALLOWED';
  end if;

  insert into reservation_chat_reads (organization_id, reservation_id, channel, user_id, last_read_at)
  values (v_org_id, p_reservation_id, p_channel, auth.uid(), now())
  on conflict (reservation_id, channel, user_id) do update set last_read_at = excluded.last_read_at;

  -- the notice carries the plate and the start of the message (post_reservation_message): only the ones of THIS conversation are cleared
  update notifications n
    set read_at = now()
    where n.user_id = auth.uid()
      and n.read_at is null
      and n.entity_type = 'reservation'
      and n.entity_id = p_reservation_id
      and n.title = 'Nova mensagem na reserva'
      and exists (
        select 1 from reservation_messages m
        join vehicles v on v.id = m.vehicle_id
        where m.reservation_id = p_reservation_id and m.channel = p_channel
          and n.body in (left(v.plate || ': ' || trim(m.body), 140), left(trim(m.body), 140))
      );
end;
$function$;

revoke all on function public.fm_mark_chat_read(uuid, text) from public, anon;
grant execute on function public.fm_mark_chat_read(uuid, text) to authenticated;
