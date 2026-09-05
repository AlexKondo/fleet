# ISSUE-012 — Checklist lacks complete vehicle identity and electric range

**Severity:** Medium  
**Classification:** UX defect

## Observed behavior
Checklist identifies vehicle inadequately and omits electric autonomy for PHEV/BEV.

## Required behavior
Header shows model, color, plate, powertrain and current location; PHEV/BEV also show battery SOC and electric range where available.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Driver/Security can visually identify vehicle
- BEV/PHEV energy data visible
- No irrelevant fuel field on BEV

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
