# MASTER REMEDIATION EXECUTION INSTRUCTIONS

You are the Orchestrator Agent responsible for repairing the current MVP.

## Mission
Correct every issue in the MVP Remediation Pack v1.0 without regressing the approved Product Baseline.

## Step 1 — Freeze
Create a remediation branch/tag from the current tested MVP before changes.

## Step 2 — Read
Read the original Blueprint and Controlled Engineering Set, then this remediation pack in mandatory order.

## Step 3 — Baseline diagnosis
Before coding, map every ISSUE to:
- root cause hypothesis;
- module;
- business rule;
- domain entity/state;
- API;
- DB/migration;
- UI;
- test.

## Step 4 — Execute by dependency waves

### Wave A — Integrity & Safety
ISSUE-004, 008, 014, 015, 016, 017

### Wave B — Domain & Core Rules
ISSUE-001, 003, 007, 009, 010, 011, 013

### Wave C — UX/Data Refinement
ISSUE-002, 005, 006, 012

Safe parallelism is allowed only for independent modules with stable contracts.

## Step 5 — Root-cause rule
Do not patch symptoms in UI if the defect originates in domain/API/timezone/persistence/state/concurrency logic.

## Step 6 — Per-issue closure
For each ISSUE:
1. reproduce;
2. identify root cause;
3. implement correction;
4. add automated regression test;
5. run targeted tests;
6. run affected module tests;
7. run security/authorization review when applicable;
8. mark closed only with evidence.

## Step 7 — Critical integrity requirements
- Never mutate user-requested trip timestamps during recommendation.
- Use explicit timezone semantics end-to-end.
- Prevent double booking transactionally.
- Prevent carpool over-capacity transactionally.
- Enforce state/time controls server-side.
- Enforce CNH blocking server-side.
- Enforce damage-photo requirement server-side.

## Step 8 — Carpool
Carpool is evaluated before another vehicle.
Flow:
Passenger Request -> Host Accept/Reject -> Seat Confirmed/Rejected.
Do not automatically add passenger before host acceptance.

## Step 9 — CNH
Document extraction/OCR/AI is an extraction aid, not an infallible source.
Never invent unreadable data.
Low-confidence/failure -> manual validation.
Expired -> automatic block.
Renewal -> evidence + validation + Fleet Manager release.

## Step 10 — Circulation restriction
Implement a rule/configuration engine. Do not encode a fragile `ICE-only` conditional as the policy model.

## Step 11 — Equipment
Required equipment belongs to VehicleModel configuration. UI validates PRESENT items applicable to that model.

## Step 12 — Remediation gate
Before completion:
- RT-001..RT-022 pass;
- original GT-001..GT-015 pass;
- build/lint/migrations pass;
- API contracts pass;
- state-machine tests pass;
- authorization/security tests pass;
- concurrency tests pass;
- audit checks pass.

If anything fails:
diagnose -> repair -> rerun.

## Step 13 — Deliverables
Generate:
- `MVP_REMEDIATION_COMPLETION_REPORT.md`
- `MVP_REMEDIATION_TRACEABILITY_MATRIX.md`
- `OPEN_ITEMS.md` (must be empty for Critical/High issues unless explicitly blocked)
- migration notes
- configuration/seed notes
- test evidence summary

## Stop conditions
Do not ask Product Owner for routine technical choices.
Stop only for:
- genuine undefined product decision;
- requested baseline change outside this pack;
- architecture blocker;
- unavailable external dependency with no safe fallback.

## Success
The remediation is successful only when the observed problems are fixed at root cause and the original platform capabilities still pass regression.
