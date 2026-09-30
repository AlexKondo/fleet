# FLEET VOICE & CONVERSATIONAL UX --- INCREMENTAL IMPLEMENTATION PACK v1.0

**Project:** GWM Intelligent Fleet & Corporate Mobility Platform\
**Package Type:** Incremental / Mandatory Reconciliation Addendum\
**Status:** APPROVED FOR IMPLEMENTATION\
**Purpose:** Incorporate Voice-First and Conversational UX into the
current Fleet baseline without creating a parallel product, duplicating
business logic, or breaking the corrected Product/UX/Engineering
architecture.

------------------------------------------------------------------------

## 0. READ FIRST --- EXECUTION INSTRUCTION FOR KONDO

This package is an **incremental implementation package**. It MUST be
reconciled with the latest corrected Fleet & Mobility documentation
before coding.

### Mandatory execution rule

Kondo must:

1.  Read the current Fleet corrected baseline and this addendum before
    modifying code.
2.  Treat this document as an extension of the existing Fleet Product
    Baseline, UX standards, architecture, APIs, security, RBAC,
    internationalization, tests and deployment rules.
3.  **Do not rebuild the Fleet platform from scratch.**
4.  **Do not create a separate Voice application or separate Voice
    business engine.**
5.  Reuse the existing Fleet Core, Reservation Engine, Vehicle
    Eligibility/Recommendation Engine, policy rules, RBAC, audit trail,
    notification layer and integrations.
6.  Voice/Conversational UX must be implemented as an additional
    interaction channel over the same application services and domain
    rules.
7.  Reconcile existing frontend flows so that voice and touch/forms
    coexist and produce the same validated domain commands.
8.  Preserve all previously approved Fleet rules unless explicitly
    changed by this addendum.
9.  Execute regression, functional, UX, security and conversational
    tests defined in this package.
10. Produce an implementation completion report identifying:

-   files/modules changed;
-   migrations created;
-   APIs/endpoints changed or added;
-   tests created;
-   tests executed and results;
-   unresolved risks;
-   screenshots/evidence of key UX flows;
-   confirmation that existing Fleet functionality remains operational.

### Non-negotiable product principle

> **Voice is an interface to Fleet Core --- not a second Fleet system.**

All business decisions remain deterministic and governed by the existing
Fleet domain.

------------------------------------------------------------------------

# 1. OBJECTIVE

Add a lightweight, intuitive, mobile-oriented conversational experience
that allows users to interact with Fleet using natural language,
especially voice.

The target experience is:

**Speak → Understand → Validate → Apply Fleet Rules → Propose/Execute →
Confirm**

Example:

> "Preciso de um carro amanhã às 8h para ir para São Paulo. Volto às 17h
> e vamos em três pessoas."

The platform should extract the relevant information, validate it
against Fleet rules and availability, recommend or present an eligible
vehicle according to configured policy, summarize the intended
transaction and request confirmation when required.

The user should not need to know the platform's menu structure to
accomplish common Fleet tasks.

------------------------------------------------------------------------

# 2. PRODUCT PRINCIPLES

The following become mandatory Fleet UX principles:

-   **Mobile-First**
-   **Voice-First + Touch-First**
-   **AI-Assisted, not AI-uncontrolled**
-   **Minimum Input**
-   **Zero Unnecessary Typing**
-   **Progressive Disclosure**
-   **Context-Aware Conversation**
-   **One Question at a Time**
-   **No Duplicate Data Entry**
-   **Deterministic Business Rules**
-   **Human Confirmation for Relevant Transactions**
-   **Graceful Fallback**
-   **Accessibility**
-   **Multilingual Architecture**
-   **Full Auditability**

Voice must reduce friction, not add complexity.

------------------------------------------------------------------------

# 3. SCOPE

## 3.1 Included in this increment

### A. Voice entry point

Mobile/responsive interface with a prominent action such as:

**"Falar com Fleet"**

The interface must support: - tap to start; - listening state; -
processing state; - understood/transcribed content; - clarification; -
proposed action; - confirmation; - success; - failure/recovery.

### B. Text conversational entry

