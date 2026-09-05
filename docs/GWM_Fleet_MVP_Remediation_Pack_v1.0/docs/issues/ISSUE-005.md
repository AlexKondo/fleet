# ISSUE-005 — Fleet Manager reassignment lacks vehicle identification

**Severity:** Medium  
**Classification:** UX defect

## Observed behavior
Vehicle replacement selection shows insufficient identification, such as plate only.

## Required behavior
Reassignment choices show at minimum model, color, plate, powertrain, current location and readiness/availability summary.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Fleet Manager can distinguish alternatives without opening another screen
- Selected replacement is unambiguous
- Unavailable/ineligible vehicles are clearly identified or excluded

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
