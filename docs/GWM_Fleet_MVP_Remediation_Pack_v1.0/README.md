# GWM FleetMind / Intelligent Fleet & Corporate Mobility Platform
## MVP Remediation Pack v1.0

### Purpose
This pack governs correction of the MVP after user validation identified implementation defects and product refinements.

### Mandatory order
1. `00_READ_FIRST_REMEDIATION.md`
2. `MASTER_REMEDIATION_EXECUTION_INSTRUCTIONS.md`
3. `REMEDIATION_ISSUE_REGISTER.md`
4. `PRODUCT_BASELINE_DELTA_v1.1.md`
5. `DOMAIN_AND_DATA_MODEL_DELTA.md`
6. `BUSINESS_RULES_DELTA.md`
7. `UX_AND_WORKFLOW_DELTA.md`
8. `REMEDIATION_REGRESSION_MATRIX.md`
9. Individual `issues/ISSUE-xxx.md`

### Governing principle
Do not patch screens independently. Correct the underlying domain, validation, state, data and workflow logic, then update UI and tests.

### Exit condition
The remediation is complete only when every Critical/High issue is closed, all affected Medium issues are closed, the full regression suite passes, and no approved baseline behavior has regressed.
