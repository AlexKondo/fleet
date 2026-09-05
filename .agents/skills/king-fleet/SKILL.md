---
name: king-fleet
description: >
  Autonomous Gauntlet Loop for improving and repairing existing software systems.
  Reads the project's /docs as the initial source of truth, creates a technical
  baseline and approved scope, dispatches independent specialist Executors and
  Reviewers, coordinates parallel and sequential work, enforces evidence-based
  validation, and stops only after an independent Chief Reviewer and Completion
  Audit both pass.
---

# King-Fleet

## Mission

Use this skill when an existing software system needs functional fixes, UX improvements,
bug fixes, refactors, integration corrections, or related quality improvements.

The goal is not to redesign the product indiscriminately. The goal is to improve the
existing system safely and measurably, preserving approved behavior while fixing known
problems and improving the user experience.

The system must behave like a coordinated engineering organization:

- Orchestrator = operational brain
- Executors = implementers
- Reviewers = independent auditors
- Integration Reviewer = cross-system verifier
- Chief Reviewer = final system judge
- Completion Audit = final process integrity gate

Core principles:

1. Evidence over claims.
2. Executor never approves its own work.
3. Reviewer never edits the implementation it reviews.
4. Chief Reviewer is independent from all lower-level reviewers.
5. Approved scope is binding.
6. New opportunities are suggestions until explicitly approved.
7. Bugs should be reproduced before correction whenever technically possible.
8. Every meaningful change is traceable from issue -> task -> branch -> commit -> review -> evidence.
9. Parallelism is allowed only when dependencies and ownership permit it.
10. Do not stop merely because code compiles. Stop only when the final quality gates pass.

---

# 1. Mandatory bootstrap

Before changing production code:

1. Invoke the installed `using-superpowers` skill/workflow.
2. Inspect the repository and establish the working branch/worktree strategy.
3. Read ALL relevant files under `/docs`.
4. Do not modify application code during discovery.
5. Create a persistent `.king-fleet/` workspace.
6. Establish the Technical Baseline.
7. Run the existing test/build/typecheck/lint baseline when the environment permits.
8. Classify pre-existing failures instead of attributing them to future work.

The project's conversational context is never the authoritative state.
`.king-fleet/` is the operational memory for this run.

---

# 2. Operating model

The King-Fleet loop is:

DISCOVER
  -> BASELINE
  -> CONSOLIDATE ISSUES
  -> IMPACT ANALYSIS
  -> SPECIALIST ANALYSIS
  -> HUMAN APPROVAL
  -> APPROVED BASELINE
  -> TASK DECOMPOSITION
  -> DEPENDENCY GRAPH
  -> EXECUTION
  -> SELF-CHECK
  -> INDEPENDENT REVIEW
  -> REPAIR LOOP
  -> INTEGRATION
  -> REGRESSION
  -> CHIEF REVIEW
  -> COMPLETION AUDIT
  -> COMPLETE

If a reviewer fails a task, the work is not complete.

If the Chief Reviewer fails the system, the system is not complete.

If the Completion Audit fails, the system is not complete.

---

# 3. Source of truth and scope control

## 3.1 `/docs` is the initial input source

The Orchestrator must read all applicable files in `/docs`, not only filenames that appear relevant.

Create:

`.king-fleet/issues/master-issue-registry.md`

Normalize every issue into a stable ID:

- ISSUE-001
- ISSUE-002
- ...

Each issue must preserve its source files and relevant excerpts/references.

For each issue capture:

- source document(s)
- description
- expected behavior
- current behavior
- severity
- affected areas
- dependencies
- likely root cause
- acceptance criteria
- proposed solution
- risks
- status

## 3.2 Deduplication

If multiple documents describe the same problem:

- merge them into one logical issue;
- preserve all source references;
- do not silently discard conflicting details;
- flag conflicts for resolution.

## 3.3 Problem classes

Every item must be one of:

### BUG FIX
Incorrect existing behavior.

### APPROVED IMPROVEMENT
A user-experience or functional improvement explicitly included in the approved scope.

### OPPORTUNITY
A useful idea discovered during investigation but not necessary to complete the approved scope.

Opportunities are NOT implemented without approval.

## 3.4 New findings

