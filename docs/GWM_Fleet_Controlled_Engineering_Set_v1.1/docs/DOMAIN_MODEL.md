# DOMAIN MODEL

## Core aggregates

### User
- id
- employeeId
- name
- department
- email
- phoneOptional
- active
- driverAuthorized
- driversLicenseNumber
- driversLicenseCategory
- driversLicenseExpiration

### VehicleModel
- id
- manufacturer
- model
- version
- category
- powertrainType: ICE | PHEV | BEV
- passengerCapacity
- cargoCapability
- nominalElectricRangeOptional
- nominalHybridRangeOptional
- fuelTankCapacityOptional
- active

### Vehicle
- id
- plate
- vinOptional
- vehicleModelId
- active
- currentMileage
- currentFuelLevelPercentOptional
- currentBatterySocPercentOptional
- estimatedUsableRangeKmOptional
- homeLocationId
- currentLocationId
- operationalStatus
- readinessStatus
- nextServiceMileageOptional
- nextServiceDateOptional

### VehicleLocation
- id
- name
- locationType
- description
- active

### TripRequest
- id
- requesterId
- originText
- destinationText
- departureAt
- expectedReturnAt
- passengerCount
- cargoRequired
- cargoDescriptionOptional
- justification
- estimatedRoundTripDistanceKm
- status

### Recommendation
- id
- tripRequestId
- vehicleId
- score
- recommendationRank
- explanationJson
- eligibilityStatus

### Reservation
- id
- tripRequestId
- vehicleId
- driverId
- status
- plannedDepartureAt
- plannedReturnAt
- actualDepartureAtOptional
- actualReturnAtOptional
- seatsOccupied
- currentLocationSnapshotOptional

### CarpoolParticipant
- id
- reservationId
- userId
- status

### Approval
- id
- reservationId
- approverId
- decision
- decidedAt
- commentOptional

### Inspection
- id
- vehicleId
- reservationId
- actorType: DRIVER | SECURITY
- actorId
- inspectionType: CHECKOUT | CHECKIN
- mileage
- fuelLevelPercentOptional
- batterySocPercentOptional
- cleanlinessExternal
- cleanlinessInternal
- currentLocationIdOptional
- completedAt

### InspectionIssue
- id
- inspectionId
- issueType
- severity
- vehicleAreaOptional
- description
- photoRequired
- blocksVehicle

Issue types:
DAMAGE_EXTERNAL
WINDOW
LIGHT
TIRE_WHEEL
CLEANING
SAFETY_EQUIPMENT
FUEL
BATTERY
OTHER

### Evidence
- id
- issueId
- mediaType
- storageRef
- capturedAt
- capturedBy
- vehicleAreaOptional

### OperationalTask
- id
- vehicleId
- reservationIdOptional
- sourceIssueIdOptional
- type
- priority
- status
- scheduledStartOptional
- scheduledEndOptional
- assignedToOptional
- completedAtOptional

Task types:
REPAIR
MAINTENANCE
CLEANING
FUELING
CHARGING
SAFETY_CHECK

### CommunicationThread
- id
- reservationId
- active

### Message
- id
- threadId
- senderIdOptional
- senderType
- messageType
- text
- createdAt

Message types:
TEXT
DELAY
VEHICLE_ISSUE
RETURN_TIME_CHANGE
VEHICLE_NOT_FOUND
SYSTEM_ALERT

### Notification
- id
- userId
- type
- channel
- payload
- status
- createdAt
- deliveredAtOptional

### Configuration
- key
- value
- scope
- effectiveFrom
- updatedBy