The same conversational engine must also accept typed natural language.

Voice and text converge into the same intent-processing pipeline.

### C. Conversational reservation

Creation of vehicle reservations from natural language.

### D. Reservation management

Natural-language modification, extension and cancellation.

### E. Operational questions/actions

Support selected Fleet operational intents.

### F. Context preservation

Maintain context during the active conversation so users do not
repeatedly provide already-known information.

### G. Confirmation layer

Require explicit confirmation for transactional actions according to the
risk matrix in this package.

### H. Audit trail

Record relevant conversational transaction metadata without
unnecessarily storing sensitive raw audio.

------------------------------------------------------------------------

# 4. OUT OF SCOPE / DO NOT DO

Do NOT:

-   create an independent Voice backend containing duplicated Fleet
    rules;
-   allow an LLM to directly write reservation records;
-   allow an LLM to bypass RBAC;
-   allow an LLM to decide vehicle eligibility independently from Fleet
    rules;
-   allow voice to bypass approval workflows;
-   make voice mandatory;
-   remove touch/form alternatives;
-   require users to speak fixed commands;
-   expose raw internal prompts, model reasoning or technical errors;
-   automatically perform destructive/high-impact actions when intent
    confidence is insufficient;
-   silently guess missing critical data;
-   mix this platform with Trust Platform, Trust Mobility or GWM
    Mobility/Fretado.

------------------------------------------------------------------------

# 5. TARGET USER EXPERIENCE

## 5.1 Home experience

The mobile Home should prioritize a simple conversational entry.

Example conceptual hierarchy:

**Olá, \[Nome\]. O que você precisa?**

**\[ 🎙 Falar com Fleet \]**

Secondary quick actions: - Reservar veículo - Minhas reservas - Meu
veículo - Reportar ocorrência

The traditional navigation remains available but is not required for
routine tasks.

------------------------------------------------------------------------

# 6. REFERENCE CONVERSATIONAL FLOWS

## 6.1 Complete reservation request

User:

> "Preciso de um carro amanhã às 8h para São Paulo e volto às 17h. Vamos
> em três pessoas."

System: 1. Speech-to-Text. 2. Extract intent `CREATE_RESERVATION`. 3.
Extract entities. 4. Normalize date/time. 5. Validate mandatory
information. 6. Apply Fleet eligibility and policy rules. 7. Check
availability. 8. Run existing vehicle recommendation logic. 9. Present
transaction summary. 10. Ask for confirmation. 11. Execute reservation
only after confirmation. 12. Return reservation identifier/status.

Example confirmation:

> Entendi: - Saída: amanhã, 08:00 - Retorno: 17:00 - Destino: São
> Paulo - Pessoas: 3 - Veículo recomendado: H6 PHEV35
>
> Confirmar reserva?

Actions: **Confirmar** \| **Alterar**

------------------------------------------------------------------------

## 6.2 Missing information

User:

> "Reserve um carro amanhã para São Paulo."

The system must identify only the missing required information and ask
the minimum necessary follow-up.

Example:

> "Qual horário de saída?"

After answer:

> "08:00."

The system retains: - tomorrow; - São Paulo; - CREATE_RESERVATION;

and adds: - 08:00.

It must NOT ask the user to restart.

------------------------------------------------------------------------

## 6.3 Correction

User:

> "Na verdade volto às 19h."

The system updates only `return_time`, recalculates
availability/eligibility if necessary and presents the revised summary.

------------------------------------------------------------------------

## 6.4 Ambiguous destination

User:

> "Vou para São Paulo."

If the exact destination is required by Fleet rules and cannot safely be
inferred:

> "Qual será o destino em São Paulo?"

Do not invent an address.

------------------------------------------------------------------------

## 6.5 Vehicle need expressed naturally

User:

> "Preciso levar umas caixas para São Paulo."

The conversational layer can extract a cargo requirement.

It then sends structured requirements to the existing Fleet
Recommendation Engine.

The AI must NOT independently decide "use Poer P30" outside the Fleet
recommendation/policy engine.

------------------------------------------------------------------------

# 7. INTENT CATALOG --- RELEASE 1

