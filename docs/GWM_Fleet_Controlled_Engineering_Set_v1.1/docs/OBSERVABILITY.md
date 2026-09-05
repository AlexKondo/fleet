# OBSERVABILITY

## Logs
Structured JSON logs recommended.

## Required identifiers
traceId
correlationId
eventId where applicable
userId when safe
reservationId when applicable
vehicleId when applicable

## Metrics
- booking conflicts
- failed state transitions
- failed notifications
- operational task backlog
- vehicle blocked count
- recommendation failures
- range evaluation failures
- upload failures

## Alert candidates
- repeated background job failures
- database connectivity failures
- notification queue failures
- high API error rate
