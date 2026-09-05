# REMEDIATION REGRESSION MATRIX

| Test | Issues | Scenario | Expected |
|---|---|---|---|
| RT-001 | 004,015 | Enter future 09:00 trip and request recommendation | Date/time unchanged end-to-end |
| RT-002 | 016 | Compatible trip with seat exists | Carpool shown before new vehicle |
| RT-003 | 016 | Passenger requests carpool | Host receives Accept/Reject |
| RT-004 | 016 | Host accepts last seat concurrently | Capacity never exceeded |
| RT-005 | 017 | Two users reserve same vehicle/time concurrently | Exactly one confirmation |
| RT-006 | 014 | Attempt early trip start | Server rejects |
| RT-007 | 014 | Attempt return before departure | Server rejects |
| RT-008 | 009 | Normal checklist | Completes with zero photos |
| RT-009 | 009 | External damage selected | Photo mandatory |
| RT-010 | 010 | H6 profile without spare/jack/wrench | Only configured equipment shown |
| RT-011 | 010 | ORA profile with configured equipment | Correct equipment shown |
| RT-012 | 003 | BEV | Fuel hidden/not required; battery + electric range present |
| RT-013 | 003 | PHEV | Fuel + battery + electric range present |
| RT-014 | 001 | HEV vehicle | Create/edit/read succeeds |
| RT-015 | 007 | Iracemápolis reservation | SP Office locations absent |
| RT-016 | 008 | Expired CNH | Checkout blocked |
| RT-017 | 008 | New CNH uploaded | Remains pending until validation/release |
| RT-018 | 011 | Applicable SP restriction | Warning shown |
| RT-019 | 011 | Non-applicable restriction | No false warning |
| RT-020 | 005,006,012 | Reassignment/checklist | Model+color+plate visible |
| RT-021 | 013 | Fleet Manager changes role | Persists and audits |
| RT-022 | 002 | Fuel capture | Approved bands only |

## Full regression
After RT-001..RT-022, rerun all original Golden Test Scenarios GT-001..GT-015.

## Non-regression mandatory
Particular attention:
- Trip-Specific Readiness
- Energy & Range
- approval
- vehicle state machine
- Security independent inspection
- Communication Hub delay flow
- operational tasks
- notifications
