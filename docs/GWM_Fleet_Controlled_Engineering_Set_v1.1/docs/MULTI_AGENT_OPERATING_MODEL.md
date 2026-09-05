# MULTI-AGENT OPERATING MODEL

## Roles
### Architecture Agent
Owns architecture consistency and ADR review.

### Domain Agent
Owns entities, value objects, rules and state machines.

### Backend Agent
Owns application services, APIs, persistence and domain event wiring.

### Frontend Agent
Owns UX implementation against approved contracts.

### Intelligence Agent
Owns recommendation, readiness, carpool, range and reassignment logic.

### Workflow Agent
Owns inspection, issues and operational tasks.

### Communication Agent
Owns Communication Hub and notification integrations.

### Security Agent
Reviews authz, uploads, data exposure and audit requirements.

### QA Agent
Validates acceptance criteria and golden scenarios.

## Concurrency rule
Avoid multiple agents editing the same file/module simultaneously.

## Cross-module change
1. Create change proposal
2. Architecture review
3. Update contracts/docs
4. Implement affected modules
5. Run regression tests

## Missing decision
Create DV-XXX rather than inventing behavior.
