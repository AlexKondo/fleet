# DOMAIN AND DATA MODEL DELTA

## VehicleModel
Add/confirm:
- powertrainType: ICE | HEV | PHEV | BEV
- requiredEquipmentProfileId

## Vehicle
Add:
- color
- electricRangeKmOptional
- siteId
Fuel/battery/electric-range validation depends on powertrain.

## Site
New aggregate/master:
- id
- name
- code
- active

## VehicleLocation
Add:
- siteId
- locationType
- active

## RequiredEquipmentProfile
- id
- vehicleModelId
- equipmentType
- required

Suggested equipment types:
TRIANGLE
SPARE_TIRE
JACK
WHEEL_WRENCH
OTHER

## DriverLicenseEvidence
- id
- userId
- storageRef
- documentType
- uploadedAt
- extractedExpirationDateOptional
- extractionConfidenceOptional
- validationStatus
- validatedByOptional
- validatedAtOptional
- rejectionReasonOptional

## Driver authorization
Add explicit state:
PENDING_DOCUMENT
PENDING_VALIDATION
AUTHORIZED
BLOCKED_EXPIRED
BLOCKED_MANUAL

## FuelLevelBand
FULL
THREE_QUARTERS
HALF
ONE_QUARTER
RESERVE

## CarpoolRequest
- id
- targetReservationId
- requesterId
- status: REQUESTED | ACCEPTED | REJECTED | CANCELLED
- requestedAt
- decidedAtOptional
- decidedByOptional

## CirculationRestrictionRule
- id
- name
- geography/site/destination applicability
- plateEndingRule
- dayOfWeekRule
- vehicleApplicability
- active
- effectiveFrom
- effectiveToOptional

## Timezone
Trip timestamps must have one explicit canonical strategy. API contracts must make timezone semantics unambiguous.
