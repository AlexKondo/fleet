# ISSUE-004 — Trip date/time resets after recommendation search

**Severity:** Critical  
**Classification:** Bug / state integrity

## Observed behavior
User-selected departure/return date-time is replaced by the current request date/time after recommendation search.

## Required behavior
Recommendation search must be a pure evaluation of the submitted trip window. It must never mutate departureAt or expectedReturnAt.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Exact user-entered timestamps survive recommendation search
- Refresh/re-render preserves timestamps
- API response cannot overwrite request timestamps unintentionally
- Regression test uses future date/time

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
