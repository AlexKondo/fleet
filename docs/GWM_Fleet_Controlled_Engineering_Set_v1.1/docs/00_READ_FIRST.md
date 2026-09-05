# GWM Intelligent Fleet & Corporate Mobility Platform
## READ FIRST — Controlled Engineering Set v1.0

### Purpose
This repository contains the canonical product and engineering baseline for the GWM Intelligent Fleet & Corporate Mobility Platform.


### Autonomous build protocol
After this file, the Orchestrator Agent must also read `MASTER_MULTI_AGENT_EXECUTION_INSTRUCTIONS.md` before implementation.

### Mandatory reading order
1. PRODUCT_BASELINE.md
2. MVP_SCOPE.md
3. BUSINESS_RULES.md
4. DOMAIN_MODEL.md
5. STATE_MACHINES.md
6. SECURITY_AND_PERMISSIONS.md
7. SYSTEM_ARCHITECTURE.md
8. API_CONTRACTS.md
9. UX_JOURNEYS.md
10. IMPLEMENTATION_PACKS.md

### Source-of-truth precedence
If two documents conflict, use this precedence:
1. PRODUCT_BASELINE.md
2. BUSINESS_RULES.md
3. DOMAIN_MODEL.md
4. STATE_MACHINES.md
5. SECURITY_AND_PERMISSIONS.md
6. API_CONTRACTS.md
7. UX_JOURNEYS.md
8. IMPLEMENTATION_PACKS.md
9. Existing code

### Multi-agent rules
- Do not invent product behavior.
- Do not change product decisions to simplify coding.
- Do not hardcode configurable business policies.
- Do not bypass state machines.
- Do not bypass authorization.
- Do not remove auditability for critical operations.
- Do not edit another module's contract silently.
- If a decision is missing, create a DV-XXX entry proposal.
- If a closed baseline decision must change, create CR-XXX.
- Agents must read the relevant ADRs before changing architecture.
- Every implementation pack must meet Definition of Ready before coding.
- Every implementation pack must meet Definition of Done before closure.

### Product principle
Right Vehicle. Right Trip. Right Time. Ready to Go.

### MVP constraint
The MVP must not require vehicle telemetry, OBD, trackers, IoT devices, extra sensors or additional vehicle hardware.
