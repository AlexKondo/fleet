## NEW FINDING (discovered during TASK-014 implementation, not in the original 17)

### FINDING-A — Intermittent session loss on Server Action POST (race condition)
**Type: Bug (new, unrelated to any of the 17 remediation issues) — per King-Fleet §3.4,
recorded here rather than fixed under TASK-014's scope.**

**Symptom:** Submitting `saveOrganizationSettings` (and likely any Server Action that
revalidates and re-renders a page) intermittently redirects the user to `/login` instead of
saving, even though they are genuinely authenticated. Reproduced via direct instrumentation:
middleware correctly recognizes the session on the POST request itself (`sb-127-auth-token`
cookie present, `getUser()` succeeds), but a subsequent internal request (Next.js resolving
the action's own issued redirect) shows the SAME cookie missing. Confirmed non-deterministic
— an identical repro attempt moments later succeeded cleanly (200, no redirect) with the
exact same account/session.

**Suspected root cause:** `apps/web/lib/supabase/middleware.ts` and
`apps/web/lib/supabase/server.ts` each construct their own independent `createServerClient`
instance and can each independently trigger a Supabase session-token refresh from cookies
within the same request/response cycle (middleware always calls `getUser()`; every Server
Action calls `createSupabaseServerClient()` and typically also calls `getUser()`). With
refresh-token rotation enabled (`supabase/config.toml`:
`enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`), two
independent refresh attempts racing on the same underlying refresh token can result in one
succeeding (rotating the token, writing fresh cookies) and the other failing against the
now-already-rotated-away token — and a failed refresh in `@supabase/ssr`/`@supabase/auth-js`
clears the session, whose empty cookies can then clobber the other client's successful
write depending on write order within the same response.

**Scope:** Not caused by any change in this King-Fleet run — the same architecture
(independent Supabase clients per middleware/action) is used by every Server Action in the
app (dashboard, fleet, trips, settings, reservations). This is a latent, pre-existing
concurrency bug, surfaced only now because reproducing it happened to come up while
verifying TASK-014's settings UI.

**Not fixed here** — out of Wave A's approved scope, and fixing it properly likely requires
either a single shared Supabase client instance per request (passed through, not
independently reconstructed) or disabling/reconfiguring refresh-token rotation, both of
which are architectural changes needing their own dedicated investigation and human
approval, not a quick patch bundled into TASK-014.

**Verification impact on TASK-014:** Because of this unrelated race, browser-based E2E
verification of the settings save flow was unreliable (sometimes 200, sometimes an
incorrect 303-to-login). TASK-014's actual safety-critical logic (the early-pickup grace
window enforced in `record_pickup`) was instead verified directly via
`supabase/tests/early-pickup-window.mjs`, a real RPC-level regression test with no browser
session involved — run 3 times, 4/4 checks passed every time, no flakiness. The settings
form itself was confirmed to render the new field correctly and, on a run unaffected by the
race, to save and persist the value correctly (visible in the removed debug instrumentation
before cleanup — `saveOrganizationSettings` read a valid user, updated the row, and the
page re-rendered with the new value).

**Recommended next step (not part of this run):** a dedicated investigation/fix pass on the
session-refresh architecture, with its own approval gate given the architectural nature of
the fix. Suggest opening this as a new remediation issue if this pack gets a v1.1.

# Master Issue Registry — King-Fleet Discovery

Source: docs/GWM_Fleet_MVP_Remediation_Pack_v1.0/docs/issues/ISSUE-001..017.md, cross-referenced
against the current codebase at commit 973a43d (main).

Status legend: NOT_ADDRESSED / PARTIALLY_ADDRESSED / FULLY_ADDRESSED / CANNOT_REPRODUCE_FROM_CODE_READING

---

## Cluster: Vehicle / Energy Domain

### ISSUE-001 (High) — HEV powertrain missing/inconsistent
**Status: NOT_ADDRESSED**
`EnergyType` (packages/domain/src/entities/vehicle.ts:1) and DB enum `energy_type`
(0001_init_schema.sql) are both `ICE | PHEV | BEV` — no HEV anywhere (domain, DB, server
validation in fleet/actions.ts, or the VehicleForm dropdown). Canonical delta doc confirms
HEV is required. Fix: migration adding HEV to enum, domain type update, showFuel/showBattery
+ readiness/traffic-restriction logic updated so HEV isn't silently treated as fuel-only ICE
or miscategorized, regression tests.
Risk: High — GWM's real fleet is HEV-heavy; can't register a whole vehicle class.

