# EVENT ARCHITECTURE

## Domain events
TripRequested
CarpoolCandidateFound
RecommendationGenerated
ReservationSubmitted
ReservationApproved
ReservationRejected
VehicleAssigned
VehicleReserved
VehicleReadyForPickup
CheckoutCompleted
VehicleDeparted
DelayReported
ReservationImpacted
VehicleReturned
InspectionCompleted
DamageDetected
CleaningRequired
LowFuelDetected
LowBatteryDetected
MaintenanceRequired
VehicleBlocked
OperationalTaskCreated
OperationalTaskCompleted
VehicleReady
VehicleReassigned
CurrentLocationUpdated

## Event envelope
Every event must include:
- eventId
- eventType
- occurredAt
- aggregateType
- aggregateId
- actorId optional
- correlationId
- causationId optional
- schemaVersion

## Rule
Consumers must be idempotent where side effects may repeat.
