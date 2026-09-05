# NOTIFICATION ENGINE

## MVP channels
- IN_APP
- PUSH
- EMAIL

## Events
- request submitted
- request approved
- request rejected
- reservation confirmed
- vehicle reassigned
- pickup reminder
- vehicle ready
- delay reported
- next reservation impacted
- maintenance required
- cleaning required
- charging required
- fueling required
- vehicle blocked
- task completed

## Idempotency
Notification generation must be idempotent by event.
