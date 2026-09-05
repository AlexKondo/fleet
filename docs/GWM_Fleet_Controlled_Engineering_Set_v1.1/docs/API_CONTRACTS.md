# API CONTRACTS — MVP SURFACE

## Trip Requests
POST /trip-requests
GET /trip-requests/{id}
GET /trip-requests/{id}/recommendations
POST /trip-requests/{id}/submit

## Reservations
POST /reservations
GET /reservations/{id}
POST /reservations/{id}/approve
POST /reservations/{id}/reject
POST /reservations/{id}/cancel
POST /reservations/{id}/reassign
POST /reservations/{id}/delay
POST /reservations/{id}/checkout
POST /reservations/{id}/checkin

## Carpool
GET /trip-requests/{id}/carpool-options
POST /reservations/{id}/carpool/join
POST /reservations/{id}/carpool/leave

## Vehicles
GET /vehicles
GET /vehicles/{id}
GET /vehicles/available
GET /vehicles/{id}/readiness
POST /vehicles/{id}/block
POST /vehicles/{id}/unblock

## Inspections
POST /inspections
GET /inspections/{id}
POST /inspections/{id}/issues
POST /inspection-issues/{id}/evidence

## Operational Tasks
GET /operational-tasks
POST /operational-tasks
POST /operational-tasks/{id}/schedule
POST /operational-tasks/{id}/start
POST /operational-tasks/{id}/complete
POST /operational-tasks/{id}/cancel

## Communications
GET /reservations/{id}/messages
POST /reservations/{id}/messages

## Fleet Configuration
GET /configurations
PUT /configurations/{key}

## Requirements for every endpoint
Document:
- request schema
- response schema
- auth role
- validation rules
- error codes
- emitted domain events
- idempotency behavior where applicable
