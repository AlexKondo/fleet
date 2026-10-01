-- FleetMind Smart Carpool - Phase C7 (privacy): least-privilege READ access to journey + PII data.
--
-- PROBLEM (pre-dates carpool, proven live by supabase/tests/privacy-matrix.mjs --phase before):
-- every authenticated member of an organization could read, over PostgREST, ALL org trip_requests
-- (origin, destination, times, justification, requester), ALL reservations, ALL trip_participants,
-- ALL carpool_offers and ALL profiles including drivers_license_number/category/expiration and the
-- reminder timestamps. Pack 06: "no directory of employee movements; no exposure of incompatible
-- journeys; minimize exact personal route disclosure".
--
-- DESIGN (policies run as the caller; RLS cannot hide columns, all clients share `authenticated`):
--   * trip_requests / reservations: own rows + rows the user legitimately participates in
--     (trip_participants pending/accepted, or a PENDING/ACCEPTED carpool_ride_request on that host
--     trip) + org-wide for fleet_manager / administrator / security (gate worklist). maintenance_operator
--     and plain employees get NO org-wide trip data.
--   * trip_participants: the passenger's own rows, rows on trips the user hosts, org-wide for
--     fleet_manager / administrator / security.
--   * carpool_offers: the host's offers, offers the user has a ride request on, org-wide for
--     fleet_manager / administrator. (The matching search reads other people's offers with the
--     service role after authenticating the caller; see apps/web/app/carpool/actions.ts.)
--   * profiles: own row; fleet_manager / administrator rows (approvers - every employee-triggered
--     invoker function that notifies managers needs them, and message senders); everything for
--     fleet_manager / administrator / security / maintenance_operator (names only: license columns are
--     revoked below); and ONLY the names of people the user is legitimately related to (host of a trip
--     joined, riders/passengers of own offers/trips, senders in threads of own reservations).
--   * license columns (number, category, expiration, driver_authorized, reminder timestamps): SELECT is
--     revoked from `authenticated` at COLUMN level. Legitimate readers use SECURITY DEFINER functions:
--     get_my_license() (own row), list_member_licenses() (role-checked: fleet_manager/administrator).
--     Writes already go through the service role (no UPDATE policy exists), unchanged.
--   * get_vehicle_busy_windows(): org-wide (vehicle_id, start_at, end_at, status) with NO personal data,
--     so availability / recommendation code keeps working for employees who can no longer read other
--     reservations.
--   * inspections (performed_by + reservation + vehicle + time = who used which car when): readable by
--     fleet_manager / administrator / security / maintenance_operator, or by the person who performed it.
--   * anon: table privileges revoked on the journey/PII tables (RLS already returned nothing; this is
--     defence in depth, so a future permissive policy cannot silently expose them).
--   Vehicles (plate, status, location, category) stay org-readable: they are shared fleet assets, not
--   personal data, and the booking/recommendation UI needs them for every role.
--
-- Rollback: supabase/migrations/rollback/0063_rollback.sql (not auto-applied).
--
-- Overload/grant discipline: every function below is NEW (no existing name/signature is replaced).
-- Helper functions used inside policies must be EXECUTE-able by `authenticated` (policies are
-- evaluated with the caller's privileges); they take no arguments and answer only for auth.uid(), so
-- calling them over RPC reveals nothing the caller could not already read. They are revoked from
-- anon / PUBLIC. The license/busy-window functions are revoked from anon and PUBLIC too.

-- ---------------------------------------------------------------------------------------------
-- helpers (SECURITY DEFINER so policies never recurse into each other's RLS)

create function public.current_user_role()
returns user_role
language sql stable security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create function public.rls_visible_trip_request_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.trip_requests where requester_id = auth.uid()
  union
  select trip_request_id from public.trip_participants
    where passenger_id = auth.uid() and status in ('pending', 'accepted')
  union
  select o.trip_request_id
    from public.carpool_ride_requests rr
    join public.carpool_offers o on o.id = rr.carpool_offer_id
    where rr.rider_id = auth.uid() and rr.status in ('PENDING', 'ACCEPTED')
$$;

create function public.rls_hosted_trip_request_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$ select id from public.trip_requests where requester_id = auth.uid() $$;

create function public.rls_requested_offer_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$ select carpool_offer_id from public.carpool_ride_requests where rider_id = auth.uid() $$;

create function public.rls_related_profile_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  -- host of a trip I joined / requested a seat on (live requests only)
  select tr.requester_id
    from public.trip_participants tp
    join public.trip_requests tr on tr.id = tp.trip_request_id
    where tp.passenger_id = auth.uid() and tp.status in ('pending', 'accepted')
  union
  select o.host_id
    from public.carpool_ride_requests rr
    join public.carpool_offers o on o.id = rr.carpool_offer_id
    where rr.rider_id = auth.uid() and rr.status in ('PENDING', 'ACCEPTED')
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

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.rls_visible_trip_request_ids() from public, anon;
revoke all on function public.rls_hosted_trip_request_ids() from public, anon;
revoke all on function public.rls_requested_offer_ids() from public, anon;
revoke all on function public.rls_related_profile_ids() from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.rls_visible_trip_request_ids() to authenticated;
grant execute on function public.rls_hosted_trip_request_ids() to authenticated;
grant execute on function public.rls_requested_offer_ids() to authenticated;
grant execute on function public.rls_related_profile_ids() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- policies (the manager ALL policies on trip_requests / reservations stay as they are)

drop policy if exists "members read own organization trip requests" on public.trip_requests;
create policy "members read own and related trip requests" on public.trip_requests
  for select using (
    organization_id = (select current_organization_id())
    and (
      requester_id = (select auth.uid())
      or (select current_user_role()) in ('fleet_manager', 'administrator', 'security')
      or id in (select rls_visible_trip_request_ids())
    )
  );

drop policy if exists "members read own organization reservations" on public.reservations;
create policy "members read own and related reservations" on public.reservations
  for select using (
    organization_id = (select current_organization_id())
    and (
      (select current_user_role()) in ('fleet_manager', 'administrator', 'security')
      or trip_request_id in (select rls_visible_trip_request_ids())
    )
  );

drop policy if exists "members read own organization trip participants" on public.trip_participants;
create policy "members read own and hosted trip participants" on public.trip_participants
  for select using (
    organization_id = (select current_organization_id())
    and (
      passenger_id = (select auth.uid())
      or (select current_user_role()) in ('fleet_manager', 'administrator', 'security')
      or trip_request_id in (select rls_hosted_trip_request_ids())
    )
  );

drop policy if exists "members read own organization carpool offers" on public.carpool_offers;
create policy "hosts requesters and managers read carpool offers" on public.carpool_offers
  for select using (
    organization_id = (select current_organization_id())
    and (
      host_id = (select auth.uid())
      or (select current_user_role()) in ('fleet_manager', 'administrator')
      or id in (select rls_requested_offer_ids())
    )
  );

drop policy if exists "members read profiles in own organization" on public.profiles;
create policy "members read own related and staff profiles" on public.profiles
  for select using (
    organization_id = (select current_organization_id())
    and (
      id = (select auth.uid())
      or role in ('fleet_manager', 'administrator')
      or (select current_user_role()) in ('fleet_manager', 'administrator', 'security', 'maintenance_operator')
      or id in (select rls_related_profile_ids())
    )
  );

drop policy if exists "members read own organization inspections" on public.inspections;
create policy "staff and performer read inspections" on public.inspections
  for select using (
    organization_id = (select current_organization_id())
    and (
      performed_by = (select auth.uid())
      or (select current_user_role()) in ('fleet_manager', 'administrator', 'security', 'maintenance_operator')
    )
  );

-- ---------------------------------------------------------------------------------------------
-- PII columns: column-level SELECT revoke. (A table-level grant cannot be partially revoked, so the
-- table-level SELECT is removed and the non-sensitive columns are granted back explicitly. Any NEW
-- profiles column must be granted deliberately - fail-closed. `select=*` through PostgREST by a
-- user JWT therefore errors (42501); the app never uses it on profiles.)

revoke select on public.profiles from authenticated;
grant select (id, organization_id, full_name, role, created_at, avatar_url, gantt_zoom_preference)
  on public.profiles to authenticated;

-- anon never needs these tables (login/signup use the auth API and the service role)
revoke all on public.profiles from anon;
revoke all on public.trip_requests from anon;
revoke all on public.reservations from anon;
revoke all on public.trip_participants from anon;
revoke all on public.reservation_messages from anon;
revoke all on public.notifications from anon;
revoke all on public.inspections from anon;

-- ---------------------------------------------------------------------------------------------
-- legitimate readers of the revoked columns

create function public.get_my_license()
returns table (
  drivers_license_number text,
  drivers_license_category text,
  drivers_license_expiration date,
  driver_authorized boolean
)
language sql stable security definer
set search_path = public
as $$
  select p.drivers_license_number, p.drivers_license_category, p.drivers_license_expiration, p.driver_authorized
    from public.profiles p where p.id = auth.uid()
$$;

create function public.list_member_licenses()
returns table (
  id uuid,
  drivers_license_number text,
  drivers_license_category text,
  drivers_license_expiration date,
  driver_authorized boolean
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_user_role() not in ('fleet_manager', 'administrator') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select p.id, p.drivers_license_number, p.drivers_license_category, p.drivers_license_expiration, p.driver_authorized
      from public.profiles p
      where p.organization_id = public.current_organization_id();
end;
$$;

-- Org-wide "vehicle busy windows": NO requester / route / justification, just what availability needs.
create function public.get_vehicle_busy_windows(p_from timestamptz default now())
returns table (vehicle_id uuid, start_at timestamptz, end_at timestamptz, status reservation_status)
language sql stable security definer
set search_path = public
as $$
  select r.vehicle_id, r.start_at, r.end_at, r.status
    from public.reservations r
    where r.organization_id = public.current_organization_id()
      and r.status in ('pending_approval', 'confirmed')
      and r.end_at > p_from
$$;

revoke all on function public.get_my_license() from public, anon;
revoke all on function public.list_member_licenses() from public, anon;
revoke all on function public.get_vehicle_busy_windows(timestamptz) from public, anon;
grant execute on function public.get_my_license() to authenticated;
grant execute on function public.list_member_licenses() to authenticated;
grant execute on function public.get_vehicle_busy_windows(timestamptz) to authenticated;