### ISSUE-002 (Medium) — Fuel input should use operational bands
**Status: NOT_ADDRESSED**
Fuel is a raw 0-100 number input everywhere (VehicleForm, PickupForm, ReturnForm) — no
FULL/THREE_QUARTERS/HALF/ONE_QUARTER/RESERVE selector exists in the repo at all. BEV
correctly hides the fuel field already (one criterion already met).
Fix: FuelBand enum/mapping in packages/domain, swap number input for band selector in the 4
forms + their actions.ts, map band→% server-side (no forced migration — could reuse existing
fuel_level_percent column via mapping, or add fuel_band column).
Risk: Medium — UX friction/inaccuracy, not data-integrity.

### ISSUE-003 (High) — Powertrain-aware energy fields and electric range
**Status: PARTIALLY_ADDRESSED**
Fuel/battery conditional visibility by energy type already works client-side. Gaps: (1) no
dedicated "Electric Range" field distinct from the generic estimatedRangeKm shown for every
powertrain; (2) server-side (fleet/actions.ts) only validates energyType enum + numeric
bounds — nothing stops a raw POST setting fuel_level_percent on a BEV row, so the "BEV cannot
submit fuel" rule is UI-only, not enforced server-side. Depends on ISSUE-001 for the HEV
branch.
Risk: High — spec explicitly requires server-side enforcement; current gap allows persisting
inconsistent energy data via a malformed/malicious payload.

### ISSUE-006 (Medium) — Vehicle color missing
**Status: NOT_ADDRESSED**
No `color` column in the vehicles table, no field in the Vehicle domain type, not shown
anywhere (VehicleRow, checklist, reassignment UI). Canonical delta doc requires it as part of
minimum vehicle identity on operational surfaces.
Fix: migration adding `color text`, domain type + form + actions.ts + display updates
(VehicleRow, pickup/return checklist header, reassignment picker).
Risk: Medium — operational friction identifying vehicles physically.

---

## Cluster: Trip / Booking Flow (Wave A — Critical)

### ISSUE-004 (Critical) — Trip date/time resets after recommendation search
**Status: FULLY_ADDRESSED — no fix needed**
TripRequestForm.tsx:83-101 departure/return inputs are uncontrolled (defaultValue only, no
`value` binding, no `key` remount) — React ignores defaultValue changes on an already-mounted
input, so a state update after planTrip() resolves cannot mutate what the user typed. No
timestamp reassignment anywhere server-side either.
Residual risk: Low — only regressable if a future refactor makes these inputs controlled
without freezing the initial default. Recommend adding a regression test asserting the DOM
value survives a plan fetch, to guard against reintroduction.

### ISSUE-014 (Critical) — Trip start/return temporal controls missing
**Status: PARTIALLY_ADDRESSED**
Return-before-departure IS protected (state-machine gating: record_return requires vehicle
status in/reached via record_pickup, so a return literally cannot precede a pickup event).
Early-pickup-before-window is NOT protected: record_pickup (0004_operational_actions.sql)
only checks vehicle.status, never reservations.start_at vs now() — a reservation for
tomorrow 09:00 can be picked up right now once its vehicle is 'reserved'/'awaiting_pickup'.
No actual_departure_at/actual_return_at columns exist either (no audit record of real vs.
scheduled timing). No business rule defines an allowed early-pickup grace window — likely
needs a product decision (DV) on tolerance, e.g. an organization_settings field.
Fix: add p_now param (or now()) to record_pickup, compare against reservations.start_at minus
a configurable grace, raise EARLY_PICKUP_NOT_ALLOWED, surface in
reservations/[id]/pickup/actions.ts like the existing DRIVER_NOT_AUTHORIZED/LICENSE_EXPIRED
pattern. Add regression tests (early/valid/late pickup, pre/post-departure return).
Risk: High/Critical as rated — undermines double-booking guarantees; someone could take a
vehicle reserved for an earlier unrelated slot before that reservation's window even opens.

### ISSUE-015 (Critical) — Recommendation changes 09:00 departure to 12:00 (timezone bug)
**Status: CANNOT_REPRODUCE_FROM_CODE_READING (evidence points to already-fixed)**
Traced the full data flow UI→client transform→domain→DB→display: datetime-local input →
`new Date(str).toISOString()` (correct single local→UTC conversion) → domain engine only
reads/compares timestamps, never reassigns or defaults them (grepped all of
packages/domain/src) → DB columns are timestamptz (not the classic `timestamp without time
zone` root cause of this exact symptom class) → display converts back via
toLocaleString("pt-BR"), symmetric with capture. No setHours/noon-default/getTimezoneOffset
misuse found anywhere.
Recommend: reclassify to closed-pending-test-coverage rather than open — add a domain test
fixing a BRT wall-clock time and asserting no ±3h drift through planTrip, to satisfy the
issue's own "tests cover Brazil local timezone" acceptance criterion even with no live bug
found. Only unverifiable-from-static-reading vector: a user/server whose timezone isn't
Brazil, which is a user-environment condition already assumed throughout (also relied on by
the São Paulo rodízio check), not a code defect.

## Cluster: Location & Fleet Manager UX