During implementation:

- a problem directly caused by the approved task may be fixed;
- a regression caused by the current work must be investigated and corrected;
- an unrelated new bug must be recorded as a Change Request / Opportunity;
- a critical security, privacy, data-integrity, or destructive-risk finding must trigger a Human Gate before scope expands.

---

# 4. Technical Baseline

Create:

`.king-fleet/baseline/technical-baseline.md`

Record, as applicable:

- Git branch and clean/dirty status
- commit SHA
- repository structure
- frontend stack
- backend stack
- database
- API/integration surface
- authentication/authorization
- build system
- test framework
- lint/typecheck
- deployment configuration
- environment assumptions
- important shared files
- existing architectural patterns

Run baseline verification:

- application start
- build
- test suite
- lint
- typecheck
- database connectivity
- critical user flows
- API health

Classify failures:

- PRE-EXISTING
- ENVIRONMENT BLOCKER
- PROJECT DEFECT
- UNKNOWN

Never claim that future work caused a baseline failure that already existed.

Do not declare final PASS when mandatory validation was not actually executed unless the approved acceptance criteria explicitly allow that limitation.

---

# 5. Specialist model

Create 12 independent functional roles.

Each role has an Executor and an independent Reviewer.

## 5.1 Product / Requirements
Focus:
- requirement fidelity
- acceptance criteria
- scope
- business intent
- cross-feature consistency

## 5.2 UX / User Experience
Focus:
- task clarity
- friction
- information architecture
- empty/loading/error states
- copy and interaction design

## 5.3 UI / Visual
Focus:
- visual hierarchy
- spacing
- typography
- consistency
- responsiveness
- visual regressions

## 5.4 Frontend
Focus:
- components
- state
- routing
- client validation
- accessibility
- frontend/backend contracts

## 5.5 Backend
Focus:
- services
- business logic
- APIs
- validation
- error handling
- concurrency

## 5.6 Database
Focus:
- schema
- migrations
- integrity
- transactions
- indexes
- data compatibility
- rollback safety

## 5.7 Integration / API
Focus:
- contracts
- adapters
- external integrations
- event/data flow
- version compatibility

## 5.8 Security
Focus:
- authentication
- authorization
- tenant isolation
- injection
- secrets
- sensitive data
- abuse cases

## 5.9 QA / Testing
Focus:
- regression
- test coverage
- edge cases
- failure modes
- E2E confidence

## 5.10 Performance
Focus:
- latency
- expensive queries
- rendering
- bundle/runtime costs
- scalability risks

## 5.11 Accessibility
Focus:
- keyboard navigation
- focus behavior
- labels
- semantic structure
- contrast
- assistive technology compatibility

## 5.12 Final System Reviewer
Focus:
- whole-system behavior
- cross-module interactions
- end-to-end journeys
- release readiness

The Final System Reviewer is NOT the Chief Reviewer.

---

# 6. Analysis phase

After baseline, dispatch specialist analysis agents.

They may work in parallel because they are analyzing rather than modifying implementation.

Each specialist must produce:

- relevant issues
- affected components
- possible root causes
- dependencies
- risks
- proposed improvements
- inconsistencies
- tests needed
- open questions
- opportunities

Specialists must distinguish facts from hypotheses.

No specialist may silently turn an Opportunity into an approved requirement.

The Orchestrator consolidates findings into:

`.king-fleet/plans/proposed-plan.md`

The user must approve this plan before implementation starts.

---

# 7. Human Approval Gate

Present the user with:

- issues to be fixed
- intended changes
- important architectural impacts
- database implications
- UX implications
- proposed additional improvements
- risks
- opportunities discovered
- items explicitly NOT being implemented

The plan becomes:

`.king-fleet/plans/approved-plan.md`

Once approved, work continues autonomously unless a Human Gate is triggered.

---

# 8. Human Gates

Stop and ask for approval only for:

1. destructive or irreversible operations;
2. production deployment or publication;
3. material scope expansion;
4. substantial architecture changes not in the approved plan;
5. structural database changes with meaningful data-loss risk;
6. critical security decisions not covered by the approved plan;
7. unresolved requirement conflicts;
8. an environment blocker that prevents safe continuation;
9. repeated failure where the only viable next step requires a product/architecture decision outside the approved baseline.

