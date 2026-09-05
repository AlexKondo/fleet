# ISSUE-007 — Parking locations are not scoped by site

**Severity:** High  
**Classification:** Domain + UX refinement

## Observed behavior
Users may see parking locations from unrelated facilities.

## Required behavior
Introduce Site/Facility ownership for VehicleLocation. Users/checklists must only see locations valid for the operational site of the reservation/vehicle, unless Fleet Manager has cross-site administrative scope.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Examples such as SP Office and Iracemápolis can have separate locations
- Iracemápolis workflow does not show EZ Towers basement locations
- Location API supports site filter
- Vehicle current location remains site-valid

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