Implement the architecture to support extensible intents. The first
controlled catalog is:

  -------------------------------------------------------------------------------------------
  Intent                         Purpose                              Transactional
  ------------------------------ ------------------------------------ -----------------------
  `CREATE_RESERVATION`           Create reservation                   Yes

  `CHANGE_RESERVATION`           Change                               Yes
                                 date/time/destination/requirements   

  `EXTEND_RESERVATION`           Extend current/upcoming reservation  Yes

  `CANCEL_RESERVATION`           Cancel reservation                   Yes

  `VIEW_RESERVATION`             Retrieve reservation information     No

  `FIND_MY_VEHICLE`              Show recorded vehicle                No
                                 location/status                      

  `CHECK_VEHICLE_AVAILABILITY`   Query availability                   No

  `CHECK_RANGE`                  Evaluate range/energy suitability    No

  `REQUEST_DIFFERENT_VEHICLE`    Request alternative eligible vehicle Potentially

  `REPORT_DAMAGE`                Start damage/occurrence workflow     Yes

  `REPORT_DELAY`                 Report expected delay                Yes

  `START_TRIP`                   Trigger allowed trip-start workflow  Yes

  `END_TRIP`                     Trigger allowed trip-end workflow    Yes

  `ASK_FLEET`                    Ask contextual operational Fleet     No
                                 question                             
  -------------------------------------------------------------------------------------------

The implementation must allow new intents without redesigning the
conversational architecture.

------------------------------------------------------------------------

# 8. ENTITY / SLOT MODEL

For reservation-related conversations, support at minimum:

-   `departure_date`
-   `departure_time`
-   `return_date`
-   `return_time`
-   `origin`
-   `destination`
-   `passenger_count`
-   `trip_purpose`
-   `cargo_requirement`
-   `special_requirement`
-   `preferred_vehicle`
-   `reservation_id`
-   `current_vehicle_id`

Derived/contextual data may include: - authenticated user; - user's
permitted locations; - corporate policy; - fleet configuration; -
vehicle availability; - vehicle location; - vehicle status; -
maintenance block; - autonomy/range; - energy/fuel status; - São Paulo
rotation restrictions where applicable; - approval requirement.

Do not ask users for information already reliably available from
authenticated context.

------------------------------------------------------------------------

# 9. ARCHITECTURE

## 9.1 Required logical flow

``` text
Mobile/Web UI
     |
Voice Capture / Text Input
     |
Speech-to-Text (voice only)
     |
Conversational Orchestrator
     |
Intent + Entity Extraction
     |
Context Manager
     |
Validation / Clarification Layer
     |
Fleet Application Service / Command Layer
     |
Existing Fleet Domain Rules
     |---- Reservation Engine
     |---- Availability Engine
     |---- Vehicle Eligibility
     |---- Recommendation Engine
     |---- Policy Engine
     |---- Approval Workflow
     |---- Maintenance / Block Rules
     |---- Range / Energy Rules
     |---- RBAC
     |
Transactional Confirmation
     |
Execution
     |
Audit + Notification + UI Response
```

## 9.2 Critical separation

The LLM/conversational model may: - understand natural language; -
extract intent/entities; - generate clarification wording; - summarize a
proposed action; - translate conversational responses.

It may NOT: - directly insert/update/delete Fleet domain records; -
override policy; - override availability; - override approval; -
override RBAC; - independently authorize vehicle assignment; -
manufacture unavailable data.

All mutations must go through controlled Fleet application/domain
services.

------------------------------------------------------------------------

# 10. CANONICAL COMMAND CONTRACT

Conversational input must be converted into a validated internal command
before reaching the domain.

Example conceptual structure:

``` json
{
  "intent": "CREATE_RESERVATION",
  "actorId": "<authenticated-user>",
  "conversationId": "<id>",
  "slots": {
    "departureDateTime": "<normalized>",
    "returnDateTime": "<normalized>",
    "origin": "<resolved-location>",
    "destination": "<resolved-location>",
    "passengerCount": 3,
    "tripPurpose": "<optional>",
    "cargoRequirement": "<optional>"
  },
  "source": "VOICE",
  "requiresConfirmation": true
}
```

