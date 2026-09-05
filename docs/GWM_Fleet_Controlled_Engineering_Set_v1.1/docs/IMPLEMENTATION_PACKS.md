# CONTROLLED IMPLEMENTATION PACKS

## IP-000 Engineering Foundation
- repo structure
- CI
- database
- migrations
- auth skeleton
- RBAC skeleton
- error model
- logging/correlation
- config service
- test harness
- domain event bus abstraction

## IP-001 Identity & Driver Authorization
## IP-002 Fleet Master & Locations
## IP-003 Vehicle State & Availability
## IP-004 Trip Request
## IP-005 Reservation & Approval
## IP-006 Mobility Decision Engine
## IP-007 Carpool Matching
## IP-008 Energy & Range Intelligence
## IP-009 Check-out / Check-in
## IP-010 Inspection Issues & Evidence
## IP-011 Operational Workflow Engine
## IP-012 Communication Hub
## IP-013 Notifications
## IP-014 Fleet Manager Dashboard
## IP-015 Security/Gate Experience
## IP-016 Golden E2E & MVP Hardening

## Rule
Do not start a dependent pack before its upstream contracts are stable.
Each IP should have its own:
- scope
- dependencies
- requirements
- acceptance criteria
- tests
- completion report