Routine implementation choices must not cause unnecessary stalls.

Record every non-trivial autonomous ruling:

`Ruling: <decision> — <reason> — <risk if wrong>`

Store them in `.king-fleet/ledger.md`.

---

# 9. Task decomposition

The Orchestrator converts approved issues into implementation tasks.

Each task must have:

- task ID
- issue IDs
- function owner
- executor role
- reviewer role
- objective
- acceptance criteria
- files/components likely affected
- dependencies
- tests
- validation method
- expected evidence
- risk

Use the smallest sensible task boundary.

Do not split a tightly coupled change into artificial micro-tasks.

Create:

`.king-fleet/tasks/task-registry.md`

---

# 10. Dependency Graph

Before execution, create a dependency graph.

Tasks may run in parallel when:

- they touch independent areas;
- their interfaces are stable;
- they do not compete for the same files;
- there is no unresolved data migration dependency;
- their branches/worktrees are isolated.

Tasks must run sequentially when:

- one changes an interface consumed by another;
- one requires a database migration before another can safely implement;
- both require the same shared artifact and coordination is insufficient;
- integration order matters.

Prefer safe parallelism over maximum parallelism.

---

# 11. Agent communication and ownership

Agents are allowed to communicate directly when necessary.

The Orchestrator remains authoritative for:

- scope
- task state
- dependencies
- conflicts
- ownership
- integration
- escalation

Use:

`.king-fleet/coordination/ownership.md`

For every shared file or critical interface record:

- current owner
- active task
- expected change
- dependent agents
- lock/coordination status

An agent must NOT silently overwrite another agent's active work.

Before editing a shared file:

1. inspect ownership;
2. announce intended change;
3. inspect current contract;
4. coordinate affected agents;
5. integrate deliberately.

Communication that affects behavior, contracts, files, database, or architecture must be recorded.

---

# 12. Git isolation and traceability

Use Git branches/worktrees as the default.

Branch format:

`king-fleet/issue-<id>-task-<id>`

Every meaningful task must have a dedicated commit.

Commit traceability must connect:

ISSUE
 -> TASK
 -> AGENT
 -> BRANCH/WORKTREE
 -> COMMIT
 -> REVIEW
 -> EVIDENCE
 -> INTEGRATION

Commit messages should be specific, for example:

- `fix: prevent duplicate approval`
- `feat: improve user search feedback`
- `test: cover approval concurrency`
- `fix: preserve existing API contract`

Executors must not push directly to shared/main branches unless explicitly authorized.

The Orchestrator controls integration.

Destructive Git commands require a Human Gate.

---

# 13. TDD / verification discipline

Invoke the installed `using-superpowers` workflow when applicable.

For behavioral bug fixes:

1. reproduce the bug;
2. write a regression test;
3. verify the test fails for the intended reason;
4. implement the minimal correct fix;
5. verify it passes;
6. run related regression tests;
7. refactor only after green.

For new approved behavior:

1. define acceptance criteria;
2. create appropriate tests;
3. implement;
4. verify;
5. review.

Purely visual/configuration changes may use proportionate validation instead of artificial unit tests.

Never change a test merely to make a broken implementation pass unless the requirement itself has changed and the change is approved.

---

# 14. Triple Validation Gate

Every applicable task must pass:

## Level 1 — Automated checks

Depending on the change:

- unit
- integration
- API/contract
- database/migration
- lint
- typecheck
- build

## Level 2 — Running application

Start the application and verify the real integrated behavior when practical.

## Level 3 — User-flow verification

Use the installed `playwright` skill/tooling for browser workflows when applicable.

When Playwright is used:

- prefer visible/headed browser execution so human observers can see the agent's actions;
- use realistic user journeys;
- inspect success and error states;
- capture screenshots for critical evidence;
- preserve trace/video on failure when supported;
- inspect console/network failures when relevant.

A passing unit test alone is not sufficient to call a web feature complete.

---

# 15. Executor contract

Every Executor must:

1. read its task brief;
2. inspect current code;
3. respect ownership;
4. communicate dependency changes;
5. write tests first when applicable;
6. implement only approved scope;
7. run validation;
8. self-review the diff;
9. create a traceable commit;
10. produce an execution report;
11. produce evidence.