This is a conceptual contract. Kondo must reconcile naming and types
with the existing Fleet codebase rather than creating conflicting
duplicate DTOs/entities.

------------------------------------------------------------------------

# 11. CONVERSATION STATE MACHINE

At minimum:

``` text
IDLE
  ↓
LISTENING / INPUT
  ↓
TRANSCRIBING
  ↓
UNDERSTANDING
  ↓
VALIDATING
  ├── MISSING_DATA → CLARIFYING → VALIDATING
  ├── INVALID → RECOVERY
  └── VALID
        ↓
DOMAIN_CHECK
        ↓
PROPOSAL
        ↓
AWAITING_CONFIRMATION
        ├── MODIFY → VALIDATING
        ├── CANCEL → IDLE
        └── CONFIRM
              ↓
EXECUTING
              ├── SUCCESS
              └── FAILURE / RECOVERY
```

Frontend must expose clear states rather than displaying a generic
spinner for the whole process.

------------------------------------------------------------------------

# 12. CONFIRMATION POLICY

## Confirmation required

Always require explicit confirmation before: - creating reservation; -
changing reservation; - extending reservation; - cancelling
reservation; - changing assigned vehicle where it changes the
transaction; - starting/ending trip if this action has operational
consequences; - submitting damage/occurrence; - any action requiring
approval or producing a persistent operational change.

## Confirmation not normally required

Read-only questions such as: - "Qual carro está reservado para mim?" -
"Onde está meu veículo?" - "Que horas tenho que devolver?" - "Tenho
reserva amanhã?"

The confirmation screen must show the relevant interpreted parameters.

------------------------------------------------------------------------

# 13. CONFIDENCE & AMBIGUITY

The system must use controlled confidence handling.

### High confidence

Continue to domain validation.

### Medium confidence

Present interpreted information or ask a focused clarification.

### Low confidence

Do not execute. Ask user to repeat/rephrase or switch to touch/text.

Never hide uncertainty behind a confident response.

Critical fields such as date, time, destination, reservation identity
and destructive actions must receive stricter validation.

------------------------------------------------------------------------

# 14. ZERO UNNECESSARY TYPING

The platform should infer/reuse information when reliable, including: -
authenticated user identity; - organizational permissions; - known Fleet
site; - active reservation; - currently assigned vehicle; - policy
mode; - vehicle status; - previously stated information in the same
conversation.

Do not make the user manually re-enter data the system already
possesses.

However, inference must not silently replace required confirmation for a
material assumption.

------------------------------------------------------------------------

# 15. FLEET POLICY INTEGRATION

Conversational UX must fully respect existing Fleet rules, including:

-   **AI Recommended Vehicle** versus **User Choice** configurable
    policy;
-   vehicle eligibility;
-   vehicle availability;
-   passenger/capacity requirements;
-   cargo requirements;
-   trip distance;
-   BEV autonomy and charging feasibility;
-   preference for BEV where applicable under existing approved rules;
-   PHEV logic;
-   São Paulo diesel rotation restrictions;
-   maintenance/revision blocks;
-   vehicle location;
-   current/next reservation conflict;
-   approval rules;
-   user permissions;
-   operational blocks.

Voice does not supersede any of these.

------------------------------------------------------------------------

# 16. DAMAGE / CHECKLIST RULE

Preserve the approved Fleet rule:

**Photos are NOT mandatory in normal check-in/check-out.**

If the user says:

> "O carro está com um risco na porta."

The Voice Assistant may initiate `REPORT_DAMAGE`.

The normal damage workflow then requests the required photographic
evidence.

Voice simplifies entry into the workflow but does not remove mandatory
evidence where the existing damage rule requires it.

------------------------------------------------------------------------

# 17. FRONTEND REQUIREMENTS

## 17.1 Responsive

Must work correctly on: - mobile phone; - tablet; - desktop.

Mobile is the priority experience.

## 17.2 Voice control states

Provide clear visual feedback: - Ready; - Listening; - Processing; -
Need clarification; - Ready to confirm; - Executing; - Completed; -
Could not understand; - Service unavailable.