### ISSUE-005 (Medium) — Reassignment picker lacks vehicle identification
**Status: NOT_ADDRESSED**
dashboard/page.tsx:278-282 swap-vehicle `<select>` shows only plate. The join data (category
name, current_location name, energy_type, status) is already fetched but discarded in the
option label. Fix: compose a richer label — no migration needed, dashboard/page.tsx only.
Risk: Low-medium — mitigated somewhat since options are already filtered to available
vehicles, but wrong-vehicle-by-plate-alone risk remains.

### ISSUE-007 (High) — Parking locations not scoped by site
**Status: NOT_ADDRESSED — genuine architectural gap, highest risk of this cluster**
vehicle_locations table has only id/organization_id/name across all 18 migrations — no
site/facility concept at all (confirmed via grep, zero hits for site_id/facility). RLS scopes
only by organization_id. An org with 2+ physical facilities would show all locations from
both to every user — exactly the acceptance criterion the spec fails.
Fix: real migration (new `sites` table + site_id FK on vehicle_locations/vehicles/profiles),
RLS extension (site-scoped unless fleet_manager/administrator), UI updates to
LocationForm/LocationRow/pickers, and record_return's location-validation check extended to
match site not just org.
Risk: High (matches spec) — guaranteed failure mode once an org has >1 site.

### ISSUE-012 (Medium) — Checklist lacks complete vehicle identity and electric range
**Status: PARTIALLY_ADDRESSED**
Pickup/return checklist headers show plate only — no category, location, model, color, range,
or battery SOC, despite most of that data already existing in the schema/query elsewhere
(model/color genuinely don't exist as columns — same gap as ISSUE-006). Fuel-vs-battery input
gating by energy_type already works correctly (one criterion met).
Fix: extend pickup/return page queries + add model/color columns (shared migration with
ISSUE-006), build a shared VehicleIdentityHeader component, show battery SOC/range for
BEV/PHEV.
Risk: Medium — plate alone still identifies the vehicle today; missing range is an
operational annoyance for EV trips, not safety-critical.

## Cluster: Safety & Security

### ISSUE-008 (Critical) — CNH evidence, extraction, expiry blocking
**Status: PARTIALLY_ADDRESSED**
The safety-critical half works: record_pickup (0014_driver_authorization.sql) enforces
DRIVER_NOT_AUTHORIZED / LICENSE_EXPIRED server-side, non-bypassable, RPC-level. License
number/category/expiration are captured — but as free-text/date admin input only. No document
upload, no OCR/extraction, no evidence/provenance concept anywhere (confirmed via grep — no
bucket, no extraction service, no evidence table). Audit logging on every change is present.
Fix: add drivers_license_documents table + storage bucket, an upload step (manual "enter +
attach evidence" is an acceptable interim per spec's own manual-review fallback), gate
driver_authorized on having at least one evidence record. Keep existing record_pickup guard.
Risk: High — the blocking logic is solid, but nothing stops an administrator from typing a
fabricated/wrong expiry date with no supporting document; real legal/liability gap.

### ISSUE-009 (High) — Photo controls without external damage
**Status: FULLY_ADDRESSED — no fix needed**
Standard photos are genuinely optional (no `required`, UI copy says "Recomendado").
Damage-evidence photo is conditionally required only when hasDamage is true, client AND
server side (result.damageEvidenceMissing handling). Same pattern in both pickup and return
flows. Closed.

### ISSUE-010 (High) — Mandatory equipment logic inverted, not model-specific
**Status: NOT_ADDRESSED — full architectural gap**
SAFETY_EQUIPMENT_OPTIONS (checklist.ts) is one hardcoded global array for every vehicle
regardless of model — no vehicle_models table or per-model config exists anywhere (zero
grep hits). PickupForm's fieldset literally reads "Equipamentos obrigatórios ausentes"
(mandatory equipment MISSING) — checking a box means "this item is absent," the exact
inverted framing the spec flags. Downstream Safety Issue creation from missing equipment
already works correctly (assessVehicleReadiness.ts) — only the input side is wrong.
Fix: add vehicle_models/model_equipment_requirements table (business-configurable, not
hardcoded per-brand), change checklist UI to positive-confirmation framing (checked =
verified present), unchecked-at-submit → Safety Issue, add Fleet Manager admin UI to edit
model equipment config.
Risk: Medium-high — checks exist but are semantically backwards and generic across all
vehicle models.

### ISSUE-011 (High) — São Paulo rodízio not correctly modeled
**Status: FULLY_ADDRESSED — no functional fix needed**
checkTrafficRestriction.ts is genuinely data-driven/configurable (not hardcoded to
energy_type==ICE — exemption is a configurable list), the digit/weekday/window mapping was
verified against the actual official CET-SP rule and is CORRECT (earlier session had flagged
this as "unvalidated" — now confirmed accurate), wired into trip planning pre-reservation,
org-configurable via organization_settings.traffic_restriction_enabled, and has offline unit
tests. Only loose end: the source comment still carries a stale "MUST BE VERIFIED" disclaimer
that should be updated to reflect the now-confirmed-correct status.
Risk: Low — documentation-only cleanup, no functional gap.

## Cluster: Team Admin CRUD

### ISSUE-013 (High) — Team/User administration edit/save/delete controls
**Status: FULLY_ADDRESSED (code) — blocked by deployment gap**
All of view/edit-role/edit-driver-license/remove/invite are genuinely implemented and wired
to real server actions in apps/web/app/settings/users/ (page.tsx, UserRow.tsx,
InviteUserModal.tsx, actions.ts). Authorization gated via requireAdministrator(); every
action audit-logs via log_audit_event RPC; last-administrator guard via
lock_and_require_multiple_administrators (migration 0013). Self-removal blocked,
last-admin-removal blocked, FK-conflict-on-delete has a documented fallback message
(demote instead of delete) since profiles has no is_active flag.
**Blocker: migration 0013 is not applied to production** (confirmed earlier this session) —
update_member_role/lock_and_require_multiple_administrators RPCs don't exist there, so role
edits and user removal will fail with an RPC-not-found error in production right now despite
complete, correct application code.
Fix: apply migration 0013 (see Technical Baseline — same blocker as ISSUE-016/017's
leave_carpool and the Communication Hub). No application code changes needed.
Risk: High while migration is unapplied (silent CRUD breakage on admin surface); Low once
applied (only the documented, accepted two-admins-race residual window remains).

## Cluster: Carpool & Double-Booking Concurrency (Wave A — Critical)

### ISSUE-016 (Critical) — Carpool prioritization & host-driver acceptance
**Status: PARTIALLY_ADDRESSED**
Prioritization is solid and well-tested: planMobility.ts checks findCarpoolMatches() first,
only falls through to recommendVehicle() when no compatible match exists (planMobility.test.ts
covers this). Gap is the acceptance-critical half: create_carpool_participation()
(0003_trip_request_flow.sql) inserts directly into trip_participants with NO approval gate —
migration's own comment says "the request itself represents the passenger accepting the
existing trip's schedule," backwards from spec (host driver, not joining passenger, must
accept). No Accept/Reject UI, no pending-request state, no host notification exists anywhere
(confirmed via grep). Leave-carpool exists (0012, passenger-initiated only) but isn't a
substitute for host consent before joining.
Fix: add pending/accepted/rejected status to trip_participants (or a separate requests
table), a respond_to_carpool_request RPC restricted to the reservation's driver (re-checks
capacity transactionally on accept), host-facing UI to see/respond to pending requests, reuse
existing notification/email plumbing (0008_notifications.sql) for both outcomes. Schema + RPC
+ UI change, not a small patch.
Risk: High user-trust/product-integrity — a driver can be involuntarily saddled with a
stranger passenger with zero say. Not safety-critical to scheduling itself (capacity/overlap
still enforced elsewhere).

