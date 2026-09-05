# Final Engineering Report — King-Fleet Wave A

## Final status
COMPLETE. Chief Reviewer PASS, Completion Audit PASS.

## Approved scope
Wave A ("Integrity & Safety") of the MVP Remediation Pack v1.0's 17-issue register:
ISSUE-014, ISSUE-016, ISSUE-017. Wave B (7 issues) and Wave C (4 issues) were analyzed and
documented but not approved for this run.

## Delivered scope
- **ISSUE-017** — double-booking's DB-level protection (a real Postgres EXCLUDE
  constraint) was already sound; added a stable `RESERVATION_CONFLICT` application error
  code (mapped from Postgres error 23P01) plus a friendly UI message, and a new
  RPC-level concurrency regression test proving exactly one of two simultaneous booking
  attempts on the same vehicle/window wins.
- **ISSUE-014** — `record_pickup` previously only checked vehicle status, never the
  reservation's own scheduled `start_at`; a reservation for hours from now could be
  picked up immediately. Added an organization-configurable grace window
  (`early_pickup_grace_minutes`, default 15) enforced server-side, wired through the
  settings UI, and a new regression test covering both the blocked and allowed cases.
- **ISSUE-016** — carpool prioritization already worked; the host-driver acceptance step
  was entirely missing (any join request auto-accepted with zero say from the driver).
  Added pending/accepted/rejected status to `trip_participants`, a host-only
  accept/reject RPC (capacity re-checked at accept time, row-locked against a
  double-accept race, rejected requests deleted per the existing leave-carpool
  precedent, both outcomes notify the passenger and are now audit-logged), host-facing
  UI on the reservation detail page, and passenger-facing pending/accepted status on
  their trips list.

## Deferred scope
Wave B (ISSUE-001 HEV powertrain, ISSUE-003 electric range + server validation,
ISSUE-007 site-scoped locations, ISSUE-008 CNH evidence/OCR, ISSUE-010 equipment
checklist model config) and Wave C (ISSUE-002 fuel bands, ISSUE-005 reassignment
identification, ISSUE-006 vehicle color, ISSUE-012 checklist identity) — fully analyzed
with file:line evidence and proposed fix approaches in
`.king-fleet/issues/master-issue-registry.md`, awaiting a fresh approval gate.

## Architecture / database
3 new migrations (0019, 0020, 0021), additive only — no destructive schema changes, no
existing organization's observed behavior changed by any of them (each has a
backward-compatible default). `packages/supabase-client/src/database.types.ts`
regenerated to match.

## Tests
3 new real RPC-level regression tests (`concurrent-reservation-race.mjs`,
`early-pickup-window.mjs`, `carpool-host-acceptance.mjs`), all run multiple times for
stability, plus a fresh full run (from a clean `supabase db reset`) by the independent
Chief Reviewer. Existing suites unaffected: cross-tenant RLS 18/18, domain unit tests
87/87, typecheck clean, production build clean.

## Security / audit
Carpool accept/reject is now covered by `log_audit_event` (added after the task-level
Reviewer flagged its absence against `AUDIT_TRAIL.md`'s mandatory-audit requirement for
approval/rejection actions) — the only correctness/compliance finding across all four
review passes (3 task-level + 1 Chief Review), fixed and re-verified before closing.

## Known limitations / technical debt
- **FINDING-A** (new, discovered during TASK-014 verification, unrelated to any
  approved issue): an intermittent, pre-existing race condition where a Server Action's
  and middleware's independently-constructed Supabase clients can each attempt a session
  token refresh within the same request cycle; under refresh-token rotation, one success
  + one failure can clear a valid session, occasionally bouncing an authenticated user to
  `/login` on form submit. Reproduced and root-caused via direct instrumentation
  (removed before commit); not fixed here — it's architectural (affects every Server
  Action in the app, not something this round's scope covers) and needs its own
  dedicated investigation and approval gate. Full detail in
  `.king-fleet/issues/master-issue-registry.md`.
- The 4 migrations from an earlier round (0012, 0013, 0017, 0018) that were previously
  found unapplied to the production database remain unapplied — unrelated to this round,
  the user has not yet confirmed applying them.
- Wave B/C issues (8 real gaps) remain open, prioritized and ready for a future round.

## Deployment instructions
Standard: `supabase db push` (or apply migrations 0019-0021 manually) against the target
project, then redeploy the application. No manual data backfill required — all three
migrations use safe, backward-compatible defaults.

## Rollback instructions
Each migration is additive (new columns/functions only); rolling back would mean
dropping the three new columns (`organization_settings.early_pickup_grace_minutes`,
`trip_participants.status`) and reverting `record_pickup`/`create_carpool_participation`
to their pre-0019/0020 bodies, plus reverting the application code in commit `2d7176b`.
No data migration/backfill was performed that would need un-doing.

## Seed / demo instructions
No seed data changes. Existing demo accounts (`gestor@gwm-demo.local`,
`colaborador@gwm-demo.local`, `portaria@gwm-demo.local`) exercise all three new flows
correctly (used directly by the new regression tests).

## Required environment configuration
None new. No new environment variables introduced.

## Recommended post-round roadmap
1. Confirm/apply the four still-pending migrations from the prior round (0012/0013/0017/0018).
2. Decide and schedule Wave B (domain/core gaps — HEV, electric range validation,
   site-scoped locations, CNH evidence, equipment model config) and/or Wave C (UX/data
   refinement) as a fresh King-Fleet approval cycle.
3. Schedule a dedicated investigation of FINDING-A's session-refresh race — likely fix
   shape: a single shared Supabase client per request (passed through rather than
   independently reconstructed by middleware and each Server Action), or a
   refresh-token-rotation reconfiguration; needs its own root-cause-first investigation
   given the architectural nature of the change.
