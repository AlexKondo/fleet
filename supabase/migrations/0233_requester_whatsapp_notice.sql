-- After the direct manager decides a reservation, the requester is told by WhatsApp too (until now only the in-app bell). This function returns what
-- that message needs, only when the requester has a WhatsApp number registered WITH consent. Internal: service_role only.
create function public.fm_requester_notice(p_reservation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select t.requester_id, p.full_name, c.phone_e164, res.status::text as status, v.plate, v.name as vehicle_name,
         t.origin, t.destination, t.departure_at, t.expected_return_at
    into r
    from reservations res
    join trip_requests t on t.id = res.trip_request_id
    join profiles p on p.id = t.requester_id
    left join vehicles v on v.id = res.vehicle_id
    left join fm_member_access a on a.user_id = t.requester_id
    left join fm_whatsapp_contacts c on c.user_id = t.requester_id and c.consent_confirmed
   where res.id = p_reservation_id and coalesce(a.enabled, true);
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.phone_e164 is null then return jsonb_build_object('ok', false, 'reason', 'no_phone'); end if;
  return jsonb_build_object('ok', true, 'phone_e164', r.phone_e164, 'requester_name', r.full_name, 'status', r.status,
    'plate', r.plate, 'vehicle_name', r.vehicle_name, 'origin', r.origin, 'destination', r.destination,
    'departure_at', r.departure_at, 'return_at', r.expected_return_at);
end;
$$;
revoke all on function public.fm_requester_notice(uuid) from public, anon, authenticated;
grant execute on function public.fm_requester_notice(uuid) to service_role;
