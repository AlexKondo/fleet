# COMMUNICATION HUB

## Scope
Core component linked primarily to Reservation.

## Participants
- current driver
- affected next driver
- Fleet Manager
- Security when operationally relevant

## Message types
TEXT
DELAY
VEHICLE_ISSUE
RETURN_TIME_CHANGE
VEHICLE_NOT_FOUND
SYSTEM_ALERT

## Operational events
A message can trigger domain behavior.

Example:
DELAY
-> update expected return
-> detect next reservation conflict
-> mark next reservation IMPACTED
-> search alternative
-> notify affected users

## Important
Communication Hub is not the audit log.
Critical actions remain independently audited.
