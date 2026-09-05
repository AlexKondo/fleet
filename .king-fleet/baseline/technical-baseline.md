# Technical Baseline — King-Fleet Run

Date: 2026-09-05
Branch: main (up to date with origin/main)
Commit: 973a43d9510f895b0d821218653de3300f868ce4 — "Convert location/category chips to cards, and move Equipe's invite form into a popup"

## Repository structure
pnpm workspaces + Turborepo monorepo:
- `apps/web` — Next.js 15 App Router, TypeScript, Tailwind v4
- `packages/domain` — pure TypeScript domain logic (Mobility Decision Engine, readiness, carpool, state machine, workflow, maintenance, traffic restriction), vitest
- `packages/supabase-client` — generated Supabase types + typed client

## Stack
- Frontend: Next.js 15 (App Router, Server Actions, Server Components)
- Backend/DB: Supabase (Postgres + Auth/GoTrue + RLS), 18 migration files (0001-0018)
- Email: Brevo SMTP (transactional — reservation approved/cancelled, tasks, password reset)
- Deployment: Vercel (auto-deploys on push to `main`), production Supabase project `rhbiwkxilelitugbwind`
- Auth: Supabase Auth, multi-tenant via `organization_id` + RLS

## Baseline verification results (run before any remediation work)

| Check | Result |
|---|---|
| `pnpm typecheck` (3 packages) | PASS |
| `pnpm --filter @fleet/domain test` | PASS — 87/87 tests, 10 files |
| `pnpm --filter @fleet/web build` | PASS — clean production build, 17 routes |
| Remote DB reachability | PASS (verified via direct REST probe against production project) |

## Known pre-existing environment blocker (NOT introduced by King-Fleet, classify as ENVIRONMENT BLOCKER)

Four migrations exist in the repo and their application code is already deployed to Vercel production, but the corresponding Postgres functions do **not** exist on the production Supabase database (verified via direct RPC probe against `rhbiwkxilelitugbwind`, both before this run and re-confirmed now):

- `0012_leave_carpool.sql` → `leave_carpool()` — MISSING on remote
- `0013_atomic_last_administrator_guard.sql` → `update_member_role()` — MISSING on remote
- `0017_communication_hub.sql` → `post_reservation_message()` — MISSING on remote
- `0018_automatic_reassignment.sql` → `auto_reassign_reservation_vehicle()` — MISSING on remote

Migrations 0001-0011, 0014, 0015, 0016 ARE applied on remote (spot-verified this session).

This means "leave carpool," the last-administrator race-condition guard, the Communication Hub's delay-impact detection, and automatic vehicle reassignment are all currently broken in production right now, independent of anything in the Remediation Pack. This is a deployment/ops gap, not a code defect — flagged for the Human Approval Gate since applying migrations to production is an irreversible-ish action requiring explicit user confirmation (already asked once this session, user has not yet confirmed).

## Documentation state (relevant to remediation)

`/docs` contains three document sets, read in full as part of Discovery:
1. **Controlled Engineering Set v1.1** (`docs/GWM_Fleet_Controlled_Engineering_Set_v1.1/docs/`) — canonical product/engineering baseline (ADRs, business rules, domain model, state machines, API contracts, UX journeys, implementation packs IP-000..IP-016, Golden Test Scenarios).
2. **MVP Remediation Pack v1.0** (`docs/GWM_Fleet_MVP_Remediation_Pack_v1.0/docs/`) — corrective overlay with 17 numbered issues (ISSUE-001..017), already prioritized into Wave A (Integrity & Safety), Wave B (Domain & Core Rules), Wave C (UX/Data Refinement). This is the primary actionable input for this King-Fleet run.
3. **Test Book & User Manual** (`docs/GWM_FleetMind - Multi Agent Test Book & User Manual v1.0/`) — not yet read in detail.

`docs/instruction.md` is a general "build the whole MVP autonomously" directive from an earlier/different orchestration approach (near-zero human-in-the-loop). King-Fleet's own protocol (human approval gate before implementation) takes precedence per this skill's own bootstrap instructions — the remediation pack's precedence rules are followed instead.

## Important note on currency

Much of the product described as gaps in `docs/instruction.md`'s originating blueprint is **already implemented** in the current codebase (signup, fleet management, dashboard, notifications, settings, trips, reservations/checklists, carpooling, driver authorization, audit trail, booking mode, communication hub, automatic reassignment domain logic, email, password reset, team management). The Remediation Pack's 17 issues are the actual current gap list to verify against **today's** code, not a from-scratch build list.
