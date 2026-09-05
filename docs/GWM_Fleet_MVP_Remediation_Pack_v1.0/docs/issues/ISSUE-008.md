# ISSUE-008 — CNH evidence, extraction, expiry blocking and controlled release

**Severity:** Critical  
**Classification:** Safety / authorization enhancement

## Observed behavior
Driver profile can rely on manually typed CNH validity and does not enforce evidence-based expiry lifecycle.

## Required behavior
CNH document/photo upload is mandatory for driver authorization. Extract validity from document using document extraction/OCR/AI assistance, retain evidence, and require validation. Expired CNH automatically blocks driving. New valid CNH must be submitted; Fleet Manager performs final release after validation.

## Required engineering actions
- Perform root-cause analysis before patching.
- Identify affected domain module(s), API(s), persistence and UI.
- Update canonical engineering documentation where this remediation delta applies.
- Add automated regression coverage.
- Preserve all unaffected baseline behavior.

## Acceptance criteria
- Driver cannot become authorized without CNH evidence
- Extracted expiry is stored with provenance
- Expired CNH blocks checkout automatically
- New document submission does not silently bypass Fleet Manager release
- Only authorized Fleet Manager can release blocked driver
- All changes are audited
- Extraction failure has manual review path rather than guessing

## Closure evidence
The Completion Report must include:
- root cause;
- files/modules changed;
- migration/configuration changes;
- automated tests added;
- test result;
- screenshots only as supplemental evidence;
- regression result.
