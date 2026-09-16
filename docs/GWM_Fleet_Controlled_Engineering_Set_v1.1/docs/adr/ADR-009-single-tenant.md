# ADR-009 — Single-Tenant Operation
Status: APPROVED

Decision:
The app operates as single-tenant, reversing the 2026-09-02 multi-tenant SaaS
decision (see DECISION_LOG.md DV-012). Self-service signup remains the initial
registration screen — the app's front door until SSO login is implemented — but it
now joins every new user to one pre-seeded organization instead of creating a new
organization per signup. Every self-registered user becomes `administrator`, since
there is no invite/role-assignment flow yet and the organization is a single
trusted team.

The `organization_id` + RLS multi-tenant scaffolding in the schema is left in
place rather than removed: it costs nothing to keep, and keeps the door open to
reintroduce multi-tenancy later without a schema migration.
