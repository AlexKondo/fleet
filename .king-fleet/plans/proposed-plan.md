# Proposed Plan — King-Fleet Remediation Run

Based on: full read of the MVP Remediation Pack v1.0 (17 issues) + Controlled Engineering
Set v1.1, cross-referenced against the codebase at commit 973a43d (main). Full detail per
issue in `.king-fleet/issues/master-issue-registry.md`. Technical baseline in
`.king-fleet/baseline/technical-baseline.md`.

## 0. Deployment gap (not a remediation issue — separate, smaller action)
4 migrations already committed and their app code already deployed to Vercel, but not
applied to the production Supabase database:
- `0012_leave_carpool.sql`, `0013_atomic_last_administrator_guard.sql`,
  `0017_communication_hub.sql`, `0018_automatic_reassignment.sql`

This silently breaks: leaving a carpool, team role-edit/removal (ISSUE-013 depends on this),
delay-impact messaging, and automatic reassignment — all in production right now. Pure `supabase
db push` action, no code change. Previously asked, not yet confirmed by user.

## 1. Already fixed — no work needed (5 of 17)
| Issue | Status |
|---|---|
| ISSUE-004 — trip date/time resets | Fixed (uncontrolled inputs already prevent it) |
| ISSUE-009 — photos mandatory without damage | Fixed |
| ISSUE-011 — SP rodízio model | Fixed (mapping verified correct against official rule) — only a stale "unverified" code comment to clean up |
| ISSUE-013 — team admin CRUD | Fixed in code — blocked only by the migration gap above |
| ISSUE-015 — 09:00→12:00 timezone bug | Could not reproduce — code path is timezone-correct end to end. Recommend closing with a regression test rather than a fix, to satisfy the issue's own test-coverage acceptance criterion |

## 2. Real gaps requiring work (11 of 17)

### Wave A — Integrity & Safety
| Issue | Size | Summary |
|---|---|---|
| ISSUE-017 — double-booking | Small | DB protection already solid (real EXCLUDE constraint, transactional, correctly scoped). Missing: stable `RESERVATION_CONFLICT` error code + one concurrency regression test |
| ISSUE-014 — early-pickup window | Medium | No check today — a reservation can be picked up before its scheduled window opens. **Needs a product decision first** (no business rule defines an allowed grace period) — recommend a DV before implementing |
| ISSUE-016 — carpool host acceptance | Large | Prioritization works; the accept/reject step is entirely missing (passenger joins are auto-accepted, host driver has no say). Schema + RPC + UI |

### Wave B — Domain & Core Rules
| Issue | Size | Summary |
|---|---|---|
| ISSUE-001 — HEV powertrain | Medium | Missing end-to-end (domain type, DB enum, validation, UI) |
| ISSUE-003 — electric range + server validation | Medium | Depends on ISSUE-001; also needs server-side enforcement (today client-only) |
| ISSUE-007 — site-scoped locations | Large | Real architectural gap — no site/facility concept exists at all |
| ISSUE-008 — CNH evidence/OCR | Medium | Expiry-blocking already enforced server-side (solid); document upload/evidence/provenance entirely missing |
| ISSUE-010 — equipment checklist inverted | Medium | No per-vehicle-model config exists; UI marks absence instead of confirming presence |

### Wave C — UX/Data Refinement
| Issue | Size | Summary |
|---|---|---|
| ISSUE-002 — fuel operational bands | Small | Replace raw % input with a band selector |
| ISSUE-005 — reassignment picker identification | Small | UI-only — richer option label, no migration |
| ISSUE-006 — vehicle color | Small | New column + form + display |
| ISSUE-012 — checklist vehicle identity + range | Small | Extends pickup/return queries; shares a migration with ISSUE-006 (model/color) |

## Suggested batching (shared migrations / dependencies)
- **Batch 1**: ISSUE-006 + ISSUE-012 (one migration: add `model`, `color` to vehicles; shared `VehicleIdentityHeader` component)
- **Batch 2**: ISSUE-001 + ISSUE-003 (one migration: add HEV to energy_type enum; domain + server validation together)
- **Batch 3**: ISSUE-017 (error code + test) — independent, smallest, safest starting point
- **Batch 4**: ISSUE-005 — independent, UI-only, no migration
- **Batch 5**: ISSUE-002 — independent
- **Batch 6**: ISSUE-014 — blocked on a DV (product decision) before implementation
- **Batch 7**: ISSUE-007 (sites) — independent, large, architectural
- **Batch 8**: ISSUE-008 (CNH evidence) — independent, needs a storage/upload decision
- **Batch 9**: ISSUE-010 (equipment model config) — independent, architectural
- **Batch 10**: ISSUE-016 (carpool acceptance) — independent, large

## Items explicitly NOT proposed for this run
- Employee Fleet Rental — explicitly out of MVP scope per `docs/instruction.md` and the
  Controlled Engineering Set.
- Any redesign of already-working areas (dashboard, signup, notifications, email, password
  reset, general team CRUD) — preserved as-is per King-Fleet's mandate to fix, not
  redesign.

## Open question requiring a human decision before Batch 6 (ISSUE-014)
What grace period (if any) should be allowed for early pickup relative to a reservation's
scheduled `start_at`? E.g. 0 minutes (strict), 15 minutes, 1 hour, or organization-configurable.
