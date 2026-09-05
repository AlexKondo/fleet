# Approved Plan — King-Fleet Run (Wave A)

Approved by user. Full analysis in `.king-fleet/issues/master-issue-registry.md`,
full proposed scope in `.king-fleet/plans/proposed-plan.md`. Wave B and Wave C are
NOT approved for this run — do not implement them without a fresh approval gate.

## Approved tasks

### TASK-017 — Double-booking: error contract + concurrency regression test
- No migration. Files: `apps/web/app/trips/new/actions.ts`,
  `supabase/tests/concurrent-reservation-race.mjs` (new).
- Map Postgres error code `23P01` (exclusion_violation) → `{ error: "RESERVATION_CONFLICT" }`.
- New test: two parallel `create_vehicle_reservation` calls on the same vehicle/overlapping
  window, assert exactly one succeeds.

### TASK-014 — Early-pickup window enforcement
- New migration (organization_settings column: grace period, configurable per org, sane
  default). Update `record_pickup` RPC to reject pickup before `start_at - grace`. Wire the
  new error through `apps/web/app/reservations/[id]/pickup/actions.ts`. Add a settings UI
  field alongside the other configurable policies in `apps/web/app/settings/SettingsForm.tsx`.
- Ruling: grace period is org-configurable (see ledger.md).

### TASK-016 — Carpool host-driver acceptance
- New migration: pending/accepted/rejected state on carpool join requests. New RPC
  `respond_to_carpool_request` restricted to the reservation's driver, re-checks capacity
  transactionally on accept. Host-facing UI to see and respond to pending requests. Reuse
  existing notification/email plumbing for both outcomes.
- Largest task — implemented last, with full context from the other two.

## Dependency graph
All three tasks touch disjoint files/tables (reservations exclusion-error handling vs.
organization_settings + record_pickup vs. trip_participants + new UI) — no blocking
dependencies between them. Sequenced for review-process reasons (see ledger.md), not because
of a technical dependency.