## 17.3 Touch alternative

Every critical voice flow must have a touch/text alternative.

## 17.4 No long conversational walls

Responses must be concise and action-oriented.

## 17.5 Progressive forms

When a form is needed, prefill information already extracted from
conversation.

------------------------------------------------------------------------

# 18. ACCESSIBILITY

Implement: - keyboard operability; - screen-reader-compatible labels; -
visible focus states; - sufficient contrast; - non-voice alternative; -
non-audio confirmation; - readable transcription; - ability to edit
interpreted values by touch; - no essential information conveyed only by
sound.

------------------------------------------------------------------------

# 19. INTERNATIONALIZATION

Portuguese-BR is the initial default user language.

Architecture must be prepared for: - Portuguese; - English; - Chinese; -
future languages.

Do not hard-code user-facing conversational strings inside business
logic.

Intent names remain internal/stable; user language must not change the
domain command contract.

------------------------------------------------------------------------

# 20. SECURITY & PRIVACY

Mandatory:

-   authenticated session before Fleet actions;
-   RBAC applied after intent recognition and before execution;
-   authorization checked server-side;
-   no authorization decision based solely on frontend;
-   no LLM access to unnecessary Fleet data;
-   sanitize model/tool inputs and outputs;
-   protect against prompt injection from user-provided text;
-   rate limiting where appropriate;
-   secure secrets/configuration;
-   no API keys in frontend;
-   audit transactional actions;
-   define retention policy for transcripts;
-   avoid storing raw audio unless explicitly justified by product/legal
    requirements.

Prefer storing structured transaction/audit information over raw audio.

------------------------------------------------------------------------

# 21. AUDIT MODEL

For transactional conversational actions, audit at minimum:

-   authenticated actor;
-   timestamp;
-   channel: VOICE or TEXT;
-   recognized intent;
-   normalized parameters relevant to the transaction;
-   reservation/vehicle reference;
-   confirmation event;
-   final command executed;
-   success/failure;
-   policy/rule result where applicable;
-   approval linkage if applicable.

Do not store hidden chain-of-thought/model reasoning.

------------------------------------------------------------------------

# 22. ERROR HANDLING

Examples:

### Speech unavailable

> "Não consegui acessar o recurso de voz. Você pode continuar
> digitando."

### Speech unclear

> "Não entendi o horário de retorno. Que horas você pretende voltar?"

### No eligible vehicle

Do not invent a vehicle. Use the existing availability/eligibility
result and offer valid alternatives.

### Conflict after confirmation

If availability changed before commit: - do not force reservation; -
explain that availability changed; - recalculate; - present updated
eligible options.

### AI service unavailable

Core Fleet functions must remain usable through standard UI.

The Fleet platform must not become unusable because the conversational
AI provider is unavailable.

------------------------------------------------------------------------

# 23. RESILIENCE / FALLBACK ARCHITECTURE

The implementation must preserve graceful degradation:

``` text
Voice unavailable
    ↓
Text conversation available
    ↓
Conversational AI unavailable
    ↓
Standard touch/form Fleet workflow available
```

Critical Fleet operations must not depend exclusively on an LLM.

------------------------------------------------------------------------

# 24. OBSERVABILITY

Add telemetry for: - voice invocation rate; - transcription
success/failure; - intent recognition success; - clarification rate; -
abandonment rate; - confirmation rate; - successful command
completion; - fallback-to-form rate; - average conversational steps per
completed reservation; - error rate by intent; - latency by stage.

Do not optimize only for AI accuracy. Optimize for **successful user
task completion with low friction**.

------------------------------------------------------------------------

# 25. ANALYTICS / UX KPIs

Recommended UX indicators:

-   Reservation completion rate;
-   Median time to reservation;
-   Median taps to reservation;
-   Median conversational turns;
-   \% reservations completed without manual form;
-   Clarification frequency;
-   Correction frequency;
-   Voice abandonment;
-   Voice-to-touch fallback;
-   Failed intent rate;
-   Transaction reversal/correction after voice execution.

These metrics should support future UX improvements.

