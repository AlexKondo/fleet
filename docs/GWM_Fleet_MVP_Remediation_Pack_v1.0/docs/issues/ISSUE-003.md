# ISSUE-003 — Powertrain-aware energy fields and electric range

**Severity:** High  
**Classification:** Domain + conditional UX

## Observed behavior
Fuel/battery fields are not conditional enough and electric autonomy is missing.

## Required behavior
ICE: fuel only. HEV: fuel and any HEV-specific operational fields defined by current model, but no plug-in charging workflow. PHEV: fuel + battery SOC + Electric Range. BEV: battery SOC + Electric Range; fuel field hidden/disabled.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- BEV cannot submit fuel as required field
- PHEV exposes fuel, battery SOC and electric range
- BEV exposes battery SOC and electric range
- Electric range appears in relevant vehicle/checklist/readiness views
- Validation is enforced server-side, not only UI

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
