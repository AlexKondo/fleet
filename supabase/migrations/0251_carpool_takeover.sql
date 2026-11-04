-- Carpool takeover. When the owner of a CONFIRMED reservation cancels it and somebody was accepted in the carpool, the reservation does not die:
--   1. it passes to the FIRST accepted rider who can drive (valid licence, authorized, no overlapping reservation); nobody can drive -> normal cancellation, vehicle released;
--   2. the rider must confirm he accepts the vehicle (WhatsApp buttons, bell or the reservation page); he declines or lets the deadline pass -> next eligible rider, none -> released;
--   3. when he accepts, the reservation goes to "aguardando aprovação" (the vehicle stays reserved) and his direct manager approves it (existing WhatsApp / e-mail flow);
--      no direct manager -> the fleet managers are told by WhatsApp and e-mail; approved -> he is the owner (it already is on his name), rejected -> cancelled.
-- Deadline of each rider: 1 day before the departure; when the cancellation comes later than that: 1 hour before the departure (never less than 15 minutes).
-- WhatsApp messages to riders go through an outbox (fm_whatsapp_outbox) that the app drains every minute. New carpool-engine requests only (carpool_ride_requests).
-- Rollback: rollback/0251_rollback.sql.

-- ---------------------------------------------------------------- outbox of WhatsApp messages
create table public.fm_whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  phone_e164 text not null,
  kind text not null,
  text text not null,
  title text,
  buttons jsonb,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index fm_whatsapp_outbox_pending_idx on public.fm_whatsapp_outbox (status, created_at);
alter table public.fm_whatsapp_outbox enable row level security;
revoke all on public.fm_whatsapp_outbox from public, anon, authenticated;