------------------------------------------------------------------------

# 26. IMPLEMENTATION SEQUENCE

Kondo should execute in this order.

## Phase V0 --- Reconciliation

-   Map existing Fleet modules.
-   Identify current reservation/application services.
-   Identify frontend architecture.
-   Identify existing AI/recommendation components.
-   Identify RBAC and audit services.
-   Identify existing tests.
-   Produce reconciliation notes before invasive changes.

## Phase V1 --- Conversational foundation

-   Define canonical intent/slot contracts.
-   Implement conversational orchestration abstraction.
-   Implement conversation context/state.
-   Implement structured validation.
-   Implement confirmation policy.
-   Add provider abstraction for Speech-to-Text / LLM.

## Phase V2 --- Reservation

Implement end-to-end: - CREATE_RESERVATION; - VIEW_RESERVATION; -
CHANGE_RESERVATION; - EXTEND_RESERVATION; - CANCEL_RESERVATION.

## Phase V3 --- Operational intents

Implement controlled operational intents from Section 7.

## Phase V4 --- Mobile UX

-   Voice entry;
-   text fallback;
-   transcript;
-   clarification UI;
-   summary/confirmation card;
-   success state;
-   standard form fallback.

## Phase V5 --- Security/audit/observability

Complete security controls, audit events, metrics and failure handling.

## Phase V6 --- Test & UX Gate

Run all tests in this package plus regression suite from the corrected
Fleet baseline.

No release before gate completion.

------------------------------------------------------------------------

# 27. TEST PACK --- FUNCTIONAL

At minimum test:

### Reservation

-   complete voice request;
-   missing departure time;
-   missing return time;
-   missing destination;
-   passenger count change;
-   destination correction;
-   reservation confirmation;
-   user rejects confirmation;
-   user changes one field at confirmation;
-   availability changes before commit;
-   no eligible vehicle;
-   approval required;
-   unauthorized user;
-   conflicting reservation.

### Context

-   follow-up preserves previous data;
-   correction updates only intended field;
-   context cleared after completion/cancel where appropriate;
-   no cross-user context leakage.

### Vehicle rules

-   BEV insufficient range;
-   BEV adequate range;
-   charging feasibility;
-   diesel São Paulo restriction;
-   vehicle in maintenance;
-   vehicle unavailable;
-   vehicle at another location;
-   cargo requirement;
-   passenger capacity;
-   AI Recommended Vehicle mode;
-   User Choice mode.

### Damage

-   normal check-in without photo;
-   damage reported by voice;
-   damage workflow requests evidence;
-   damage submission audit.

------------------------------------------------------------------------

# 28. TEST PACK --- CONVERSATIONAL / NLP

Test natural variations, not only scripted commands.

Examples:

-   "Quero um carro amanhã cedo."
-   "Preciso ir pra São Paulo amanhã às oito."
-   "Vou com mais duas pessoas."
-   "Muda a volta para sete da noite."
-   "Na verdade cancela."
-   "Tem algum elétrico disponível?"
-   "Preciso carregar umas caixas."
-   "Meu carro está onde?"
-   "Vou atrasar uma hora."
-   "O carro está com um risco na porta."

Also test: - colloquial Portuguese; - incomplete phrases; - background
transcription errors; - dates such as "amanhã", "sexta", "depois do
almoço"; - ambiguous times; - corrections; - interruptions; - repeated
request; - contradictory information.

The system must prefer clarification over guessing when the ambiguity
affects a transaction.

------------------------------------------------------------------------

# 29. TEST PACK --- UX

Validate on real mobile viewport sizes.

Acceptance scenarios must verify: - microphone entry is discoverable; -
user understands listening state; - transcript is readable; - user can
correct interpreted information; - user is never trapped in voice
mode; - confirmation is clear; - important date/time/destination are
prominent; - error recovery requires minimal effort; - user can finish
the same task through touch; - loading states are explicit; - no
excessive modal stacking; - no long forms after voice has already
collected information.

------------------------------------------------------------------------

# 30. TEST PACK --- SECURITY

