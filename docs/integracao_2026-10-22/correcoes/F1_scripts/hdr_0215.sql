-- 0215 (CORRECOES F1 / S1-02, S1-04, S1-05, S1-06): ONE check decides whether a vehicle may go back to use.
--
-- Problem: every routine had its own idea of "safe". fm_operation_exception (0211), fm_release_expired_reservations (0213) and
-- the gate departure (DEPARTURE_BLOCKED) refuse damage / invalid documentation / missing safety equipment / running work orders,
-- but cancel_reservation (S1-04), the key-custody key delivery + digital pickup (S1-05) and complete/cancel_workflow_task (S1-06)
-- did not, and 0213 left an unsafe vehicle 'reserved' with no active reservation (S1-02). complete/cancel_workflow_task also
-- cleared has_blocking_damage outside the audited 0205 path (no independent-actor rule).
--
-- Fix (bodies taken from pg_get_functiondef on a database at 0214, minimal logical diff; signatures, ACL, search_path kept):
--   * fm_vehicle_unsafe_reason(vehicle, closing_task) -> null when safe, else archived | documentation | work_order | damage |
--     safety_equipment (| not_found). Same conditions as 0211/0213/DEPARTURE_BLOCKED: archived, documentation_valid=false,
--     work order in_progress/partial or scheduled with its window open now (0213), has_blocking_damage, missing safety
--     equipment. p_closing_task_id ignores the work order whose own task is being closed (work_order.completed calls
--     complete_workflow_task before it flips the order to completed).
--   * fm_vehicle_unsafe_status(...) -> null when safe, else the 0211 mapping: archived/documentation -> blocked;
--     work order / damage / missing equipment -> maintenance.
--   Both: SECURITY DEFINER, STABLE, internal (no EXECUTE for PUBLIC/anon/authenticated; service_role only).
--   * fm_release_expired_reservations (S1-02): the no-other-confirmed branch writes coalesce(unsafe_status,'available') instead of
--     leaving the old 'reserved'/'awaiting_pickup'. Audit after.vehicle_status = the real new status. A vehicle with another
--     confirmed reservation keeps its status (unchanged rule). Return shape unchanged (vehicles_released counts -> available).
--   * cancel_reservation (S1-04): same coalesce in the no-other-confirmed branch.
--   * fm_key_command 'delivered' (S1-05): VEHICLE_NOT_READY (code already used there) also when the single check fails.
--   * record_pickup, key_custody branch (S1-05): a NEW digital pickup (= office departure) of an unsafe vehicle raises
--     DEPARTURE_BLOCKED (same code as the physical gate). Exact retries of a recorded pickup are untouched (idempotent).
--   * complete_workflow_task / cancel_workflow_task (S1-06): final branch writes coalesce(unsafe_status,'available') and no longer
--     touches has_blocking_damage.
--   * fm_release_damage_hold (0205): for source 'workflow_task' (repair task -> done trigger) the early return for
--     maintenance/cleaning/charging vehicles is removed, so the audited release (pending repair/incident checks + independent
--     actor rule DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED + vehicle.damage_hold_released audit) is the only place the flag is
--     cleared; the status is kept and complete_workflow_task decides it right after. Incident source unchanged.
-- Locks: no new lock. Every caller already holds the vehicle row (0194 order: vehicle before reservation/task); the helpers only
-- read vehicles / fm_work_orders.
-- Classification: EXPAND for the helpers (new, internal). The six routines are narrowed only for unsafe vehicles (the defect
-- itself); no grant/ACL/signature change, compatible with the deployed app (0aa2403) and with the new code (same RPC names and
-- arguments; the error codes are existing ones: VEHICLE_NOT_READY, DEPARTURE_BLOCKED, DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED).
-- Order in production: after 0205, 0210, 0211, 0213 (redefines their latest bodies); independent of 0212/0214/0216.
-- Rollback: supabase/migrations/rollback/0215_rollback.sql (restores the previous bodies, drops the helpers).

create or replace function public.fm_vehicle_unsafe_reason(p_vehicle_id uuid, p_closing_task_id uuid default null)
 returns text
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $function$
 select case
  when v.id is null then 'not_found'
  when v.archived_at is not null then 'archived'
  when not v.documentation_valid then 'documentation'
  when exists(select 1 from fm_work_orders o
               where o.vehicle_id = v.id and o.organization_id = v.organization_id
                 and (p_closing_task_id is null or o.workflow_task_id is distinct from p_closing_task_id)
                 and (o.status in ('in_progress','partial')
                      or (o.status = 'scheduled' and o.scheduled_start <= now() and o.scheduled_end > now()))) then 'work_order'
  when v.has_blocking_damage then 'damage'
  when coalesce(cardinality(v.missing_safety_equipment), 0) > 0 then 'safety_equipment'
 end
 from (select 1) one
 left join vehicles v on v.id = p_vehicle_id;
$function$;

create or replace function public.fm_vehicle_unsafe_status(p_vehicle_id uuid, p_closing_task_id uuid default null)
 returns public.vehicle_status
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $function$
 select case public.fm_vehicle_unsafe_reason(p_vehicle_id, p_closing_task_id)
  when 'archived' then 'blocked'::public.vehicle_status
  when 'documentation' then 'blocked'::public.vehicle_status
  when 'not_found' then 'blocked'::public.vehicle_status
  when 'work_order' then 'maintenance'::public.vehicle_status
  when 'damage' then 'maintenance'::public.vehicle_status
  when 'safety_equipment' then 'maintenance'::public.vehicle_status
 end;
$function$;

revoke all on function public.fm_vehicle_unsafe_reason(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fm_vehicle_unsafe_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fm_vehicle_unsafe_reason(uuid, uuid) to service_role;
grant execute on function public.fm_vehicle_unsafe_status(uuid, uuid) to service_role;

