# ISSUE-002 — Fuel input should use operational bands

**Severity:** Medium  
**Classification:** UX + data refinement

## Observed behavior
Fuel is captured as a free percentage where the requested operational UX is categorical.

## Required behavior
Driver/Security operational fuel capture uses selectable levels: FULL, THREE_QUARTERS, HALF, ONE_QUARTER, RESERVE. Internal model may retain normalized value if needed, but UI and audit preserve the selected band.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Fuel selector exposes the five approved values
- Value persists across check-in/out
- Existing percentage data remains readable/migratable
- No battery-only vehicle is forced to provide fuel

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
