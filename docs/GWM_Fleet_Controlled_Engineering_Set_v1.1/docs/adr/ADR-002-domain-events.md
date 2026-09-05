# ADR-002 — Domain Events
Status: APPROVED

Decision:
Use domain events for important cross-module side effects.

Mandatory event envelope includes aggregateType and aggregateId plus correlationId.
