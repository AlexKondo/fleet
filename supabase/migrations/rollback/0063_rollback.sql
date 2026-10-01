-- Rollback for 0063_privacy_least_privilege_reads.sql (NOT auto-applied; run manually via the
-- Supabase Management API / SQL editor). Restores the pre-0063 org-wide read policies and grants.
-- WARNING: this re-opens the coworker journey / license exposure. App code from Phase C7 that calls
-- get_my_license / list_member_licenses / get_vehicle_busy_windows must be rolled back first (or keep
-- those three functions - they are harmless without the policies; only the DROP FUNCTION lines at the
-- bottom remove them).

drop policy if exists "members read own and related trip requests" on public.trip_requests;
create policy "members read own organization trip requests" on public.trip_requests
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "members read own and related reservations" on public.reservations;
create policy "members read own organization reservations" on public.reservations
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "members read own and hosted trip participants" on public.trip_participants;
create policy "members read own organization trip participants" on public.trip_participants
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "hosts requesters and managers read carpool offers" on public.carpool_offers;
create policy "members read own organization carpool offers" on public.carpool_offers
  for select using (organization_id = current_organization_id());

drop policy if exists "members read own related and staff profiles" on public.profiles;
create policy "members read profiles in own organization" on public.profiles
  for select using (organization_id = (select current_organization_id()));

drop policy if exists "staff and performer read inspections" on public.inspections;
create policy "members read own organization inspections" on public.inspections
  for select using (organization_id = (select current_organization_id()));

-- table-level SELECT back for authenticated (column grants become redundant)
grant select on public.profiles to authenticated;

-- anon grants as Supabase's default privileges had them
grant select, insert, update, delete, truncate, references, trigger on public.profiles to anon;
grant select, insert, update, delete, truncate, references, trigger on public.trip_requests to anon;
grant select, insert, update, delete, truncate, references, trigger on public.reservations to anon;
grant select, insert, update, delete, truncate, references, trigger on public.trip_participants to anon;
grant select, insert, update, delete, truncate, references, trigger on public.reservation_messages to anon;
grant select, insert, update, delete, truncate, references, trigger on public.notifications to anon;
grant select, insert, update, delete, truncate, references, trigger on public.inspections to anon;

drop function if exists public.get_vehicle_busy_windows(timestamptz);
drop function if exists public.list_member_licenses();
drop function if exists public.get_my_license();
drop function if exists public.rls_related_profile_ids();
drop function if exists public.rls_requested_offer_ids();
drop function if exists public.rls_hosted_trip_request_ids();
drop function if exists public.rls_visible_trip_request_ids();
drop function if exists public.current_user_role();
