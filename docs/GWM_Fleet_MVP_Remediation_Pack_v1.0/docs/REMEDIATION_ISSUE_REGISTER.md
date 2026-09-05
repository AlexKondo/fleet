# REMEDIATION ISSUE REGISTER

| ID | Severity | Type | Title |
|---|---|---|---|
| ISSUE-001 | High | Product gap / domain model | HEV powertrain missing/inconsistent |
| ISSUE-002 | Medium | UX + data refinement | Fuel input should use operational bands |
| ISSUE-003 | High | Domain + conditional UX | Powertrain-aware energy fields and electric range |
| ISSUE-004 | Critical | Bug / state integrity | Trip date/time resets after recommendation search |
| ISSUE-005 | Medium | UX defect | Fleet Manager reassignment lacks vehicle identification |
| ISSUE-006 | Medium | Data model enhancement | Vehicle color missing |
| ISSUE-007 | High | Domain + UX refinement | Parking locations are not scoped by site |
| ISSUE-008 | Critical | Safety / authorization enhancement | CNH evidence, extraction, expiry blocking and controlled release |
| ISSUE-009 | High | Baseline violation / UX | Photo controls shown/required without external damage |
| ISSUE-010 | High | Business rule defect | Mandatory equipment logic is inverted and not vehicle-model-specific |
| ISSUE-011 | High | Business rule / policy engine | São Paulo circulation restriction alert not correctly modeled |
| ISSUE-012 | Medium | UX defect | Checklist lacks complete vehicle identity and electric range |
| ISSUE-013 | High | Admin UX / CRUD defect | Team/User administration lacks complete edit/save/delete controls |
| ISSUE-014 | Critical | State machine / business rule defect | Trip start/return temporal controls are missing |
| ISSUE-015 | Critical | Bug / timezone or transformation | Recommendation changes requested 09:00 departure to 12:00 |
| ISSUE-016 | Critical | Core product behavior + approved refinement | Carpool must be prioritized and require host-driver acceptance |
| ISSUE-017 | Critical | Concurrency / integrity | Concurrent/overlapping double booking protection |

## Priority order
### Wave A — Integrity & Safety
ISSUE-004, ISSUE-008, ISSUE-014, ISSUE-015, ISSUE-016, ISSUE-017

### Wave B — Domain & Core Rules
ISSUE-001, ISSUE-003, ISSUE-007, ISSUE-009, ISSUE-010, ISSUE-011, ISSUE-013

### Wave C — UX/Data Refinement
ISSUE-002, ISSUE-005, ISSUE-006, ISSUE-012

Do not treat Wave C as optional; the waves only define dependency/priority.