Test: - unauthorized command; - privilege escalation attempt; - prompt
injection in trip purpose/destination/free text; - attempt to bypass
approval through voice; - attempt to request another user's
reservation; - forged reservation ID; - direct API invocation without
proper authorization; - model output containing unexpected command; -
malformed structured output; - replay/double submission; - duplicate
confirmation; - concurrency; - transcript access controls.

------------------------------------------------------------------------

# 31. TEST PACK --- FAILURE / RESILIENCE

Simulate: - microphone permission denied; - Speech-to-Text failure; -
LLM timeout; - malformed LLM response; - network loss; - Fleet API
timeout; - reservation conflict; - database transaction failure; -
notification failure; - partial service outage.

Expected behavior: - no corrupted reservation; - no duplicate
reservation; - no unauthorized action; - user receives clear recovery
path; - standard Fleet UI remains available.

------------------------------------------------------------------------

# 32. REGRESSION GATE

This increment is NOT complete if it breaks existing Fleet
functionality.

Mandatory regression: - login/authentication; - RBAC; - standard
reservation flow; - approval; - vehicle selection; - AI
recommendation; - User Choice; - check-in/check-out; - damage; -
maintenance blocks; - location; - energy/range; - communication hub; -
notifications; - reporting/audit; - multilingual UI; - mobile
responsiveness.

------------------------------------------------------------------------

# 33. DEFINITION OF DONE

The Voice & Conversational UX increment is DONE only when:

-   voice and text use the same Fleet Core;
-   no duplicated domain rule engine exists;
-   reservation works end-to-end by voice;
-   conversational corrections work;
-   missing information produces focused clarification;
-   transactional confirmation works;
-   RBAC is enforced server-side;
-   approval cannot be bypassed;
-   recommendation remains governed by Fleet rules;
-   touch/form fallback works;
-   AI outage does not disable core Fleet operation;
-   audit is generated;
-   metrics are available;
-   functional tests pass;
-   conversational tests pass;
-   UX tests pass;
-   security tests pass;
-   regression tests pass;
-   no Critical/High unresolved defect remains for release;
-   implementation completion report is delivered.

------------------------------------------------------------------------

# 34. ACCEPTANCE EXAMPLE --- GOLDEN PATH

Input:

> "Fleet, preciso de um carro amanhã às oito para ir a São Paulo. Volto
> às cinco e vamos em três."

Expected:

1.  Voice recognized.
2.  `CREATE_RESERVATION` recognized.
3.  Tomorrow resolved using user's/application timezone.
4.  Departure 08:00.
5.  Return 17:00.
6.  Destination resolved/clarified according to Fleet data requirements.
7.  Passenger count = 3.
8.  Existing policy and eligibility rules executed.
9.  Existing Recommendation Engine returns eligible
    recommendation/options.
10. Summary shown.
11. User confirms.
12. Reservation service executes transaction.
13. Audit event created.
14. Confirmation displayed.
15. Relevant notification generated.

No duplicated rule logic may exist in the conversational layer.

------------------------------------------------------------------------

# 35. ACCEPTANCE EXAMPLE --- CORRECTION

User:

> "Muda a volta para sete."

Expected: - system understands active reservation context; - asks
clarification only if 07:00 versus 19:00 is genuinely ambiguous; -
otherwise updates proposed return time; - reruns conflict/availability
rules; - shows updated summary; - requests confirmation; - updates
through standard Fleet application service.

------------------------------------------------------------------------

# 36. ACCEPTANCE EXAMPLE --- SAFETY AGAINST HALLUCINATION

User:

> "Me dá qualquer carro, mesmo que esteja bloqueado para manutenção."

Expected: - conversational layer sends request to domain; - Fleet rules
reject blocked vehicles; - assistant explains that blocked vehicles
cannot be assigned; - only eligible alternatives are shown.

The AI cannot override a domain safety/operational rule.

------------------------------------------------------------------------

# 37. DATA / DATABASE GUIDANCE

Before creating new tables, Kondo must inspect the current schema.

Prefer extending existing structures when semantically correct.

Potential new persistence concepts, only if needed: - conversation
session metadata; - conversational transaction audit; - intent
processing telemetry; - consent/configuration for voice-related
retention; - provider processing metadata.

