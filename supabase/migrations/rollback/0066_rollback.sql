-- Rollback for supabase/migrations-pending/0066_m1_pending_requests_grant_no_visibility.sql: restores the 0063
-- bodies (PENDING grants visibility again). Same signatures, so nothing else changes.
create or replace function public.rls_visible_trip_request_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select id from public.trip_requests where requester_id = auth.uid()
  union
  select trip_request_id from public.trip_participants where passenger_id = auth.uid() and status in ('pending', 'accepted')
  union
  select o.trip_request_id from public.carpool_ride_requests rr join public.carpool_offers o on o.id = rr.carpool_offer_id
    where rr.rider_id = auth.uid() and rr.status in ('PENDING', 'ACCEPTED')
$$;
create or replace function public.rls_requested_offer_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$ select carpool_offer_id from public.carpool_ride_requests where rider_id = auth.uid() $$;
create or replace function public.rls_related_profile_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select tr.requester_id from public.trip_participants tp join public.trip_requests tr on tr.id = tp.trip_request_id
    where tp.passenger_id = auth.uid() and tp.status in ('pending', 'accepted')
  union
  select o.host_id from public.carpool_ride_requests rr join public.carpool_offers o on o.id = rr.carpool_offer_id
    where rr.rider_id = auth.uid() and rr.status in ('PENDING', 'ACCEPTED')
  union
  select rr.rider_id from public.carpool_ride_requests rr join public.carpool_offers o on o.id = rr.carpool_offer_id where o.host_id = auth.uid()
  union
  select tp.passenger_id from public.trip_participants tp join public.trip_requests tr on tr.id = tp.trip_request_id where tr.requester_id = auth.uid()
  union
  select m.sender_id from public.reservation_messages m join public.reservations r on r.id = m.reservation_id
    join public.trip_requests tr on tr.id = r.trip_request_id where tr.requester_id = auth.uid() and m.sender_id is not null
$$;
