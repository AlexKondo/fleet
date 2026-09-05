# ISSUE-017 — Concurrent/overlapping double booking protection

**Severity:** Critical  
**Classification:** Concurrency / integrity

## Observed behavior
System must prevent the same vehicle from being reserved by two people for overlapping periods, including simultaneous attempts.

## Required behavior
Enforce overlap protection transactionally at backend/database level; UI checks alone are insufficient.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Two overlapping sequential reservations cannot both confirm
- Two simultaneous attempts for same last vehicle yield one success only
- Cancelled/rejected reservations do not block according to canonical state rules
- Conflict returns RESERVATION_CONFLICT
- Concurrency regression test is mandatory

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
