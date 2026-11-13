-- The manager answers the approval request with a number on WhatsApp: "1" approves, "2" rejects (no buttons: they do not reach every phone).
-- The answer is matched to the manager's latest pending WhatsApp request (by his registered number, not expired) and decided by the SAME
-- fm_approval_decide used by the buttons and by e-mail: every check there still applies (phone, still his manager, reservation still pending).
-- The token of that request is not stored in clear, so this issues a fresh single-use token for it, stores its hash, and decides with it at once.
-- Rollback: rollback/0259_rollback.sql.

create function public.fm_approval_decide_by_phone(p_from_phone text, p_decision text, p_message_id text default null) returns jsonb
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

revoke all on function public.fm_approval_decide_by_phone(text, text, text) from public, anon, authenticated;
grant execute on function public.fm_approval_decide_by_phone(text, text, text) to service_role;
