-- Rollback of 0260: back to the 0259 behaviour (a plain 1 / 2 decides the latest pending request).
drop function if exists public.fm_approval_decide_by_code(text, text, text, text);
drop function if exists public.fm_approval_decide_request(uuid, text, text, text);
drop function if exists public.fm_approval_request_code(uuid);
-- fm_approval_decide_by_phone is replaced by the 0259 body (see 0259_approval_by_number_reply.sql)
create or replace function public.fm_approval_decide_by_phone(p_from_phone text, p_decision text, p_message_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q fm_approval_requests%rowtype;
  v_token text;
begin
  if p_decision not in ('approve', 'reject') or coalesce(fm_phone_digits_norm(p_from_phone), '') = '' then
    return jsonb_build_object('status', 'none');
  end if;
  select * into q from fm_approval_requests
   where status = 'pending' and channel = 'whatsapp' and expires_at > now()
     and fm_phone_digits_norm(phone_e164) = fm_phone_digits_norm(p_from_phone)
   order by created_at desc limit 1
   for update skip locked;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update fm_approval_requests set token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex') where id = q.id;
  return public.fm_approval_decide(v_token, p_decision, p_from_phone, p_message_id, 'whatsapp');
end;
$$;