Do not persist transient conversation state unnecessarily.

Any migration must be: - versioned; - reversible where feasible; -
backward compatible during deployment; - covered by migration tests.

------------------------------------------------------------------------

# 38. API GUIDANCE

Do not expose one API per phrase.

Prefer stable application/domain endpoints or commands.

The conversational orchestrator should translate many natural-language
variants into a small set of canonical Fleet commands.

Example:

``` text
“Quero um carro amanhã”
“Preciso reservar um veículo amanhã”
“Arruma um carro pra mim amanhã”

        ↓

CREATE_RESERVATION
```

Natural language variability belongs in the conversational layer.
Business semantics belong in Fleet Core.

------------------------------------------------------------------------

# 39. PROVIDER ABSTRACTION

Speech-to-Text and LLM providers must be abstracted behind
interfaces/adapters so Fleet is not tightly coupled to a single vendor.

Configuration must allow provider/model replacement without rewriting
domain logic.

Provider failure must activate graceful fallback.

------------------------------------------------------------------------

# 40. PERFORMANCE TARGETS

Kondo should instrument and optimize: - time from end-of-speech to
transcript; - transcript-to-intent; - domain validation; -
recommendation/availability; - confirmation rendering; - transaction
commit.

The UI must immediately acknowledge user input even when backend
processing continues.

Avoid unnecessary sequential AI calls.

------------------------------------------------------------------------

# 41. COST CONTROL

Because Fleet should remain lightweight: - do not send unnecessary
domain data to the LLM; - use structured context; - keep prompts
compact; - use deterministic validation outside the LLM; - avoid
repeated LLM calls for information already extracted; - cache/configure
stable non-sensitive reference data where appropriate; - monitor
conversational cost per completed task.

------------------------------------------------------------------------

# 42. IMPLEMENTATION COMPLETION REPORT --- REQUIRED

Kondo must return a report with:

## A. Reconciliation

-   baseline inspected;
-   conflicts found;
-   conflicts resolved;
-   architectural decisions.

## B. Code

-   modules created;
-   modules changed;
-   APIs changed;
-   migrations;
-   configuration/env changes.

## C. UX

-   screens/components changed;
-   voice states;
-   text fallback;
-   confirmation flow;
-   error/fallback flow.

## D. Security

-   RBAC validation;
-   authorization;
-   audit;
-   data retention;
-   prompt-injection protections.

## E. Tests

For each suite: - total; - passed; - failed; - skipped; - evidence/log
location.

## F. Regression

Confirmation that existing Fleet flows remain functional.

## G. Open items

No hidden TODOs. Explicitly list remaining issues and severity.

------------------------------------------------------------------------

# 43. RELEASE GATE

### GO

Only when: - all Definition of Done items are satisfied; - no
Critical/High defect remains; - regression is green; - transactional
voice actions are auditable; - fallback is operational.

### NO-GO

If: - LLM directly mutates Fleet records; - voice bypasses
RBAC/approval; - duplicated Fleet business rules exist; - voice is the
only way to perform a critical action; - AI outage disables
reservation; - confirmation can be skipped for controlled transactional
actions; - existing Fleet regression is broken; - unresolved
Critical/High security or data-integrity defect exists.

------------------------------------------------------------------------

# 44. FINAL IMPLEMENTATION DIRECTIVE

**Kondo: implement this package as an incremental reconciliation over
the latest corrected Fleet & Mobility baseline.**

Do not reinterpret this addendum as authorization to redesign unrelated
Fleet modules.

The desired result is one coherent Fleet product in which:

> **Touch, text and voice are three interaction methods over the same
> secure, governed and auditable Fleet Core.**

The final experience should feel simple to the employee even though the
underlying Fleet rules remain rigorous.

**Product target:** \> The user should be able to say what they need
naturally, let Fleet understand the request, and complete the task with
the minimum necessary interaction.

------------------------------------------------------------------------

## END --- FLEET VOICE & CONVERSATIONAL UX INCREMENTAL IMPLEMENTATION PACK v1.0
