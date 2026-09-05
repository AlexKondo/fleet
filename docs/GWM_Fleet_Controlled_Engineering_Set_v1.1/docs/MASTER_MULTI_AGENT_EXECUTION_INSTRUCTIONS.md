# MASTER MULTI-AGENT EXECUTION INSTRUCTIONS
## GWM Intelligent Fleet & Corporate Mobility Platform
### Autonomous Controlled Build Protocol v1.0

## 1. PURPOSE

These instructions govern the complete autonomous implementation of the GWM Intelligent Fleet & Corporate Mobility Platform by Kondo multi-agents.

The objective is to allow the agents to execute the entire approved MVP roadmap without requiring the product owner to manually authorize every implementation pack.

The system must remain controlled, auditable and compliant with the Product Baseline.

Agents are expected to:
- read the complete canonical documentation;
- plan dependencies;
- implement in controlled sequence;
- test each stage;
- self-review;
- repair defects;
- update documentation;
- proceed automatically when internal gates pass;
- stop only when a genuine product or architecture decision is missing.

---

# 2. CANONICAL SOURCE OF TRUTH

Before any implementation, the Orchestrator Agent must read:

1. docs/00_READ_FIRST.md
2. docs/PRODUCT_BASELINE.md
3. docs/MVP_SCOPE.md
4. docs/DECISION_LOG.md
5. docs/BUSINESS_RULES.md
6. docs/DOMAIN_MODEL.md
7. docs/STATE_MACHINES.md
8. docs/ACTORS_AND_PERMISSIONS.md
9. docs/SYSTEM_ARCHITECTURE.md
10. docs/DOMAIN_MODULE_BOUNDARIES.md
11. docs/EVENT_ARCHITECTURE.md
12. docs/API_CONTRACTS.md
13. docs/CONFIGURATION_CATALOG.md
14. docs/SECURITY_AND_PERMISSIONS.md
15. docs/TEST_STRATEGY.md
16. docs/GOLDEN_TEST_SCENARIOS.md
17. docs/IMPLEMENTATION_PACKS.md
18. docs/MULTI_AGENT_OPERATING_MODEL.md
19. all approved ADRs

Precedence if conflicts exist:

PRODUCT_BASELINE
> BUSINESS_RULES
> DOMAIN_MODEL
> STATE_MACHINES
> SECURITY_AND_PERMISSIONS
> API_CONTRACTS
> UX_JOURNEYS
> IMPLEMENTATION_PACKS
> code.

The agents must not use implementation convenience as justification to override higher-precedence documents.

---

# 3. AUTONOMOUS EXECUTION MODEL

The Product Owner does NOT need to manually authorize each IP.

The Orchestrator Agent must execute:

IP-000
→ IP-001
→ IP-002
→ IP-003
→ ...
→ IP-016

according to documented dependencies.

The Orchestrator may execute independent workstreams in parallel only when:
- they do not modify the same bounded-context files;
- their contracts are already stable;
- no downstream module depends on an unfinished upstream decision;
- merge conflicts are unlikely;
- QA can validate them independently.

Parallel execution must never violate domain or contract sequencing.

---

# 4. INTERNAL ENGINEERING GATES

Every implementation pack must pass an INTERNAL GATE before dependent work begins.

The gate is automatic and does not require Product Owner approval unless a Decision Needed exists.

## Gate requirements

The pack must satisfy:
- Definition of Ready;
- implementation complete;
- build successful;
- lint/static analysis successful;
- database migrations successful;
- unit tests successful;
- integration tests successful;
- API contract tests successful where applicable;
- authorization tests successful;
- state transition tests successful;
- audit requirements validated;
- applicable Golden Test Scenarios successful;
- architecture compliance review successful;
- QA Agent approval;
- documentation updated.

If any requirement fails:

DO NOT continue downstream.

The agents must:
1. diagnose;
2. repair;
3. rerun validation;
4. repeat until the gate passes.

---

# 5. WHEN TO STOP AND ASK THE PRODUCT OWNER

Agents must NOT ask the Product Owner questions that can be answered from existing documentation, code, configuration or reasonable technical implementation choices.

Agents must stop only when one of the following occurs:

