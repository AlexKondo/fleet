# ISSUE-016 — Carpool must be prioritized and require host-driver acceptance

**Severity:** Critical  
**Classification:** Core product behavior + approved refinement

## Observed behavior
When a compatible trip exists, system recommends another vehicle instead of carpool; host approval workflow is absent.

## Required behavior
Before allocating another vehicle, identify compatible carpool. Passenger requests ride. Existing reservation driver receives Accept/Reject. On Accept, seat is confirmed and requester is notified. On Reject, requester is notified and vehicle recommendation flow may continue.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Compatible trip is surfaced before incremental vehicle allocation
- Passenger can request ride
- Host driver receives actionable Accept/Reject
- Accept transactionally reserves a seat
- Reject does not consume a seat and returns requester to mobility alternatives
- Capacity cannot be exceeded
- Both parties receive status notification
- Original driver's schedule is never changed

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