### ISSUE-017 (Critical) — Concurrent/overlapping double-booking protection
**Status: FULLY_ADDRESSED at the data layer — PARTIALLY_ADDRESSED on test-evidence/error-contract**
The actual safety mechanism is solid: a real Postgres `EXCLUDE USING gist` constraint on
reservations (0001_init_schema.sql:160-165) — vehicle_id equality + tstzrange overlap,
scoped to active statuses only via partial-index WHERE clause (cancelled/completed correctly
excluded), enforced transactionally by Postgres itself, not app code.
create_vehicle_reservation() is one transaction so a constraint violation rolls back cleanly,
no orphan rows. tstzrange defaults to [start,end) so back-to-back reservations don't falsely
conflict (matches existing availability.test.ts coverage).
Two real gaps: (1) no RESERVATION_CONFLICT error code — trips/new/actions.ts just returns
the raw Postgres exclusion-violation message on conflict, no stable code for
UI/API to key off; (2) no concurrency regression test exists anywhere — cross-tenant-rls.mjs
only tests RLS isolation, not racing reservation attempts; GT-015 (two concurrent attempts on
last vehicle → exactly one succeeds) is spec'd but has zero automated proof against a real DB.
Fix: map Postgres error code 23P01 (exclusion_violation) to {error: "RESERVATION_CONFLICT"}
in trips/new/actions.ts; add a concurrent-reservation-race test firing two parallel
create_vehicle_reservation calls via Promise.allSettled against real Postgres, asserting
exactly one succeeds.
Risk: Low actual double-booking risk (constraint already prevents data corruption); Medium
risk from missing regression test (an unnoticed future migration change could weaken the
constraint with nothing to catch it) and a real API/UX gap from the unstructured conflict
error shown to users today.
