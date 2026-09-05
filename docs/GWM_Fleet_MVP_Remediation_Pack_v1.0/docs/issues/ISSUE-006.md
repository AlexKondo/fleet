# ISSUE-006 — Vehicle color missing

**Severity:** Medium  
**Classification:** Data model enhancement

## Observed behavior
Fleet master lacks vehicle color, reducing physical identification in parking areas.

## Required behavior
Add vehicle color to Vehicle master and expose it wherever physical identification matters.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Create/edit vehicle includes color
- Vehicle cards/detail/checklist/reassignment show color
- API and persistence support color

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
