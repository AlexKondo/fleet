# ISSUE-001 — HEV powertrain missing/inconsistent

**Severity:** High  
**Classification:** Product gap / domain model

## Observed behavior
Vehicle/category energy selection does not consistently support HEV.

## Required behavior
Add HEV as a first-class powertrain option alongside ICE, PHEV and BEV. A vehicle configured as HEV must be selectable and persisted as HEV.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- VehicleModel/Category configuration supports HEV
- Vehicle create/edit supports HEV
- API/schema/DB enum support HEV
- Recommendation/readiness logic does not treat HEV as BEV
- Tests cover create/edit/read HEV vehicle

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
