# ISSUE-010 — Mandatory equipment logic is inverted and not vehicle-model-specific

**Severity:** High  
**Classification:** Business rule defect

## Observed behavior
Checklist is framed around absent equipment and applies equipment generically.

## Required behavior
Checklist should confirm required equipment PRESENT for that specific vehicle model. Required equipment is configured by VehicleModel. Triangle is required for all configured vehicles; jack/wheel wrench/spare tire depend on model configuration.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Checklist only shows equipment applicable to selected model
- Label/interaction represents presence verification
- Missing required equipment creates Safety Issue
- Model equipment configuration is editable by Fleet Manager
- Do not hardcode H6/ORA assumptions in code; seed/configure them as business data

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
