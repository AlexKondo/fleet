-- PENDING migration (TIGHTENING) - security fix found during the C7b RBAC audit. Rollback:
-- supabase/migrations-pending/rollback/0068_rollback.sql.
--
-- FINDING (Critical, pre-existing, not carpool-related): Supabase grants EXECUTE on every new public function to
-- anon and authenticated, and several SECURITY DEFINER "internal" functions were never revoked:
--   update_member_role(org, user, role)   - NO authorization check: ANY signed-in employee (or even a caller holding
--                                           only the public anon key) could promote themselves / anyone to
--                                           administrator or demote the real administrators (proved by the
--                                           preflight simulation, see supabase/tests/preflight-role-simulation.mjs).
--   lock_and_require_multiple_administrators(org) - row-locks all administrators of any organization (DoS).
--   auto_reassign_reservation_vehicle(org, reservation, vehicle) - swaps the vehicle of ANY reservation of ANY
--                                           organization when the ids are known.
--   log_audit_event(...)                  - its caller-matching guard is skipped when auth.uid() is null, so an
--                                           ANON caller could append forged audit_log rows for any org / actor.
--   rls_auto_enable()                     - event-trigger function, must never be callable.
-- The app calls the first three ONLY through the service-role admin client (apps/web/app/settings/users/actions.ts,
-- apps/web/lib/domain/autoReassignment.ts), so they become service_role-only. log_audit_event keeps `authenticated`
-- (apps/web/app/settings/actions.ts uses the user client; its guard still forces actor/org = the caller) and loses
-- `anon`. Every user-facing RPC additionally loses `anon` (no unauthenticated flow calls any RPC: login, signup,
-- forgot/reset password use the Auth API and the service role only).
-- Backward compatible with the deployed code (86dc094): no deployed code path calls these as anon, nor the first
-- three as a user.

do $$
declare r record;
begin
  -- internal: service_role only
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('update_member_role', 'lock_and_require_multiple_administrators', 'auto_reassign_reservation_vehicle', 'rls_auto_enable')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;

  -- audit logger: authenticated keeps it (own actor/org enforced inside), anon loses it
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'log_audit_event'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  -- user-facing RPCs: signed-in users only
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('approve_reservation', 'block_vehicle', 'unblock_vehicle', 'cancel_reservation', 'cancel_workflow_task',
                        'complete_workflow_task', 'create_vehicle_reservation', 'post_reservation_message', 'record_pickup',
                        'record_return', 'swap_reservation_vehicle', 'transfer_reservation', 'create_carpool_participation',
                        'respond_to_carpool_request')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