## DV — Decision Needed

A product behavior is genuinely undefined and multiple materially different business outcomes are possible.

Create:

docs/decision-needed/DV-XXX.md

Include:
- issue;
- affected scenario;
- options;
- recommendation;
- product impact;
- architecture impact;
- data impact;
- test impact.

Do not implement speculative behavior.

## CR — Change Request

An approved baseline decision must be changed.

Create CR-XXX according to CHANGE_CONTROL.md.

## Architecture Blocker

A technical constraint makes the approved architecture infeasible or materially unsafe.

The Architecture Agent must document alternatives before escalating.

## External Dependency Blocker

A required credential, enterprise integration, secret, environment or infrastructure component is unavailable and no documented MVP adapter/stub can satisfy the requirement.

Otherwise, continue autonomously.

---

# 6. TECHNICAL DECISIONS AGENTS MAY MAKE WITHOUT ASKING

Agents may choose implementation details that do not alter product behavior, such as:
- library selection;
- internal class naming;
- folder-level implementation details;
- test framework details;
- ORM patterns;
- migration mechanics;
- background-job implementation;
- UI component composition;
- caching strategies;
- logging libraries;
- internal error mapping;
- CI configuration.

These decisions must:
- remain consistent with the approved architecture;
- avoid unnecessary vendor lock-in;
- avoid introducing hardware/telemetry dependency;
- preserve replaceability;
- be documented as ADRs when architecturally significant.

---

# 7. MANDATORY PRODUCT BEHAVIOR

Agents must preserve all approved decisions, including:

- platform is independent from other user projects;
- software-first MVP;
- no telemetry/OBD/tracker dependency;
- configurable booking modes:
  - AI_RECOMMENDED
  - USER_CHOICE
  - HYBRID
- trip-first user experience;
- carpool evaluation before incremental vehicle allocation;
- Trip-Specific Readiness;
- ICE/PHEV/BEV energy treatment;
- configurable BEV maximum round-trip policy;
- configurable range safety buffer;
- charging/fueling preparation logic;
- automatic/suggested reassignment when vehicle becomes unavailable;
- current parking location;
- independent Driver and Security inspections;
- no mandatory photos in normal checklist;
- mandatory photo when external damage is reported;
- operational workflows from checklist issues;
- Communication Hub as Core;
- delay impact analysis;
- Fleet Manager operational controls;
- CNH/driver authorization enforcement;
- auditability of critical actions;
- Employee Fleet Rental only as future architecture, not MVP.

---

# 8. NO-HARDCODING POLICY

Do not hardcode business policies defined in CONFIGURATION_CATALOG.md.

Configuration must drive at least:
- booking mode;
- carpool tolerances;
- BEV max round-trip without planned charging;
- range safety factor;
- low fuel threshold;
- low battery threshold;
- maintenance warning;
- no-show tolerance;
- return grace period;
- damage blocking severity;
- whether cleaning blocks vehicle;
- approval requirement;
- notification switches.

Default/sample values may be seeded but must remain editable.

---

# 9. DOMAIN-FIRST IMPLEMENTATION RULE

Implementation order within a feature:

Business Rule
→ Domain Model
→ State Transition
→ Domain Event
→ Application Service
→ Persistence
→ API Contract
→ UI
→ Tests
→ Observability.

Do not start from screen mocks and invent backend behavior from UI.

UI must reflect the approved domain.

---

# 10. STATE MACHINE INTEGRITY

No agent may update Vehicle, Reservation or OperationalTask state with ad hoc direct assignments outside authorized domain/application transition methods.

Invalid transitions must return INVALID_STATE_TRANSITION.

All important transitions must:
- validate preconditions;
- emit appropriate domain events;
- record audit when required;
- execute transactionally where necessary.

---

# 11. CONCURRENCY AND BOOKING SAFETY

Reservation creation must be concurrency-safe.

Two simultaneous requests must not successfully allocate the same vehicle for overlapping intervals.

The implementation must include:
- transactional conflict protection;
- database-level or equivalent locking/constraint strategy;
- race-condition tests;
- GT-015 validation.

---

# 12. MOBILITY INTELLIGENCE IMPLEMENTATION

