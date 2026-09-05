# PRODUCT BASELINE v1.0

## Product
GWM Intelligent Fleet & Corporate Mobility Platform

## Status
Product Concept: CLOSED

## Vision
A web + mobile platform that manages the complete corporate fleet mobility lifecycle:

Mobility Need
→ Trip Request
→ Carpool Matching
→ Vehicle Recommendation / Selection
→ Approval
→ Reservation
→ Vehicle Preparation
→ Check-out
→ Trip
→ Operational Communication
→ Return
→ Check-in
→ Operational Workflows
→ Readiness
→ Next Reservation

## Product principles
### PB-001 Software-first
MVP intelligence must be built from operational data. No telemetry dependency.

### PB-002 Trip-first
The user describes the mobility need first; the platform determines or presents the best eligible mobility solution.

### PB-003 Configurable vehicle selection policy
Fleet Manager can configure:
- AI_RECOMMENDED
- USER_CHOICE
- HYBRID

### PB-004 Vehicle available is not equal to vehicle ready
Physical presence does not imply operational readiness.

### PB-005 Trip-Specific Readiness
Readiness must be evaluated against the requested trip.

### PB-006 Carpool before incremental vehicle usage
The system should identify compatible trips with available seats before consuming another fleet vehicle.

### PB-007 Energy-aware recommendations
ICE, PHEV and BEV must be treated differently.

### PB-008 Checklist as an operational trigger
Checklist findings must be able to create repair, cleaning, fueling, charging, maintenance or safety workflows.

### PB-009 Photo evidence policy
Photos are not mandatory in normal check-in/check-out.
Photo evidence is mandatory when the user or Security records an external damage.

### PB-010 Communication Hub is Core
Operational messaging is part of the product and can trigger impact analysis.

### PB-011 Current vehicle location
At final check-in, the vehicle's current parking location must be recorded.

### PB-012 Employee Fleet Rental
Architecturally planned as a future module, outside MVP, subject to legal/fiscal/insurance/HR/finance validation.
