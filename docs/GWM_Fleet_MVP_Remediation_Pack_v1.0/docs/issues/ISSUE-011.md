# ISSUE-011 — São Paulo circulation restriction alert not correctly modeled

**Severity:** High  
**Classification:** Business rule / policy engine

## Observed behavior
Rodízio alert is not reliably driven by destination/date/plate/policy.

## Required behavior
Implement a configuration/rule-driven circulation restriction engine. For trips that may circulate in São Paulo, evaluate applicable vehicle restriction rules using date/day, plate ending and vehicle eligibility. Do not hardcode the engine solely as `powertrain == ICE`; applicability must be configurable.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- SP trip evaluates restriction before final reservation
- Applicable plate/day generates visible warning
- Non-applicable trip does not generate false warning
- Rule applicability is configurable by vehicle/category/powertrain/policy
- Decision is testable without external web service

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