The MVP Mobility Decision Engine must be deterministic and explainable.

Generative AI is optional for future experience layers but must not be required for correctness.

Pipeline:
1. validate trip;
2. validate driver;
3. search carpool;
4. collect eligible vehicles;
5. evaluate availability;
6. evaluate Trip-Specific Readiness;
7. evaluate energy/range;
8. evaluate passenger/cargo fit;
9. evaluate restrictions/conflicts;
10. score;
11. apply booking mode;
12. return recommendation and reasons.

Recommendation results must expose:
- eligibility;
- score/rank;
- reasons;
- rejection reasons where applicable.

---

# 13. ENERGY & RANGE SAFETY

Never treat nominal manufacturer range as guaranteed trip range.

MVP must rely on configured/recorded estimated usable range and safety policy.

For BEVs:
- evaluate current SOC;
- estimated usable range;
- round-trip distance;
- safety factor;
- configured BEV trip policy;
- available charging window.

If energy is insufficient:
- evaluate charging feasibility;
- if feasible, create/suggest CHARGING task and block required window;
- otherwise search reassignment.

PHEVs must consider both battery and fuel where available.

---

# 14. INSPECTION EXPERIENCE

The checklist must be operationally fast.

Normal flow:
- no mandatory photos.

External damage:
- at least one mandatory photo;
- guided framing may be offered;
- issue type/area/severity recorded;
- workflow/blocking evaluated.

Driver and Security records remain independent.

One actor's inspection must never overwrite the other's.

---

# 15. COMMUNICATION HUB BEHAVIOR

Communication Hub is operational, not social.

Message types must include:
- TEXT
- DELAY
- VEHICLE_ISSUE
- RETURN_TIME_CHANGE
- VEHICLE_NOT_FOUND
- SYSTEM_ALERT

Operational messages may trigger domain behavior.

Example:
DELAY
→ update expected return
→ detect conflict
→ mark future reservation IMPACTED
→ evaluate reassignment
→ notify next user and Fleet Manager.

Messages must not mutate unrelated business state without documented event handling.

---

# 16. SECURITY AND PRIVACY

All authorization must be server-side.

Requirements:
- RBAC;
- least privilege;
- protected CNH data;
- secure evidence storage;
- signed/private evidence access;
- upload validation;
- audit of critical actions;
- no sensitive values in logs;
- no secrets committed to repository.

Security Agent must review every pack touching:
- identity;
- authorization;
- uploads;
- audit;
- configuration;
- user data.

---

# 17. AUDIT REQUIREMENTS

Critical changes must be auditable.

At minimum:
- approval/rejection;
- reservation reassignment;
- vehicle block/unblock;
- inspection completion;
- damage report;
- evidence upload;
- driver authorization change;
- operational task completion/cancel;
- configuration changes;
- manual readiness override;
- manual current-location override.

Audit records are append-only from normal application flows.

---

# 18. API RULES

APIs must follow API_CONTRACTS.md.

Every endpoint must define:
- auth requirement;
- request schema;
- response schema;
- validation;
- error codes;
- state changes;
- emitted events;
- audit behavior;
- idempotency where relevant.

Do not expose persistence entities directly as public API contracts.

---

# 19. FRONTEND RULES

Frontend must:
- be mobile-first for Driver/Security workflows;
- keep check-in/check-out fast;
- clearly distinguish Available from Ready;
- display current vehicle location before pickup;
- explain vehicle recommendations;
- surface blocking issues before confirmation;
- show affected next reservation when delays occur where authorized;
- never rely on UI hiding as security.

---

# 20. TESTING AUTONOMY

QA Agent must continuously maintain:
- unit tests;
- integration tests;
- contract tests;
- state-machine tests;
- authorization tests;
- Golden Test Scenarios;
- regression tests.

No pack can self-declare Done without QA Agent review.

Golden scenarios GT-001 through GT-015 are mandatory before MVP completion.

---

# 21. SELF-REPAIR LOOP

For every failed gate:

FAIL
→ diagnose
→ determine owning agent
→ patch
→ targeted test
→ regression suite
→ architecture/security review if affected
→ rerun gate.

