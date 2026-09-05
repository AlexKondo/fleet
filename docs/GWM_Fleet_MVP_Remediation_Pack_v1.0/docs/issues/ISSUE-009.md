# ISSUE-009 — Photo controls shown/required without external damage

**Severity:** High  
**Classification:** Baseline violation / UX

## Observed behavior
Photo capture is available/required in normal checklist in a way that adds friction.

## Required behavior
Normal check-in/out has no mandatory photo step. Damage evidence controls become mandatory only after External Damage/Avaria is marked.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- No damage => checklist completes with zero photos
- Damage => at least one photo required
- Server rejects damage issue without evidence
- Optional non-damage photos are not forced into the golden path

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
