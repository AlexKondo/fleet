# DATA MODEL GUIDELINES

## Database
Relational database recommended.

## Required metadata
Most mutable business tables:
- id
- createdAt
- createdBy
- updatedAt
- updatedBy
- version

## Constraints
- unique vehicle plate
- unique employeeId
- no duplicate active participant in same reservation
- reservation overlap prevention must be transactionally enforced
- percentages between 0 and 100
- mileage cannot normally decrease
- required foreign keys enforced

## Indexes
Prioritize:
- vehicle status
- reservation vehicle/time range
- reservation driver/time range
- operational task vehicle/status/time
- notification user/status
- message thread/createdAt

## Deletion
Prefer deactivate/soft-delete for master data.
Operational/audit records should not be physically deleted by normal application flows.
