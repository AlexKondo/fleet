-- The host answers a carpool request on WhatsApp: the message carries two buttons (Aceitar / Recusar). A single-use token (only its sha256 is stored) binds the
-- tap to ONE request and ONE host; the tap must also come from the host's registered number. Recusar asks for a short justification (the next message of
-- that number), which goes to the rider. The real accept/reject still runs through accept_/reject_carpool_ride_request as the host (seats, audit, events).
create table public.fm_carpool_response_tokens (
  request_id uuid primary key references public.carpool_ride_requests(id) on delete cascade,
  host_id uuid not null references public.profiles(id),
  token_hash text not null,
  phone_e164 text not null,
  status text not null default 'pending' check (status in ('pending', 'awaiting_reason', 'done')),
  reason text,
  awaiting_since timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.fm_carpool_response_tokens enable row level security;
revoke all on public.fm_carpool_response_tokens from public, anon, authenticated;

-- 0234 returned what the message needs; now it also issues the token while the request waits for the host (PENDING). Same signature (create or replace).
create or replace function public.fm_carpool_notice(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_token text;
begin
  select rr.status::text as status, rr.requested_seats, rr.pickup_location->>'label' as pickup_label, rider.full_name as rider_name,
         o.host_id, c.phone_e164, t.destination, t.departure_at, v.plate, v.name as vehicle_name
    into r
    from carpool_ride_requests rr
    join carpool_offers o on o.id = rr.carpool_offer_id
    join trip_requests t on t.id = o.trip_request_id
    join profiles rider on rider.id = rr.rider_id
    left join reservations res on res.trip_request_id = t.id and res.status <> 'cancelled'
    left join vehicles v on v.id = res.vehicle_id
    left join fm_member_access a on a.user_id = o.host_id
    left join fm_whatsapp_contacts c on c.user_id = o.host_id and c.consent_confirmed
   where rr.id = p_request_id and coalesce(a.enabled, true)
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.phone_e164 is null then return jsonb_build_object('ok', false, 'reason', 'no_phone'); end if;
  if r.status = 'PENDING' then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into fm_carpool_response_tokens(request_id, host_id, token_hash, phone_e164, expires_at)
      values (p_request_id, r.host_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), r.phone_e164, now() + interval '24 hours')
      on conflict (request_id) do update set token_hash = excluded.token_hash, phone_e164 = excluded.phone_e164, status = 'pending', reason = null,
        awaiting_since = null, expires_at = excluded.expires_at, created_at = now();
  end if;
  return jsonb_build_object('ok', true, 'phone_e164', r.phone_e164, 'status', r.status, 'rider_name', r.rider_name, 'seats', r.requested_seats,
    'pickup_label', r.pickup_label, 'destination', r.destination, 'departure_at', r.departure_at, 'plate', r.plate, 'vehicle_name', r.vehicle_name,
    'token', v_token);
end;
$$;

-- What a tap on Aceitar / Recusar may do: {ok, request_id, host_email, rider_name} or {ok:false, reason}. Nothing is changed here.
create function public.fm_carpool_token_resolve(p_token text, p_from_phone text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q record; v_email text; v_rider text; v_status text;
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into q from fm_carpool_response_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if fm_phone_digits_norm(p_from_phone) is distinct from fm_phone_digits_norm(q.phone_e164) or coalesce(fm_phone_digits_norm(p_from_phone), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'phone_mismatch');
  end if;
  if q.status = 'done' then return jsonb_build_object('ok', false, 'reason', 'already_done'); end if;
  if q.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select rr.status, p.full_name into v_status, v_rider from carpool_ride_requests rr join profiles p on p.id = rr.rider_id where rr.id = q.request_id;
  if v_status is distinct from 'PENDING' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  select u.email into v_email from auth.users u left join fm_member_access a on a.user_id = u.id where u.id = q.host_id and coalesce(a.enabled, true);
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  return jsonb_build_object('ok', true, 'request_id', q.request_id, 'host_id', q.host_id, 'host_email', v_email, 'rider_name', v_rider, 'token_status', q.status);
end;
$$;

-- 'awaiting_reason' (after Recusar, waiting for the justification) or 'done' (answered). Only moves forward.
create function public.fm_carpool_token_mark(p_request_id uuid, p_status text, p_reason text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('awaiting_reason', 'done') then return false; end if;
  update fm_carpool_response_tokens set status = p_status, reason = coalesce(left(btrim(p_reason), 500), reason),
    awaiting_since = case when p_status = 'awaiting_reason' then now() else awaiting_since end
    where request_id = p_request_id and status <> 'done';
  return found;
end;
$$;

-- The refusal waiting for a justification from this number (the latest one, within 15 minutes): {ok, request_id, host_id, host_email, rider_name}.
create function public.fm_carpool_pending_reason(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q record; v_norm text := fm_phone_digits_norm(case when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) in (10, 11) then '55' || regexp_replace(p_phone, '[^0-9]', '', 'g') else p_phone end);
begin
  if v_norm is null or length(v_norm) < 10 then return jsonb_build_object('ok', false); end if;
  select t.request_id, t.host_id, u.email, p.full_name as rider_name into q
    from fm_carpool_response_tokens t
    join carpool_ride_requests rr on rr.id = t.request_id and rr.status = 'PENDING'
    join profiles p on p.id = rr.rider_id
    join auth.users u on u.id = t.host_id
   where t.status = 'awaiting_reason' and t.awaiting_since > now() - interval '15 minutes' and t.expires_at > now()
     and fm_phone_digits_norm(t.phone_e164) = v_norm
   order by t.awaiting_since desc limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'request_id', q.request_id, 'host_id', q.host_id, 'host_email', q.email, 'rider_name', q.rider_name);
end;
$$;

-- What the message to the RIDER needs after the host's decision (WhatsApp number registered with consent): {ok, phone_e164, host_name, ...}.
create function public.fm_carpool_decision_notice(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select rr.status::text as status, host.full_name as host_name, c.phone_e164, t.destination, t.departure_at, v.plate, v.name as vehicle_name
    into r
    from carpool_ride_requests rr
    join carpool_offers o on o.id = rr.carpool_offer_id
    join trip_requests t on t.id = o.trip_request_id
    join profiles host on host.id = o.host_id
    left join reservations res on res.trip_request_id = t.id and res.status <> 'cancelled'
    left join vehicles v on v.id = res.vehicle_id
    left join fm_member_access a on a.user_id = rr.rider_id
    left join fm_whatsapp_contacts c on c.user_id = rr.rider_id and c.consent_confirmed
   where rr.id = p_request_id and coalesce(a.enabled, true)
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.phone_e164 is null then return jsonb_build_object('ok', false, 'reason', 'no_phone'); end if;
  return jsonb_build_object('ok', true, 'phone_e164', r.phone_e164, 'status', r.status, 'host_name', r.host_name, 'destination', r.destination,
    'departure_at', r.departure_at, 'plate', r.plate, 'vehicle_name', r.vehicle_name);
end;
$$;

revoke all on function public.fm_carpool_notice(uuid), public.fm_carpool_token_resolve(text, text), public.fm_carpool_token_mark(uuid, text, text),
  public.fm_carpool_pending_reason(text), public.fm_carpool_decision_notice(uuid) from public, anon, authenticated;
grant execute on function public.fm_carpool_notice(uuid), public.fm_carpool_token_resolve(text, text), public.fm_carpool_token_mark(uuid, text, text),
  public.fm_carpool_pending_reason(text), public.fm_carpool_decision_notice(uuid) to service_role;
