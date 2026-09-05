# PRODUCT BASELINE DELTA v1.1
## Approved Remediation Additions / Refinements

These items are approved deltas arising from user validation.

### PD-001 — HEV
Powertrain taxonomy is now:
ICE | HEV | PHEV | BEV.

### PD-002 — Vehicle Color
Vehicle has a color attribute used for physical identification.

### PD-003 — Electric Range
PHEV and BEV operational views capture/display Electric Range in addition to Battery SOC.

### PD-004 — Site-Scoped Locations
Parking/charging locations belong to a Site/Facility and operational users see context-valid locations.

### PD-005 — CNH Evidence Lifecycle
Driver authorization requires CNH evidence. Expiry blocks driving automatically. Renewal requires new evidence and Fleet Manager release after validation.

### PD-006 — Model-Specific Safety Equipment
Required equipment is configured by vehicle model, not globally.

### PD-007 — Carpool Host Acceptance
Carpool is no longer confirmed solely by passenger acceptance. Flow:
Candidate Found -> Passenger Requests Ride -> Host Driver Accepts/Rejects -> Seat Confirmed or Request Rejected.

### PD-008 — Circulation Restriction Engine
São Paulo rodízio/restriction behavior is rule/configuration-driven, using trip context, date/day, plate ending and applicability policy.

### PD-009 — Temporal Integrity
User-entered trip date/time is immutable through recommendation evaluation unless the user explicitly edits it.

### PD-010 — Fuel Operational Bands
Operational fuel capture uses:
FULL | THREE_QUARTERS | HALF | ONE_QUARTER | RESERVE.
