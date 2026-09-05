# ISSUE-013 — Team/User administration lacks complete edit/save/delete controls

**Severity:** High  
**Classification:** Admin UX / CRUD defect

## Observed behavior
Fleet Manager cannot reliably edit role/profile for testing/operations.

## Required behavior
Provide authorized edit, save, deactivate/remove behavior for user profiles, including role assignment and driver authorization controls. Prefer deactivate over destructive deletion for audited operational users.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Authorized Fleet Manager can edit role
- Changes persist after reload
- Unauthorized users cannot change roles
- Operational-history users are deactivated rather than physically deleted where required
- Role changes audited

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
