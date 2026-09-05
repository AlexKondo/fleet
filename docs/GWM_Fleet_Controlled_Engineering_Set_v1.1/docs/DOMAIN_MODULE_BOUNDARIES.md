# DOMAIN MODULE BOUNDARIES

## Identity
Owns:
User, Role, DriverAuthorization

## Fleet
Owns:
Vehicle, VehicleModel, VehicleLocation, VehicleStatus

## Trips
Owns:
TripRequest, trip requirements, distance estimate

## Reservations
Owns:
Reservation, Approval, CarpoolParticipant

## MobilityIntelligence
Owns:
Recommendation, Readiness, EnergyRangeEvaluation, ReassignmentProposal

## Inspections
Owns:
Inspection, InspectionIssue, Evidence

## Operations
Owns:
OperationalTask, Maintenance, Charging, Cleaning, Fueling, SafetyCheck

## Communications
Owns:
CommunicationThread, Message

## Notifications
Owns:
Notification delivery state

## Configuration
Owns:
Configuration values and effective policies

## Audit
Owns:
append-only audit records
