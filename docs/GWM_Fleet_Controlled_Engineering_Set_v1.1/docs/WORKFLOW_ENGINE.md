# OPERATIONAL WORKFLOW ENGINE

## Mapping
DAMAGE_EXTERNAL -> REPAIR / MAINTENANCE
CLEANING -> CLEANING
LOW_FUEL -> FUELING
LOW_BATTERY -> CHARGING
SERVICE_DUE -> MAINTENANCE
SAFETY_EQUIPMENT -> SAFETY_CHECK

## Task scheduling
Tasks may reserve/block a vehicle time interval.

## Completion
Completing a task does not automatically mean AVAILABLE.
Vehicle readiness must be recalculated.

## Audit
Creation, scheduling, assignment, completion and cancellation must be auditable.