-- queues a message for a member who registered a number WITH consent (and whose account is enabled); nothing otherwise
create function public.fm_wa_enqueue(p_org uuid, p_user uuid, p_kind text, p_text text, p_title text default null, p_buttons jsonb default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text; v_id uuid;
begin
  select c.phone_e164 into v_phone from fm_whatsapp_contacts c left join fm_member_access a on a.user_id = c.user_id
   where c.user_id = p_user and c.consent_confirmed and coalesce(a.enabled, true);
  if v_phone is null then return null; end if;
  insert into fm_whatsapp_outbox(organization_id, user_id, phone_e164, kind, text, title, buttons)
    values (p_org, p_user, v_phone, p_kind, left(p_text, 3500), p_title, p_buttons) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.fm_wa_enqueue(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- what the rider-side bell notifications also say on WhatsApp (carpool accepted / carpool invalidated = trip cancelled / takeover result)
create function public.fm_notifications_to_whatsapp() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fm_wa_enqueue(new.organization_id, new.user_id, 'rider_notice', '*' || new.title || '*' || chr(10) || new.body, new.title, null);
  return new;
exception when others then
  raise warning 'fm_notifications_to_whatsapp failed: %', sqlerrm;
  return new;
end;
$$;
create trigger fm_notifications_to_whatsapp_trg after insert on public.notifications
  for each row when (new.title in ('Carona aceita', 'Carona invalidada', 'Reserva assumida aprovada', 'Reserva assumida recusada'))
  execute function public.fm_notifications_to_whatsapp();
revoke all on function public.fm_notifications_to_whatsapp() from public, anon, authenticated;

-- the app drains the outbox: claims a batch (skip locked), then marks each result
create function public.fm_wa_outbox_claim(p_limit integer default 20) returns setof public.fm_whatsapp_outbox
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
    update public.fm_whatsapp_outbox o set attempts = o.attempts + 1
     where o.id in (select x.id from public.fm_whatsapp_outbox x where x.status = 'pending' and x.attempts < 3 and x.created_at > now() - interval '2 days'
                     order by x.created_at limit greatest(1, least(coalesce(p_limit, 20), 50)) for update skip locked)
    returning o.*;
end;
$$;
create function public.fm_wa_outbox_mark(p_id uuid, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.fm_whatsapp_outbox set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
         error = case when p_ok then null else left(p_error, 200) end, sent_at = case when p_ok then now() else sent_at end
   where id = p_id;
$$;
revoke all on function public.fm_wa_outbox_claim(integer) from public, anon, authenticated;
revoke all on function public.fm_wa_outbox_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.fm_wa_outbox_claim(integer) to service_role;
grant execute on function public.fm_wa_outbox_mark(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------- the takeover
create table public.carpool_takeovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reservation_id uuid not null references public.reservations(id),
  trip_request_id uuid not null references public.trip_requests(id),
  original_requester_id uuid not null references public.profiles(id),
  candidates uuid[] not null,
  position integer not null,
  candidate_id uuid not null references public.profiles(id),
  status text not null default 'offered' check (status in ('offered','accepted','approved','rejected','released')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  cancel_reason text,
  updated_at timestamptz not null default now()
);
create unique index carpool_takeovers_open_idx on public.carpool_takeovers (reservation_id) where status in ('offered','accepted');
create index carpool_takeovers_due_idx on public.carpool_takeovers (expires_at) where status = 'offered';
alter table public.carpool_takeovers enable row level security;
revoke all on public.carpool_takeovers from public, anon, authenticated;
-- the candidate and the original owner read their own takeover (the reservation page shows the invitation)
grant select on public.carpool_takeovers to authenticated;
create policy "takeover parties read" on public.carpool_takeovers for select to authenticated
  using (organization_id = public.current_organization_id() and (candidate_id = auth.uid() or original_requester_id = auth.uid()));

create table public.fm_takeover_tokens (
  takeover_id uuid primary key references public.carpool_takeovers(id) on delete cascade,
  candidate_id uuid not null references public.profiles(id),
  token_hash text not null,
  phone_e164 text,
  expires_at timestamptz not null
);
alter table public.fm_takeover_tokens enable row level security;
revoke all on public.fm_takeover_tokens from public, anon, authenticated;

-- when each rider has to answer (see the header)
create function public.fm_takeover_deadline(p_departure timestamptz) returns timestamptz language sql stable as $$
  select case
    when p_departure - interval '1 day' > now() + interval '30 minutes' then p_departure - interval '1 day'
    when p_departure - interval '1 hour' > now() + interval '15 minutes' then p_departure - interval '1 hour'
    else now() + interval '15 minutes' end
$$;

-- why a member cannot take the vehicle over (null = he can): licence, authorization, disabled account, a licence that expires before the trip, an overlapping reservation
create function public.fm_takeover_reason(p_user uuid, p_org uuid, p_reservation uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record; v_exp date;
begin
  select res.start_at, res.end_at into r from reservations res where res.id = p_reservation;
  begin
    perform public.fm_assert_can_drive(p_user, p_org);
  exception when others then
    return 'cannot_drive';
  end;
  select drivers_license_expiration into v_exp from profiles where id = p_user;
  if v_exp is null or v_exp < (r.start_at at time zone 'America/Sao_Paulo')::date then return 'licence_expires'; end if;
  if exists (select 1 from reservations x join trip_requests t on t.id = x.trip_request_id
              where t.requester_id = p_user and x.id <> p_reservation and x.status in ('pending_approval','confirmed')
                and tstzrange(x.start_at, x.end_at, '[)') && tstzrange(r.start_at, r.end_at, '[)')) then return 'overlap'; end if;
  return null;
end;
$$;
revoke all on function public.fm_takeover_reason(uuid, uuid, uuid) from public, anon, authenticated;

-- the invitation to the current candidate: bell + WhatsApp with Aceitar / Recusar (single-use token bound to him and to his number)
create function public.fm_takeover_notify_offer(p_takeover_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t carpool_takeovers%rowtype; r record; v_token text; v_phone text; v_text text; v_due text;
begin
  select * into t from carpool_takeovers where id = p_takeover_id;
  select res.start_at, tr.destination, v.plate, v.name as vehicle_name, o.full_name as owner_name into r
    from reservations res join trip_requests tr on tr.id = res.trip_request_id join vehicles v on v.id = res.vehicle_id
    join profiles o on o.id = t.original_requester_id where res.id = t.reservation_id;
  v_due := to_char(t.expires_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (t.organization_id, t.candidate_id, 'Convite para assumir a reserva',
            left(r.owner_name || ' cancelou a viagem para ' || r.destination || ' (saída ' || to_char(r.start_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                 || '). Você aceita ficar com o veículo ' || coalesce(r.vehicle_name, r.plate) || '? Responda até ' || v_due || ' em Minhas viagens.', 500),
            'reservation', t.reservation_id);
  select c.phone_e164 into v_phone from fm_whatsapp_contacts c where c.user_id = t.candidate_id and c.consent_confirmed;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into fm_takeover_tokens(takeover_id, candidate_id, token_hash, phone_e164, expires_at)
    values (t.id, t.candidate_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_phone, t.expires_at)
    on conflict (takeover_id) do update set candidate_id = excluded.candidate_id, token_hash = excluded.token_hash, phone_e164 = excluded.phone_e164, expires_at = excluded.expires_at;
  v_text := '🚗 *A carona foi cancelada pelo motorista*' || chr(10) || chr(10)
    || r.owner_name || ' cancelou a viagem para ' || r.destination || '.' || chr(10)
    || 'Saída: ' || to_char(r.start_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || chr(10)
    || 'Veículo: ' || coalesce(r.vehicle_name, '') || ' (' || r.plate || ')' || chr(10) || chr(10)
    || 'Você aceita ficar com o veículo? Se aceitar, o pedido vai para o seu gestor aprovar.' || chr(10)
    || 'Responda até ' || v_due || '.';
  perform public.fm_wa_enqueue(t.organization_id, t.candidate_id, 'takeover_offer', v_text, 'Assumir a reserva',
    jsonb_build_array(jsonb_build_object('id', 'tk:yes:' || v_token, 'title', 'Aceitar'), jsonb_build_object('id', 'tk:no:' || v_token, 'title', 'Recusar')));
end;
$$;
revoke all on function public.fm_takeover_notify_offer(uuid) from public, anon, authenticated;

-- nobody (else) can take it: the reservation is cancelled for real and the vehicle goes back to the pool
create function public.fm_takeover_release(p_takeover_id uuid, p_why text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t carpool_takeovers%rowtype; v_vehicle uuid; v_vstatus vehicle_status; v_others integer; v_dest text;
begin
  select * into t from carpool_takeovers where id = p_takeover_id for update;
  if not found or t.status not in ('offered', 'accepted') then return; end if;
  update trip_requests set requester_id = t.original_requester_id where id = t.trip_request_id;
  select vehicle_id into v_vehicle from reservations where id = t.reservation_id for update;
  select status into v_vstatus from vehicles where id = v_vehicle for update;
  update reservations set status = 'cancelled', cancelled_by = t.original_requester_id, cancelled_at = now(),
         cancellation_reason = left(coalesce(t.cancel_reason, '') || case when t.cancel_reason is null then '' else ' - ' end || coalesce(p_why, 'ninguém assumiu a reserva'), 500)
   where id = t.reservation_id and status in ('confirmed', 'pending_approval');
  if v_vstatus in ('reserved', 'awaiting_pickup') then
    select count(*) into v_others from reservations where vehicle_id = v_vehicle and id <> t.reservation_id and status = 'confirmed';
    if v_others = 0 then
      update vehicles set status = coalesce(public.fm_vehicle_unsafe_status(v_vehicle), 'available'::vehicle_status), updated_at = now() where id = v_vehicle;
    end if;
  end if;
  update carpool_takeovers set status = 'released', updated_at = now() where id = t.id;
  select destination into v_dest from trip_requests where id = t.trip_request_id;
  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (t.organization_id, t.original_requester_id, 'Reserva cancelada', left('Sua reserva para ' || v_dest || ' foi cancelada: ' || coalesce(p_why, 'ninguém assumiu a reserva') || '.', 500), 'reservation', t.reservation_id);
  perform log_audit_event(t.organization_id, auth.uid(), 'carpool_takeover_released', 'reservation', t.reservation_id, null, jsonb_build_object('takeover_id', t.id, 'why', p_why));
end;
$$;
revoke all on function public.fm_takeover_release(uuid, text) from public, anon, authenticated;

-- the current candidate declined / let the deadline pass: the next eligible rider, or release
create function public.fm_takeover_advance(p_takeover_id uuid, p_why text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t carpool_takeovers%rowtype; v_pos integer; v_res carpool_takeovers%rowtype; v_start timestamptz;
begin
  select * into t from carpool_takeovers where id = p_takeover_id for update;
  if not found or t.status <> 'offered' then return; end if;
  select start_at into v_start from reservations where id = t.reservation_id;
  v_pos := t.position;
  while v_pos < cardinality(t.candidates) loop
    v_pos := v_pos + 1;
    if public.fm_takeover_reason(t.candidates[v_pos], t.organization_id, t.reservation_id) is null then
      update trip_requests set requester_id = t.candidates[v_pos] where id = t.trip_request_id;
      update carpool_takeovers set position = v_pos, candidate_id = t.candidates[v_pos], offered_at = now(),
             expires_at = public.fm_takeover_deadline(v_start), updated_at = now() where id = t.id;
      perform public.fm_takeover_notify_offer(t.id);
      perform log_audit_event(t.organization_id, auth.uid(), 'carpool_takeover_next', 'reservation', t.reservation_id, null, jsonb_build_object('takeover_id', t.id, 'why', p_why, 'position', v_pos));
      return;
    end if;
  end loop;
  perform public.fm_takeover_release(t.id, 'ninguém assumiu a reserva');
end;
$$;
revoke all on function public.fm_takeover_advance(uuid, text) from public, anon, authenticated;

-- the owner cancels: when somebody accepted in the carpool and can drive, the reservation is passed on instead of cancelled. Returns true when it was passed on.
create function public.fm_takeover_start(p_reservation_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare res reservations%rowtype; trip trip_requests%rowtype; v_cands uuid[]; v_rider uuid; v_i integer := 0; v_pos integer := 0; v_take uuid; q record; o record; v_owner text;
begin
  select * into res from reservations where id = p_reservation_id for update;
  if not found or res.status <> 'confirmed' then return false; end if;
  select * into trip from trip_requests where id = res.trip_request_id;
  if trip.requester_id is distinct from auth.uid() then return false; end if;
  -- the same guard as the cancellation itself: once the operation started, the normal path (and its error) applies
  if exists (select 1 from inspections where reservation_id = p_reservation_id and type = 'pickup')
     or exists (select 1 from fm_key_events where reservation_id = p_reservation_id and kind = 'delivered')
     or exists (select 1 from fm_gate_events where reservation_id = p_reservation_id and kind in ('departure', 'arrival')) then return false; end if;
  if exists (select 1 from carpool_takeovers where reservation_id = p_reservation_id and status in ('offered', 'accepted')) then return false; end if;
  select coalesce(array_agg(x.rider_id order by x.at, x.rider_id), '{}') into v_cands from (
    select distinct on (rr.rider_id) rr.rider_id, coalesce(rr.responded_at, rr.created_at) as at
      from carpool_ride_requests rr join carpool_offers co on co.id = rr.carpool_offer_id
     where co.trip_request_id = res.trip_request_id and rr.status = 'ACCEPTED' and rr.rider_id <> trip.requester_id
     order by rr.rider_id, coalesce(rr.responded_at, rr.created_at)) x;
  if cardinality(v_cands) = 0 then return false; end if;
  foreach v_rider in array v_cands loop
    v_i := v_i + 1;
    if public.fm_takeover_reason(v_rider, res.organization_id, p_reservation_id) is null then v_pos := v_i; exit; end if;
  end loop;
  if v_pos = 0 then return false; end if;
  insert into carpool_takeovers(organization_id, reservation_id, trip_request_id, original_requester_id, candidates, position, candidate_id, expires_at, cancel_reason)
    values (res.organization_id, p_reservation_id, res.trip_request_id, trip.requester_id, v_cands, v_pos, v_cands[v_pos], public.fm_takeover_deadline(res.start_at), p_reason)
    returning id into v_take;
  -- the old trip's carpool is over (the riders are told it was cancelled; they ask again if they want to); the new owner's own request is closed too
  for q in select rr.id from carpool_ride_requests rr join carpool_offers co on co.id = rr.carpool_offer_id
            where co.trip_request_id = res.trip_request_id and rr.status in ('PENDING', 'ACCEPTED') loop
    perform carpool_invalidate_request(q.id, 'HOST_TRIP_CANCELLED', auth.uid());
  end loop;
  for o in select id from carpool_offers where trip_request_id = res.trip_request_id and status = 'active' loop
    update carpool_offers set status = 'disabled', updated_at = now() where id = o.id;
    perform carpool_recompute_seats(o.id);
  end loop;
  update trip_requests set requester_id = v_cands[v_pos] where id = res.trip_request_id;
  select full_name into v_owner from profiles where id = v_cands[v_pos];
  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (res.organization_id, trip.requester_id, 'Reserva repassada ao caroneiro',
            left('Sua reserva para ' || trip.destination || ' foi repassada para ' || v_owner || ', que precisa aceitar e ter o gestor aprovando. Se ninguém assumir, ela será cancelada.', 500), 'reservation', p_reservation_id);
  perform public.fm_takeover_notify_offer(v_take);
  perform log_audit_event(res.organization_id, auth.uid(), 'carpool_takeover_offered', 'reservation', p_reservation_id, null, jsonb_build_object('takeover_id', v_take, 'candidate_id', v_cands[v_pos]));
  return true;
end;
$$;
revoke all on function public.fm_takeover_start(uuid, text) from public, anon, authenticated;

-- the candidate answers (internal: the member through fm_takeover_respond, the WhatsApp tap through fm_takeover_token_apply)
create function public.fm_takeover_apply(p_takeover_id uuid, p_user uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t carpool_takeovers%rowtype; v_reason text; v_dest text;
begin
  select * into t from carpool_takeovers where id = p_takeover_id for update;
  if not found or t.candidate_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t.status <> 'offered' then return jsonb_build_object('ok', false, 'reason', 'already_answered'); end if;
  if t.expires_at <= now() then
    perform public.fm_takeover_advance(t.id, 'expired');
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if not p_accept then
    perform public.fm_takeover_advance(t.id, 'declined');
    return jsonb_build_object('ok', true, 'outcome', 'declined', 'reservation_id', t.reservation_id);
  end if;
  v_reason := public.fm_takeover_reason(p_user, t.organization_id, t.reservation_id);
  if v_reason is not null then
    perform public.fm_takeover_advance(t.id, v_reason);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  update reservations set status = 'pending_approval' where id = t.reservation_id and status = 'confirmed';
  update carpool_takeovers set status = 'accepted', updated_at = now() where id = t.id;
  select destination into v_dest from trip_requests where id = t.trip_request_id;
  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (t.organization_id, p_user, 'Reserva aguardando aprovação do gestor', left('Você aceitou a reserva para ' || v_dest || '. Ela fica reservada para você e aguarda a aprovação do gestor.', 500), 'reservation', t.reservation_id);
  perform log_audit_event(t.organization_id, auth.uid(), 'carpool_takeover_accepted', 'reservation', t.reservation_id, null, jsonb_build_object('takeover_id', t.id));
  return jsonb_build_object('ok', true, 'outcome', 'accepted', 'reservation_id', t.reservation_id);
end;
$$;
revoke all on function public.fm_takeover_apply(uuid, uuid, boolean) from public, anon, authenticated;

create function public.fm_takeover_respond(p_takeover_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED'; end if;
  return public.fm_takeover_apply(p_takeover_id, auth.uid(), p_accept);
end;
$$;
revoke all on function public.fm_takeover_respond(uuid, boolean) from public, anon;
grant execute on function public.fm_takeover_respond(uuid, boolean) to authenticated;

-- the WhatsApp tap: the token binds it to ONE takeover, ONE candidate and his registered number
create function public.fm_takeover_token_apply(p_token text, p_from_phone text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare k record; v_res jsonb;
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into k from fm_takeover_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if k.phone_e164 is null or coalesce(fm_phone_digits_norm(p_from_phone), '') = '' or fm_phone_digits_norm(p_from_phone) is distinct from fm_phone_digits_norm(k.phone_e164) then
    return jsonb_build_object('ok', false, 'reason', 'phone_mismatch');
  end if;
  v_res := public.fm_takeover_apply(k.takeover_id, k.candidate_id, p_accept);
  return v_res || jsonb_build_object('candidate_id', k.candidate_id);
end;
$$;
revoke all on function public.fm_takeover_token_apply(text, text, boolean) from public, anon, authenticated;
grant execute on function public.fm_takeover_token_apply(text, text, boolean) to service_role;

-- the periodic tick (every minute from the server): deadlines that passed
create function public.fm_takeover_expire_due() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare t record; n integer := 0;
begin
  for t in select id from carpool_takeovers where status = 'offered' and expires_at <= now() order by expires_at limit 50 for update skip locked loop
    perform public.fm_takeover_advance(t.id, 'expired');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.fm_takeover_expire_due() from public, anon, authenticated;
grant execute on function public.fm_takeover_expire_due() to service_role;

-- the manager decided the reservation of an accepted takeover: the new owner is told (bell + WhatsApp)
create function public.fm_takeover_decided() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare t carpool_takeovers%rowtype; v_dest text;
begin
  select * into t from carpool_takeovers where reservation_id = new.id and status = 'accepted' for update;
  if not found then return new; end if;
  select destination into v_dest from trip_requests where id = new.trip_request_id;
  if new.status = 'confirmed' then
    update carpool_takeovers set status = 'approved', updated_at = now() where id = t.id;
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
      values (t.organization_id, t.candidate_id, 'Reserva assumida aprovada', left('Seu gestor aprovou: a reserva para ' || v_dest || ' agora é sua.', 500), 'reservation', new.id);
  elsif new.status = 'cancelled' then
    update carpool_takeovers set status = 'rejected', updated_at = now() where id = t.id;
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
      values (t.organization_id, t.candidate_id, 'Reserva assumida recusada', left('A reserva para ' || v_dest || ' não foi aprovada e foi cancelada.', 500), 'reservation', new.id);
  end if;
  return new;
end;
$$;
create trigger carpool_takeover_decided_trg after update of status on public.reservations
  for each row when (old.status = 'pending_approval' and new.status in ('confirmed', 'cancelled'))
  execute function public.fm_takeover_decided();
revoke all on function public.fm_takeover_decided() from public, anon, authenticated;

-- no direct manager: the fleet managers are told (bell + WhatsApp) and approve in the app; the e-mails are sent by the app with the returned list
create function public.fm_takeover_fleet_notice(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; m record; v_emails jsonb := '[]'::jsonb; v_text text;
begin
  select res.organization_id, res.status, tr.requester_id, tr.destination, res.start_at, p.full_name as requester_name, v.plate, v.name as vehicle_name into r
    from reservations res join trip_requests tr on tr.id = res.trip_request_id join profiles p on p.id = tr.requester_id join vehicles v on v.id = res.vehicle_id
   where res.id = p_reservation_id;
  if r.requester_id is null or r.status <> 'pending_approval' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  if exists (select 1 from fm_user_managers um join profiles mp on mp.id = um.manager_id left join fm_member_access a on a.user_id = um.manager_id
              where um.user_id = r.requester_id and mp.organization_id = r.organization_id and coalesce(a.enabled, true)) then
    return jsonb_build_object('ok', false, 'reason', 'has_manager');
  end if;
  v_text := '🚗 *Reserva aguardando aprovação*' || chr(10) || chr(10) || r.requester_name || ' assumiu a reserva de ' || coalesce(r.vehicle_name, r.plate) || ' (' || r.plate || ') para ' || r.destination
    || ' (saída ' || to_char(r.start_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || ') depois que o motorista cancelou, e ele não tem gestor direto cadastrado.'
    || chr(10) || 'Abra *Aprovar reservas* no FleetMind para liberar.';
  for m in select p.id, u.email from profiles p join auth.users u on u.id = p.id left join fm_member_access a on a.user_id = p.id
            where p.organization_id = r.organization_id and p.role in ('fleet_manager', 'administrator') and coalesce(a.enabled, true) loop
    insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
      values (r.organization_id, m.id, 'Reserva aguardando sua aprovação', left(r.requester_name || ' assumiu uma reserva para ' || r.destination || '. Abra "Aprovar reservas" para decidir.', 500), 'approval', p_reservation_id);
    perform public.fm_wa_enqueue(r.organization_id, m.id, 'takeover_fleet', v_text, 'Reserva aguardando aprovação', null);
    if m.email is not null and btrim(m.email) <> '' then v_emails := v_emails || to_jsonb(m.email); end if;
  end loop;
  return jsonb_build_object('ok', true, 'emails', v_emails, 'requester_name', r.requester_name, 'destination', r.destination, 'start_at', r.start_at);
end;
$$;
revoke all on function public.fm_takeover_fleet_notice(uuid) from public, anon, authenticated;
grant execute on function public.fm_takeover_fleet_notice(uuid) to service_role;

-- ---------------------------------------------------------------- hooks on existing behaviour
-- cancel_reservation: the owner's cancellation passes the reservation on when a rider can take it (everything else is the unchanged base function)
alter function public.cancel_reservation(uuid, text) rename to cancel_reservation_base;
revoke all on function public.cancel_reservation_base(uuid, text) from public, anon, authenticated;
create function public.cancel_reservation(p_reservation_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.fm_takeover_start(p_reservation_id, p_reason) then return; end if;
  perform public.cancel_reservation_base(p_reservation_id, p_reason);
end;
$$;
revoke all on function public.cancel_reservation(uuid, text) from public, anon;
grant execute on function public.cancel_reservation(uuid, text) to authenticated, service_role;

-- a reservation waiting for the rider's answer cannot start: no pickup state, no pickup
create or replace function public.fm_checklist_state(p_reservation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 s := public.fm_checklist_state_base(p_reservation_id);
 if public.fm_checklist_by(p_reservation_id) = 'gate' then
  s := s || jsonb_build_object('checklist_by', 'gate');
  if s->>'inspection_role' is distinct from 'security' then s := s || jsonb_build_object('can_pickup', false, 'can_return', false); end if;
 end if;
 if exists (select 1 from carpool_takeovers where reservation_id = p_reservation_id and status = 'offered') then
  s := s || jsonb_build_object('can_pickup', false, 'can_return', false, 'takeover_pending', true);
 end if;
 return s;
end;$$;

-- what a screen needs to know about the takeover of a reservation for the CURRENT member: he is the candidate (answer it) or the original owner (it was passed on)
create function public.fm_takeover_info(p_reservation_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'takeover_id', t.id, 'status', t.status, 'expires_at', t.expires_at,
    'role', case when t.candidate_id = auth.uid() then 'candidate' else 'owner' end,
    'other_name', case when t.candidate_id = auth.uid() then o.full_name else c.full_name end)
    from carpool_takeovers t join profiles o on o.id = t.original_requester_id join profiles c on c.id = t.candidate_id
   where t.reservation_id = p_reservation_id and t.organization_id = public.current_organization_id()
     and t.status in ('offered', 'accepted') and (t.candidate_id = auth.uid() or t.original_requester_id = auth.uid())
   order by t.offered_at desc limit 1
$$;
revoke all on function public.fm_takeover_info(uuid) from public, anon;
grant execute on function public.fm_takeover_info(uuid) to authenticated;