The Executor must NEVER approve itself.

---

# 16. Reviewer contract

Each Reviewer is independent from the Executor.

A Reviewer must NOT rely solely on the Executor report.

The Reviewer inspects:

- requirements
- implementation
- tests
- runtime behavior
- integration
- regressions
- UX
- security implications
- edge cases

When applicable, the Reviewer must use the real running application and Playwright.

Reviewer verdict:

`PASS` or `FAIL`

Findings use:

- P0 — blocker / catastrophic
- P1 — critical
- P2 — important
- P3 — minor/non-blocking

PASS requires:

- no P0
- no P1
- no P2
- no unresolved material regression
- required evidence present

P3 findings may remain only when genuinely non-blocking and explicitly recorded.

A reviewer may not “offset” a P1/P2 with many successful checks.

---

# 17. Repair Loop

On FAIL:

1. record findings;
2. classify severity;
3. group independent findings;
4. assign repair work;
5. avoid file conflicts;
6. correct root causes;
7. rerun tests;
8. regenerate evidence;
9. send to an independent reviewer;
10. continue until PASS.

Use fresh review context after repair whenever practical.

Never let the Reviewer directly edit the implementation.

If repeated rounds do not improve the result:

- diagnose why;
- change strategy;
- increase model capability for difficult judgment tasks;
- reconsider the architecture if evidence supports it;
- trigger a Human Gate only if the next decision exceeds approved scope.

Do not use arbitrary low round limits that cause premature acceptance.

Do not permit an infinite blind loop.

---

# 18. Integration Gate

Only approved work may be integrated.

Before integration:

- reviewer PASS;
- clean task tests;
- branch is traceable;
- ownership conflicts resolved;
- contracts reviewed;
- migration impact reviewed;
- dependencies satisfied.

After integration:

- affected tests
- integration tests
- regression tests
- build

If regression appears:

REGRESSION
 -> reproduce
 -> create regression test
 -> identify introducing task/commit
 -> decide repair vs controlled rollback
 -> repair
 -> review
 -> reintegrate
 -> regression verification

Record regressions in:

`.king-fleet/reviews/regressions.md`

Never hide a regression by weakening the test.

---

# 19. Evidence Package

Every meaningful task must produce:

`.king-fleet/evidence/ISSUE-<id>/TASK-<id>/`

Include as applicable:

- before behavior
- after behavior
- test output
- screenshots
- Playwright trace
- video on failure
- logs
- API evidence
- database verification
- commit SHA
- reviewer verdict

Minimum evidence should demonstrate:

BEFORE
 -> PROBLEM REPRODUCED
 -> IMPLEMENTATION
 -> AFTER
 -> AUTOMATED VERIFICATION
 -> USER-FLOW VERIFICATION
 -> REVIEW PASS

Use evidence to support claims; do not write unsupported success statements.

---

# 20. Chief Reviewer

The Chief Reviewer is an independent agent.

It is not:

- the Orchestrator;
- any Executor;
- any task Reviewer.

It receives the complete evidence set but does not blindly trust it.

It must independently inspect the final system.

It should review:

## Functional
- all approved issues resolved
- acceptance criteria satisfied
- critical journeys working

## UX
- confusing flows corrected
- states are understandable
- error handling useful
- no obvious new friction

## Technical
- architecture coherent
- contracts consistent
- code quality acceptable
- dependencies correct

## Database
- schema coherent
- migrations sound
- integrity preserved

## Security
- authorization correct
- sensitive flows protected
- no critical known vulnerability introduced

## Integration
- frontend/backend/database work together
- no partial integrations remain

## Testing
- relevant tests pass
- regressions covered
- E2E evidence exists where applicable

## Runtime
- real application works
- browser workflows work where applicable
- console/network failures investigated

## Visual / Accessibility
- UI remains coherent
- responsive behavior checked where applicable
- keyboard/focus/basic accessibility checked

The Chief Reviewer must be capable of using the running system and Playwright.

It may issue:

`PASS` or `FAIL`

A Chief Reviewer PASS does NOT override a failed required gate.

---

# 21. Definition of Perfect

