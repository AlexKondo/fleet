-- When somebody takes a carpool, the owner of the reservation (the host) is told by WhatsApp. This function returns what that message needs, only when
-- the host has a WhatsApp number registered WITH consent. Internal: service_role only (called by the server after the rider's request exists).
create function public.fm_carpool_notice(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select rr.status::text as status, rr.requested_seats, rr.pickup_location->>'label' as pickup_label, rider.full_name as rider_name,
         c.phone_e164, t.destination, t.departure_at, v.plate, v.name as vehicle_name
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
  return jsonb_build_object('ok', true, 'phone_e164', r.phone_e164, 'status', r.status, 'rider_name', r.rider_name, 'seats', r.requested_seats,
    'pickup_label', r.pickup_label, 'destination', r.destination, 'departure_at', r.departure_at, 'plate', r.plate, 'vehicle_name', r.vehicle_name);
end;
$$;
revoke all on function public.fm_carpool_notice(uuid) from public, anon, authenticated;
grant execute on function public.fm_carpool_notice(uuid) to service_role;
