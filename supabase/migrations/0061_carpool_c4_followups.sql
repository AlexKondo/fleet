-- FleetMind Smart Carpool — Phase C5 STEP 0: C4 follow-up items tracked by the C4 Auditor.
--
-- 1. RECONCILE SWEEP. 0060 made the host-trip triggers swallow revalidation errors (a WARNING)
--    so a carpool problem can never abort the host's own cancellation. The price: if
--    revalidation fails, riders stay ACCEPTED/PENDING on a cancelled or changed host trip,
--    silently stranded (the pack forbids silently stranding a passenger). expire_stale_carpool_requests
--    (same signature, CREATE OR REPLACE, no overload; returns the number of EXPIRED requests as
--    before) now FIRST runs a reconcile pass: every active offer that still has live requests
--    whose host trip is no longer active / whose schedule or route snapshot no longer matches is
--    re-run through carpool_revalidate_trip with a NULL actor (system). Each trip is isolated in
--    its own sub-transaction so one failing trip cannot block the others; a failure is a WARNING
--    and the next run retries it.
--
-- 2. trip_participants FORGERY. The INSERT policy "members join trips in own organization"
--    only checked organization/passenger_id, so an employee could INSERT themselves with
--    status='accepted' and any passenger_count (bypassing host approval and seat accounting).
--    End users may now only insert status='pending' (what the legacy create_carpool_participation,
--    a SECURITY INVOKER function, does) with a positive count, onto a trip that is visible in
--    their own organization. Accepted rows are written only by security-definer code
--    (accept_carpool_ride_request / respond_to_carpool_request), which bypass RLS.
--
-- 3. LEGACY RPC GRANTS. create_carpool_participation and respond_to_carpool_request carried
--    PUBLIC/anon EXECUTE (Supabase default privileges). Revoked from public and anon; authenticated
--    keeps EXECUTE (the legacy form path still needs it).
--
-- OVERLOAD AUDIT: the only function (re)defined here is expire_stale_carpool_requests() with the
-- identical signature (create or replace). The other two are only re-granted.

-- ---------------------------------------------------------------------------
-- 1. Reconcile sweep + expiry
-- ---------------------------------------------------------------------------
create or replace function expire_stale_carpool_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_locked carpool_ride_requests%rowtype;
  v_count integer := 0;
begin
  -- Pass 1: RECONCILE. Re-run revalidation for any trip whose live requests are inconsistent
  -- with the host trip's current state (it normally already ran from the triggers; this is the
  -- safety net for when it failed).
  for v_row in
    select distinct o.trip_request_id, o.organization_id
      from carpool_offers o
      join trip_requests tr on tr.id = o.trip_request_id
      cross join lateral carpool_policy_for_org(o.organization_id) p
      where o.status = 'active'
        and exists (
          select 1 from carpool_ride_requests r
            where r.carpool_offer_id = o.id
              and r.status in ('PENDING', 'ACCEPTED')
              and (
                not carpool_host_trip_is_active(o.trip_request_id)
                or abs(extract(epoch from (r.requested_departure_at - tr.departure_at))) / 60.0 > p.departure_window_minutes
                or (r.host_destination_snapshot is not null
                    and carpool_norm_text(r.host_destination_snapshot) <> carpool_norm_text(tr.destination))
                or (r.host_origin_snapshot is not null
                    and carpool_norm_text(r.host_origin_snapshot) <> carpool_norm_text(tr.origin))
              )
        )
      limit 200
  loop
    begin
      perform carpool_revalidate_trip(v_row.trip_request_id, null, array[]::text[]);
    exception when others then
      raise warning 'expire_stale_carpool_requests: reconcile failed for trip %: %', v_row.trip_request_id, sqlerrm;
    end;
  end loop;

  -- Pass 2: expire stale PENDING requests (unchanged from 0059).
  for v_row in
    select r.id, r.organization_id, r.carpool_offer_id, o.trip_request_id, r.policy_version
      from carpool_ride_requests r
      join carpool_offers o on o.id = r.carpool_offer_id
      join trip_requests tr on tr.id = o.trip_request_id
      cross join lateral carpool_policy_for_org(r.organization_id) p
      where r.status = 'PENDING'
        and (r.created_at + make_interval(mins => p.request_expiry_minutes) < now()
             or tr.departure_at < now())
      order by r.created_at
      limit 500
  loop
    select * into v_locked from carpool_ride_requests where id = v_row.id and status = 'PENDING' for update skip locked;
    if found then
      -- DOMAIN-MIRROR rideRequest.expire: PENDING
      update carpool_ride_requests
        set status = 'EXPIRED', responded_at = now(), updated_at = now()
        where id = v_locked.id and status = 'PENDING';
      perform carpool_emit_event(v_row.organization_id, 'RideExpired', v_row.carpool_offer_id, v_row.id,
        v_row.trip_request_id, null, '{}'::jsonb);
      perform log_audit_event(v_row.organization_id, null, 'carpool_ride_expired', 'carpool_ride_request', v_row.id,
        jsonb_build_object('status', 'PENDING'),
        jsonb_build_object('status', 'EXPIRED', 'rider_id', v_locked.rider_id, 'policy_version', v_row.policy_version));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function expire_stale_carpool_requests() from public, anon, authenticated;
grant execute on function expire_stale_carpool_requests() to service_role;

-- ---------------------------------------------------------------------------
-- 2. trip_participants INSERT policy: end users can only create PENDING rows
-- ---------------------------------------------------------------------------
drop policy if exists "members join trips in own organization" on trip_participants;
create policy "members join trips in own organization" on trip_participants
  for insert with check (
    organization_id = (select current_organization_id())
    and passenger_id = (select auth.uid())
    and status = 'pending'
    and passenger_count >= 1
    and exists (
      select 1 from trip_requests tr
        where tr.id = trip_request_id
          and tr.organization_id = (select current_organization_id())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Legacy RPC grants: no PUBLIC / anon
-- ---------------------------------------------------------------------------
revoke all on function create_carpool_participation(timestamptz, timestamptz, text, text, numeric, integer, boolean, text, uuid)
  from public, anon;
revoke all on function respond_to_carpool_request(uuid, boolean) from public, anon;
grant execute on function create_carpool_participation(timestamptz, timestamptz, text, text, numeric, integer, boolean, text, uuid)
  to authenticated;
grant execute on function respond_to_carpool_request(uuid, boolean) to authenticated;
