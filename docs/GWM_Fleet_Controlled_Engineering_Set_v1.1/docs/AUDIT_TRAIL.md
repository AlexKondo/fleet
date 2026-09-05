# AUDIT TRAIL

## Append-only application model
Audit entries are immutable to normal users/admin flows.

## Audit event fields
- auditId
- occurredAt
- actorId
- actorRole
- action
- entityType
- entityId
- beforeOptional
- afterOptional
- correlationId
- sourceIpOptional
- userAgentOptional

## Mandatory audited actions
- authentication events
- trip submission
- approval/rejection
- vehicle reassignment
- vehicle block/unblock
- inspection completion
- damage creation
- evidence upload
- operational task completion/cancel
- driver authorization change
- configuration change
