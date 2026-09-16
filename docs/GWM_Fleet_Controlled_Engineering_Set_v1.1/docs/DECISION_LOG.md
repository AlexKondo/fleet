# DECISION LOG

## DV-001
Product is independent from Trust Platform, Trust Mobility, SPIP and other user projects.

## DV-002
MVP must not depend on telemetry/hardware.

## DV-003
Vehicle selection policy configurable: AI_RECOMMENDED / USER_CHOICE / HYBRID.

## DV-004
Communication Hub is Core.

## DV-005
Trip-Specific Readiness is a core product concept.

## DV-006
Photos are not mandatory in normal checklist.

## DV-007
Photo is mandatory only when external damage is identified.

## DV-008
Current parking location is mandatory at final check-in.

## DV-009
Energy & Range Intelligence covers ICE, PHEV and BEV.

## DV-010
BEV round-trip policy must be configurable.

## DV-011
Employee Fleet Rental is future, not MVP.

## DV-012
Reversed 2026-09-02 multi-tenant SaaS decision (2026-09-16): the app now operates as
single-tenant. Self-service signup still creates the initial user accounts — it now
joins everyone to one pre-seeded organization instead of creating a new tenant per
signup — and remains the front door until SSO login replaces it. The
`organization_id` + RLS scaffolding stays in the schema for now (cheap to keep,
reversible later) but the app no longer creates additional tenants. See ADR-009.