"Perfect" means:

- approved scope is implemented;
- material requirements are satisfied;
- no P0/P1/P2 findings remain;
- critical regressions are absent;
- required tests pass;
- user-facing workflows work;
- security requirements are satisfied;
- data integrity is preserved;
- integrations are coherent;
- evidence exists;
- changes are traceable;
- no unauthorized Opportunity was implemented.

Perfection does not mean zero cosmetic imperfections.
It means no known material blocker remains against the approved definition of done.

---

# 22. Completion Audit

After Chief Reviewer PASS, run:

`.king-fleet/final/completion-audit.md`

The Completion Audit verifies:

- every approved issue has a status;
- every approved task completed or was explicitly re-scoped with approval;
- no reviewer is pending;
- no P0/P1/P2 remains;
- commits are traceable;
- all required branches were integrated;
- tests were actually executed;
- Playwright evidence exists where applicable;
- evidence packages exist;
- approved scope was respected;
- opportunities remain unimplemented unless approved;
- ledger is current;
- final baseline-to-head trace is valid;
- final report is complete.

If the audit fails, work returns to the Orchestrator and the loop continues.

Only when both are true may the run conclude:

`CHIEF REVIEWER = PASS`
and
`COMPLETION AUDIT = PASS`

Then mark:

`COMPLETE`

---

# 23. Persistent workspace

Recommended structure:

.king-fleet/
├── baseline/
│   └── technical-baseline.md
├── issues/
│   └── master-issue-registry.md
├── plans/
│   ├── proposed-plan.md
│   └── approved-plan.md
├── tasks/
│   ├── task-registry.md
│   └── task-*.md
├── agents/
│   ├── product/
│   ├── ux/
│   ├── ui/
│   ├── frontend/
│   ├── backend/
│   ├── database/
│   ├── integration/
│   ├── security/
│   ├── qa/
│   ├── performance/
│   └── accessibility/
├── coordination/
│   ├── ownership.md
│   └── messages.md
├── reviews/
│   ├── task-*-review.md
│   ├── regressions.md
│   └── integration-review.md
├── evidence/
│   └── ISSUE-*/
├── final/
│   ├── chief-review.md
│   ├── completion-audit.md
│   └── final-engineering-report.md
└── ledger.md

---

# 24. Final Engineering Report

Generate:

`.king-fleet/final/final-engineering-report.md`

Include:

- final status
- approved scope
- completed issues
- deferred opportunities
- architectural decisions
- changes by function
- test results
- E2E/Playwright results
- regressions found and resolved
- security verification
- database verification
- integration verification
- commits
- evidence locations
- remaining limitations
- rulings/decisions
- Chief Reviewer result
- Completion Audit result

The report must be factual and evidence-backed.

---

# 25. Model selection

Use the least capable model that can reliably perform the role.

Guideline:

- mechanical, isolated edits -> fast model;
- multi-file implementation/debugging -> standard model;
- architecture, security judgment, integration reasoning, Chief Review -> strongest available model;
- difficult repeated repair loops -> escalate capability.

Always prefer the model whose judgment is sufficient for the risk.

---

# 26. Anti-patterns

Never:

- modify code before Discovery and approval;
- let Executor approve itself;
- let Reviewer edit what it reviews;
- silently expand scope;
- overwrite another agent's active file;
- claim success without evidence;
- weaken tests to hide defects;
- ignore pre-existing failures;
- stop after the first successful test;
- stop after a local fix without integration verification;
- declare success because the UI "looks fine" without functional verification;
- leave untracked half-integrated work;
- implement unapproved opportunities;
- use destructive Git/database operations without the required gate.

---

# 27. Final behavior

When invoked on an existing project:

1. discover;
2. baseline;
3. read and consolidate `/docs`;
4. analyze with 12 specialists;
5. present approved plan;
6. create dependency graph;
7. execute with coordinated parallelism;
8. test;
9. review independently;
10. repair until reviewed PASS;
11. integrate safely;
12. run regression;
13. run full-system review;
14. Chief Reviewer decides;
15. Completion Audit verifies process integrity;
16. only then finish.

The system does not finish because an agent says it is done.

It finishes because independent evidence demonstrates that it is done.
