-- "O que tenho pra aprovar?" on WhatsApp: the approval requests pending for this manager's number, with their codes (see 0260).
-- Read only; the answer is the same list the robot gives when a plain "1" arrives with several requests pending.
-- Rollback: rollback/0261_rollback.sql.

create or replace function public.fm_approval_list_pending(p_from_phone text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'plate', x.plate, 'start', x.start_at) order by x.created_at desc), '[]'::jsonb)
    from (
      select fm_approval_request_code(a.id) as code, v.plate, to_char(r.start_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as start_at, a.created_at
        from fm_approval_requests a
        join reservations r on r.id = a.reservation_id
        join vehicles v on v.id = r.vehicle_id
       where a.status = 'pending' and a.channel = 'whatsapp' and a.expires_at > now()
         and coalesce(fm_phone_digits_norm(p_from_phone), '') <> ''
         and fm_phone_digits_norm(a.phone_e164) = fm_phone_digits_norm(p_from_phone)
    ) x
$$;

revoke all on function public.fm_approval_list_pending(text) from public, anon, authenticated;
grant execute on function public.fm_approval_list_pending(text) to service_role;
