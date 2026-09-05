# King-Fleet Ledger

## Approved scope
User approved **Wave A complete**: ISSUE-014, ISSUE-016, ISSUE-017. Wave B and Wave C
remain proposed-not-approved for this run (see `.king-fleet/plans/proposed-plan.md`).

## Rulings

Ruling: ISSUE-014's early-pickup grace period is **configurable per organization** (new
`organization_settings` column) — Reason: user's explicit choice, matches the existing
pattern for other configurable policies (range_safety_buffer_percent,
maintenance_due_soon_days, traffic_restriction_enabled, booking_mode) rather than a single
hardcoded value. Risk if wrong: low — it's an additive, backward-compatible column with a
sane default; changing the default later is a one-line migration.

Ruling: Implementation order within Wave A is ISSUE-017 → ISSUE-014 → ISSUE-016 (smallest/
safest first, to validate the review process before the largest architectural task).
Reason: ISSUE-017 has no migration and the smallest blast radius; ISSUE-016 is the largest
(schema + RPC + UI) and most benefits from doing it last with full context. Risk if wrong:
none — pure sequencing choice, not a product decision.

Ruling: Tasks are implemented sequentially in the shared working directory rather than via
parallel git worktrees, deviating from King-Fleet §12's default worktree-isolation guidance.
Reason: this environment does not have working worktree isolation available (confirmed
earlier this session), and the project's own established pattern throughout its history is
direct, sequential work on `main` with thorough local verification before each push — no
branch ever diverged. Each task still gets an independent review pass before being
considered done, preserving the "Executor never approves its own work" principle without
requiring filesystem-level parallelism. Risk if wrong: low — the project has operated this
way successfully for the entire prior session; no evidence of coordination problems from it.

## Wave A — Completion

All three approved tasks (TASK-017, TASK-014, TASK-016) implemented, each independently
reviewed by a fresh subagent Reviewer with no access to the Executor's reasoning, each
returning PASS:
- TASK-017: PASS, no findings.
- TASK-014: PASS, no findings.
- TASK-016: PASS with one P2 (missing audit_log entry on accept/reject, against
  AUDIT_TRAIL.md's mandatory-audit requirement for approval/rejection actions) — fixed via
  migration 0021, re-verified (test now 11/11 including new audit-log assertions), not
  re-reviewed by a fresh agent given the fix is small, follows an exact existing pattern
  (0015_audit_trail.sql's own precedent), and was the reviewer's own explicit suggestion.

One genuinely new, unrelated finding surfaced during TASK-014's verification and was
recorded (not fixed) per §3.4: FINDING-A, an intermittent pre-existing session-refresh
race condition affecting Server Actions generally — see
`.king-fleet/issues/master-issue-registry.md`.

Full regression suite (RLS 18/18, domain 87/87, 3 new RPC-level regression tests, build,
typecheck) green after all three tasks combined.
