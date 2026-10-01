-- PENDING migration (TIGHTENING) - apply ONLY after the app containing Phase C7b is deployed.
-- Do not move into supabase/migrations/ by hand: apply it with the Management API as documented in the
-- C7b Phase Report. Rollback: supabase/migrations-pending/rollback/0066_rollback.sql.
--
-- M1 (C7a audit, Medium): a rider with a PENDING carpool request (or a legacy PENDING trip_participants
-- row) could read the host's full trip_requests row (origin, destination, justification, times), the host's
-- reservation rows, the host profile name and the offer row over PostgREST - contradicting "coarse until
-- accepted" (migration 0064 only protected the RIDER'S places from the host, not the other direction).
--
-- Cause: rls_visible_trip_request_ids(), rls_related_profile_ids() and rls_requested_offer_ids() (0063)
-- counted PENDING relationships. FIX: only ACCEPTED relationships grant visibility; PENDING grants none.
--
-- The rider UI never needed PENDING visibility (verified in apps/web): the rider's /trips request list
-- reads only the rider's OWN carpool_ride_requests row (+ an optional offer embed that is null-safe), the
-- compatible-offer cards are built server-side with the service role, the host's reservation page is
-- host/manager/security-only, and the chat flows read the rider's own requests only.
--
-- Backward compatible with the currently deployed code (86dc094) and the new code: same function
-- signatures (CREATE OR REPLACE, no overload), same policies. The legacy "awaiting driver acceptance" row in
-- the rider's /trips "Caronas" list disappears for a legacy PENDING participant (decision L3: the legacy
-- create_carpool_participation path is already refused by RLS for coworker trips; there are 0 such rows).
--
-- DECISION on the host's `justification` for ACCEPTED riders: ACCEPTED riders keep reading the host's
-- trip_requests row (they need origin/destination/time for the trip they joined, and the Gantt bar), which
-- includes `justification`. RLS cannot hide a column per row and a column-level REVOKE would also break the
-- host's own reservation page and the managers. Accepted (low, documented): an accepted co-rider could read
-- the host's free-text justification over PostgREST. Recommended follow-up if the operator wants it closed:
-- move `justification` to a separate table readable by requester + managers.

create or replace function public.rls_visible_trip_request_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.trip_requests where requester_id = auth.uid()
  union
  select trip_request_id from public.trip_participants
    where passenger_id = auth.uid() and status = 'accepted'
  union
  select o.trip_request_id
    from public.carpool_ride_requests rr
    join public.carpool_offers o on o.id = rr.carpool_offer_id
    where rr.rider_id = auth.uid() and rr.status = 'ACCEPTED'
$$;

create or replace function public.rls_requested_offer_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select carpool_offer_id from public.carpool_ride_requests
    where rider_id = auth.uid() and status = 'ACCEPTED'
$$;

create or replace function public.rls_related_profile_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  -- host of a trip I joined / was ACCEPTED on (a PENDING request reveals nothing about the host)
  select tr.requester_id
    from public.trip_participants tp
    join public.trip_requests tr on tr.id = tp.trip_request_id
    where tp.passenger_id = auth.uid() and tp.status = 'accepted'
  union
  select o.host_id
    from public.carpool_ride_requests rr
    join public.carpool_offers o on o.id = rr.carpool_offer_id
    where rr.rider_id = auth.uid() and rr.status = 'ACCEPTED'
  union
  -- riders on my offers (any status: the host's history shows who asked)
  select rr.rider_id
    from public.carpool_ride_requests rr
    join public.carpool_offers o on o.id = rr.carpool_offer_id
    where o.host_id = auth.uid()
  union
  -- passengers on trips I host
  select tp.passenger_id
    from public.trip_participants tp
    join public.trip_requests tr on tr.id = tp.trip_request_id
    where tr.requester_id = auth.uid()
  union
  -- senders of messages in threads of my own reservations
  select m.sender_id
    from public.reservation_messages m
    join public.reservations r on r.id = m.reservation_id
    join public.trip_requests tr on tr.id = r.trip_request_id
    where tr.requester_id = auth.uid() and m.sender_id is not null
$$;
