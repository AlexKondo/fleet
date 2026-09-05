# 00 — READ FIRST: REMEDIATION

This pack is a corrective overlay on top of:
- Product & Engineering Blueprint v1.0
- Controlled Engineering Set v1.1 — Autonomous Multi-Agent Build

The original canonical precedence remains valid except where this pack explicitly records an approved delta.

## Remediation precedence
1. Approved Product Baseline Delta v1.1 in this pack
2. Remediation Business Rules Delta
3. Remediation Domain/Data Delta
4. Existing Product Baseline / Business Rules / Domain Model / State Machines
5. Existing APIs / UX / implementation

## Rules
- Preserve all unaffected approved functionality.
- Do not rewrite the platform from scratch unless a documented root-cause analysis proves it necessary.
- Fix root causes, not screenshots.
- Every issue must receive a regression test.
- Do not close an issue based only on visual confirmation.
- Any newly discovered behavior not covered by baseline must become `DV-REM-XXX`.
- Any proposed change to an approved behavior not contained in this pack must become `CR-REM-XXX`.
