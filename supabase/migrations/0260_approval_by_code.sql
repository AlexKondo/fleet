-- One WhatsApp approval at a time: each request has a short code (the first 6 hex digits of its id, shown in the message).
-- "1 CODE" approves that request, "2 CODE" rejects it. A plain "1" / "2" only works when the manager has exactly one pending request;
-- with more, the answer lists the pending ones (code, vehicle, departure) and nothing is decided.
-- Decisions go through the same fm_approval_decide as the buttons and e-mail (phone, still manager, reservation still pending).
-- Rollback: rollback/0260_rollback.sql.

create or replace function public.fm_approval_request_code(p_id uuid) returns text
language sql immutable as $$
  select upper(left(replace(p_id::text, '-', ''), 6))
$$;

-- decides one request of the manager by a fresh single-use token (the token itself is not stored in clear)
create or replace function public.fm_approval_decide_request(p_id uuid, p_decision text, p_from_phone text, p_message_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text;
begin
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update fm_approval_requests set token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex') where id = p_id;
  return public.fm_approval_decide(v_token, p_decision, p_from_phone, p_message_id, 'whatsapp');
end;
$$;

create or replace function public.fm_approval_decide_by_phone(p_from_phone text, p_decision text, p_message_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
  v_list jsonb;
  q fm_approval_requests%rowtype;
begin
  if p_decision not in ('approve', 'reject') or coalesce(fm_phone_digits_norm(p_from_phone), '') = '' then
    return jsonb_build_object('status', 'none');
  end if;
  select count(*) into v_n from fm_approval_requests a
   where a.status = 'pending' and a.channel = 'whatsapp' and a.expires_at > now()
     and fm_phone_digits_norm(a.phone_e164) = fm_phone_digits_norm(p_from_phone);
  if v_n = 0 then
    return jsonb_build_object('status', 'none');
  end if;
  if v_n > 1 then
    select jsonb_agg(jsonb_build_object('code', x.code, 'plate', x.plate, 'start', x.start_at) order by x.created_at desc) into v_list from (
      select fm_approval_request_code(a.id) as code, v.plate, to_char(r.start_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as start_at, a.created_at
        from fm_approval_requests a
        join reservations r on r.id = a.reservation_id
        join vehicles v on v.id = r.vehicle_id
       where a.status = 'pending' and a.channel = 'whatsapp' and a.expires_at > now()
         and fm_phone_digits_norm(a.phone_e164) = fm_phone_digits_norm(p_from_phone)
    ) x;
    return jsonb_build_object('status', 'ambiguous', 'pending', v_list);
  end if;
  select * into q from fm_approval_requests a
   where a.status = 'pending' and a.channel = 'whatsapp' and a.expires_at > now()
     and fm_phone_digits_norm(a.phone_e164) = fm_phone_digits_norm(p_from_phone)
   limit 1 for update skip locked;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  return public.fm_approval_decide_request(q.id, p_decision, p_from_phone, p_message_id);
end;
$$;

create or replace function public.fm_approval_decide_by_code(p_from_phone text, p_decision text, p_code text, p_message_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare q fm_approval_requests%rowtype;
begin
  if p_decision not in ('approve', 'reject') or coalesce(fm_phone_digits_norm(p_from_phone), '') = '' or coalesce(p_code, '') = '' then
    return jsonb_build_object('status', 'none');
  end if;
  select * into q from fm_approval_requests a
   where a.status = 'pending' and a.channel = 'whatsapp' and a.expires_at > now()
     and fm_phone_digits_norm(a.phone_e164) = fm_phone_digits_norm(p_from_phone)
     and fm_approval_request_code(a.id) = upper(trim(p_code))
   for update skip locked;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  return public.fm_approval_decide_request(q.id, p_decision, p_from_phone, p_message_id);
end;
$$;

revoke all on function public.fm_approval_request_code(uuid) from public, anon, authenticated;
grant execute on function public.fm_approval_request_code(uuid) to service_role;
revoke all on function public.fm_approval_decide_request(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fm_approval_decide_by_phone(text, text, text) from public, anon, authenticated;
revoke all on function public.fm_approval_decide_by_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.fm_approval_decide_by_phone(text, text, text) to service_role;
grant execute on function public.fm_approval_decide_by_code(text, text, text, text) to service_role;
