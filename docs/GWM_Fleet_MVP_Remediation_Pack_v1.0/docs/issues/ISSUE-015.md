# ISSUE-015 — Recommendation changes requested 09:00 departure to 12:00

**Severity:** Critical  
**Classification:** Bug / timezone or transformation

## Observed behavior
Recommendation flow mutates a user-entered time.

## Required behavior
Preserve exact local trip timestamps end-to-end. Diagnose timezone/serialization/default-time cause. Store/transport timestamps with explicit timezone strategy and never substitute arbitrary times.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- 09:00 remains 09:00 through UI/API/DB/recommendation
- Date remains unchanged
- Tests cover Brazil local timezone and serialization
- No hidden default 12:00 behavior remains

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