Agents must not simply mark known failures as TODO and continue if the failure affects MVP correctness.

---

# 22. DOCUMENTATION SYNCHRONIZATION

Code and canonical docs must remain synchronized.

When implementation reveals a technical detail:
- update engineering documentation where appropriate.

When implementation would alter product behavior:
- do not silently update Product Baseline;
- create DV or CR.

The final repository must represent the actual implemented system.

---

# 23. IMPLEMENTATION ROADMAP

Default controlled sequence:

IP-000 Engineering Foundation

IP-001 Identity & Driver Authorization

IP-002 Fleet Master & Locations

IP-003 Vehicle State & Availability

IP-004 Trip Request

IP-005 Reservation & Approval

IP-006 Mobility Decision Engine

IP-007 Carpool Matching

IP-008 Energy & Range Intelligence

IP-009 Check-out / Check-in

IP-010 Inspection Issues & Evidence

IP-011 Operational Workflow Engine

IP-012 Communication Hub

IP-013 Notifications

IP-014 Fleet Manager Dashboard

IP-015 Security/Gate Experience

IP-016 Golden E2E & MVP Hardening

The Orchestrator may parallelize safe independent sub-work only after upstream contracts are stable.

---

# 24. COMPLETION REPORTING

The Product Owner does not need a report after every IP.

Agents should maintain internal records under:

/docs/completion-reports/

Example:
IP-000_COMPLETION_REPORT.md
IP-001_COMPLETION_REPORT.md
...

These are engineering evidence, not approval gates requiring manual response.

Only surface them to the Product Owner:
- on request;
- when a DV/CR is needed;
- at major milestone;
- at final MVP completion.

---

# 25. MAJOR MILESTONES

Recommended external milestones:

## M0 — Foundation Ready
IP-000 completed.

No approval required unless blocker exists.

## M1 — Booking Core Ready
IP-001 through IP-005 completed.

## M2 — Intelligence Core Ready
IP-006 through IP-008 completed.

## M3 — Operations Core Ready
IP-009 through IP-013 completed.

## M4 — Experience Complete
IP-014 and IP-015 completed.

## M5 — MVP Candidate
IP-016 completed and all Golden Scenarios pass.

The Product Owner should only be interrupted at milestones if material findings exist.

---

# 26. FINAL MVP ACCEPTANCE PACKAGE

At M5, generate:

MVP_COMPLETION_REPORT.md

Must contain:
- delivered scope;
- deferred scope;
- architecture summary;
- implemented modules;
- database/migrations;
- APIs;
- screens;
- configuration catalog;
- security review;
- audit coverage;
- test coverage;
- all Golden Scenario results;
- known limitations;
- technical debt;
- unresolved DV/CR;
- deployment instructions;
- rollback instructions;
- seed/demo instructions;
- credentials/setup requirements;
- recommended post-MVP roadmap.

Also generate:

MVP_REQUIREMENTS_TRACEABILITY_MATRIX.md

Mapping:
Product Principle / BR / Journey / API / Module / Test / Status.

---

# 27. DEFINITION OF SUCCESS

The build is successful when:

- the complete approved MVP is implemented;
- no MVP behavior depends on telemetry/hardware;
- business rules are configuration-driven where required;
- state machines are enforced;
- double booking is prevented;
- Trip-Specific Readiness works;
- BEV/PHEV energy logic works;
- carpool works;
- inspections work without unnecessary photo friction;
- damage requires evidence;
- workflows are generated;
- Communication Hub affects operations correctly;
- Fleet Manager and Security flows work;
- authorization and audit are correct;
- all mandatory Golden Scenarios pass;
- documentation matches implementation.

---

# 28. FINAL ORCHESTRATOR DIRECTIVE

Read the full Controlled Engineering Set before coding.

Plan the complete dependency graph.

Execute autonomously.

Use internal gates.

Repair failures before proceeding.

Do not ask the Product Owner to approve routine technical progress.

Do not invent product rules.

Stop only for genuine DV/CR/architecture/external blockers.

Deliver the complete MVP and final traceability package.

## Product Principle
Right Vehicle. Right Trip. Right Time. Ready to Go.
