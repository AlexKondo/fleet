# KING-KONDO WORKBENCH

## Mission
Close the gap between the repo's implementation and the newly-added canonical spec
(docs/instruction.md + docs/GWM_Fleet_Controlled_Engineering_Set_v1.1.zip), per the
6 concrete gaps identified in a prior review turn. Scope is these 6 items, not the
full spec (Communication Hub's automatic reassignment, a separate mobile app, Fleet
Intelligence analytics, etc. are explicitly out of scope for this pass).

## Product Contract
docs/instruction.md + the extracted engineering-set docs (zip has been deleted after
extraction; re-extract from the zip if the full doc set is needed again).

## Quality Bar
Domain-first, server-side authorization, tests for new domain logic, typecheck/test
clean across the workspace, independent blind-critic pass on new SQL/authz before
declaring done.

## Workstreams (this pass)

### A — Mandatory photo evidence on damage (BR-013/ADR-004)
Status: DONE. Gap: photos were optional even when hasDamage=true (contradicted the
ADR). Fix: client-side pre-submit block + server-side `damageEvidenceMissing` signal
that keeps the user on the pickup/return screen (no "skip" escape) until the damage
photo actually uploads.
Files: apps/web/app/reservations/[id]/pickup/{actions.ts,PickupForm.tsx},
apps/web/app/reservations/[id]/return/{actions.ts,ReturnForm.tsx}.
Verified by: typecheck clean. Known residual risk: enforced at the Next.js server
action layer, not inside the RPC itself — a direct RPC/PostgREST caller bypassing the
app could still create a damage inspection with no photo. Documented in code comments.

### B — Driver authorization / CNH validity (BR-004/GT-011)
Status: DONE. Gap: no CNH/license concept existed anywhere; nothing blocked an
unauthorized or expired-license driver from checking out a vehicle.
Files: supabase/migrations/0014_driver_authorization.sql (profiles columns +
record_pickup guard), apps/web/app/settings/users/{actions.ts,UserRow.tsx,page.tsx}
(admin UI to set authorization/license), apps/web/app/reservations/[id]/pickup/actions.ts
(friendly PT-BR error mapping).
Verified by: typecheck clean; blind-critic review in progress (see Evidence).

### C — Audit trail (AUDIT_TRAIL.md)
Status: DONE. Gap: no dedicated append-only audit table existed.
Files: supabase/migrations/0015_audit_trail.sql (audit_log table, RLS read-only for
fleet_manager/administrator, log_audit_event() RPC, instruments 7 existing RPCs),
apps/web/app/settings/users/actions.ts + apps/web/app/settings/actions.ts (app-layer
calls for the 5 actions that have no RPC of their own: invite/role-change/remove/
driver-authorization/org-settings).
Verified by: typecheck clean; blind-critic review in progress.
Known gap (not done): no dedicated UI page to browse the audit log yet — only the
underlying table + RLS exist. Flagged to the user, not silently skipped.

