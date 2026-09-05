# ISSUE-014 — Trip start/return temporal controls are missing

**Severity:** Critical  
**Classification:** State machine / business rule defect

## Observed behavior
User can start a trip before the scheduled pickup window or register return before a logically valid time.

## Required behavior
Trip activation and return must follow reservation state and configured timing policy. Start is not allowed before the permitted pickup window. Return cannot occur before actual departure and must follow valid state transitions.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Early start is blocked with clear error
- Valid pickup window works
- Return before actual departure is impossible
- Return after active departure works
- Server time/business timezone used consistently
- State transition tests added

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