### D — Configuration catalog additions
Status: PARTIAL, folded into E. Most CONFIGURATION_CATALOG.md keys already existed
(range safety buffer, carpool tolerances, maintenance due-soon, traffic-restriction
toggle) with a working /settings UI before this pass. Added: booking_mode (needed by
E). Deliberately NOT added: PHOTO_REQUIRED_FOR_EXTERNAL_DAMAGE (kept as a fixed rule
per ADR-004's plain "mandatory" language, not a toggle a fleet_manager could weaken),
APPROVAL_REQUIRED, NO_SHOW_TOLERANCE_MINUTES, RETURN_GRACE_PERIOD_MINUTES,
CLEANING_BLOCKS_VEHICLE, LOW_FUEL/BATTERY_THRESHOLD_PERCENT, notification toggles —
none of these block another workstream, so out of scope for this pass.

### E — Configurable booking mode (BR-005/PB-003/ADR-006)
Status: DONE. Gap: system always auto-picked exactly one vehicle; no USER_CHOICE/
HYBRID mode existed.
Files: supabase/migrations/0016_booking_mode.sql, packages/domain/src/mobility-engine/
recommend.ts (new `rankedEligible` field + 2 new tests), apps/web/lib/domain/orgConfig.ts,
apps/web/app/settings/{actions.ts,SettingsForm.tsx,page.tsx}, apps/web/app/trips/new/
{actions.ts,TripRequestForm.tsx}.
Verified by: 87 domain tests pass (2 new), typecheck clean, blind-critic review in
progress for confirmTrip's server-side re-validation of the client's chosen vehicle.

### F — Communication Hub + delay impact analysis (COMMUNICATION_HUB.md/DV-004, BR-019/GT-007)
Status: DONE (detection + notification only — see scope note below).
Gap: no messaging feature existed at all; no way to represent "impacted by delay."
Files: supabase/migrations/0017_communication_hub.sql (reservation_messages table,
reservations.impacted_at/impacted_reason, post_reservation_message() RPC),
apps/web/app/reservations/[id]/{page.tsx,MessageThread.tsx,actions.ts} (new
Reservation Detail + Communication Hub screen), apps/web/lib/domain/messages.ts,
links added from apps/web/app/trips/page.tsx and apps/web/app/dashboard/page.tsx.
Deliberate scope cut: implements delay DETECTION (mark next reservation impacted) +
NOTIFICATION, not automatic REASSIGNMENT ("search alternative" in BR-019/J-07) — a
fleet_manager still reassigns manually via the pre-existing swap_reservation_vehicle.
Also deliberately did NOT move reservations.end_at (the field backing the
double-booking EXCLUDE constraint) — impacted is a new orthogonal column instead of a
reservation_status value, to avoid touching that constraint.
Verified by: typecheck clean, blind-critic review in progress.

## Evidence
- `pnpm --filter web exec tsc --noEmit` — clean, run after each workstream.
- `pnpm -w typecheck` — clean (all 3 packages).
- `pnpm -w test -- --run` — 87/87 passing in @fleet/domain (2 new tests for
  rankedEligible in recommend.test.ts).
- Blind-critic subagent round 1 (SQL 0014-0017 + confirmTrip re-validation +
  reservation-messages authz): found 1 P0 + 1 P1 + 1 P2, both repaired in place
  (migrations not yet applied to any DB) — see Failed Gates / Decisions.
  Everything else it checked (confirmTrip's server-side re-derivation, the
  reservations/[id] authz gate, updateDriverAuthorization's org re-scoping,
  admin.ts's type-only change, 0016, lock ordering in the 7 instrumented RPCs) came
  back clean.
- Blind-critic subagent round 2 (fresh, verifying the round-1 repairs specifically):
  dispatched, result pending as of this ledger entry. Must come back clean (or any
  new finding resolved) before pushing migrations to the live database.

## Failed Gates (round 1, now repaired — see round 2 for verification)
- P0: `log_audit_event` (0015) was callable directly by any `authenticated` user with
  forged `p_organization_id`/`p_actor_id`, since it trusted both blindly and is
  granted to `authenticated` (not just `service_role`). Fix: added a guard — when
  `auth.uid()` is non-null (a real user session, as opposed to a service-role call),
  require `p_actor_id = auth.uid()` and `p_organization_id = current_organization_id()`.
- P1: `post_reservation_message`'s (0017) delay-impact loop had no lower time bound
  tied to the source reservation, so a delay reported on one reservation could mark
  an unrelated earlier/in-progress reservation on the same vehicle as impacted and
  notify the wrong driver. Fix: added `v_source_end_at` (the source reservation's own
  `end_at`) as a `r2.start_at >= v_source_end_at` lower bound.
- P2: same loop was missing an `organization_id` filter (defense-in-depth,
  inconsistent with this file's own established convention). Fix: added
  `r2.organization_id = v_org_id`.

## Decisions
- Kept the existing reservation_status enum (4 values) unchanged rather than adding
  an IMPACTED state, to avoid touching the double-booking EXCLUDE constraint — used a
  separate impacted_at/impacted_reason column pair instead.
- Kept mandatory-photo-on-damage as a fixed rule, not a new configuration-catalog
  toggle, since ADR-004's text is unconditional ("mandatory... when external damage is
  identified") — treated as a product decision, not an operational threshold.
- Driver-authorization admin UI lives on the existing administrator-only
  /settings/users page rather than opening it to fleet_manager, for consistency with
  that page's existing single-gate design (documented reasoning already in that file).

## Assumptions
- ASSUMPTION: "the driver" for BR-004's CNH check is the reservation's trip-request
  requester (trip_requests.requester_id), not necessarily whoever physically performs
  the record_pickup call (e.g. security may check a traveler out on their behalf).
  Why: matches how the rest of the schema models trips (no separate "driver" entity).
  Risk if wrong: if a future feature lets someone other than the requester actually
  drive, this check would need to move to whoever is declared as driving that specific
  trip instead.

## Risks (residual, documented in code comments too)
- Mandatory-photo-on-damage (A) and the audit trail (C) are enforced at the Next.js
  server-action layer, not inside the RPCs themselves — a direct PostgREST/RPC caller
  bypassing the app UI could skip both. Consistent with this codebase's existing
  security model (RLS is the hard boundary; the app layer adds UX-level guarantees on
  top), not a regression.
- Delay-impact detection (F) does not automatically reassign — a fleet_manager must
  act on the notification manually.

## Human Gates
- None required yet for this pass — no destructive/irreversible action, no
  production push has happened as of this ledger entry.
- Applying migrations 0014-0017 to the live Supabase database and deploying to
  production IS the next step and WILL be confirmed with the user first (per this
  session's own operating rules — direct DB/deploy actions against the user's live
  project always get a heads-up), not silently auto-run.

## Remaining Work
1. Resolve the blind-critic review (fix any P0/P1, or adjudicate).
2. Apply migrations 0014-0017 to the Supabase project (`supabase db push` or
   equivalent), confirmed with the user first.
3. Regenerate/verify database.types.ts against the live schema after push (it was
   hand-edited to match the migrations; worth a diff against `supabase gen types`
   once applied, if time allows).
4. Deploy apps/web to Vercel.
5. Report to the user: what shipped, the deliberate scope cuts (D's remaining keys,
   F's no-auto-reassignment, no audit-log browsing UI yet), and the one open
   assumption above.
