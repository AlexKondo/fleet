# BUSINESS RULES

## BR-001 Double Booking
A vehicle cannot have overlapping active reservations.

## BR-002 Capacity
Passenger count must not exceed vehicle capacity.

## BR-003 Cargo Eligibility
Cargo trips must only recommend vehicles marked cargo-capable.

## BR-004 Driver Authorization
A driver must be authorized and have a non-expired CNH.

## BR-005 Booking Mode
Vehicle selection behavior must follow configurable mode:
AI_RECOMMENDED | USER_CHOICE | HYBRID.

## BR-006 Carpool Priority
Before allocating an additional vehicle, search compatible active/planned trips with available seats.

## BR-007 Carpool Acceptance
Passenger must accept the existing trip's departure and return schedule.

## BR-008 Trip-Specific Readiness
Eligibility must consider the requested trip, not only generic vehicle status.

## BR-009 BEV Range Feasibility
BEV eligible only if usable range meets required trip range plus configurable safety buffer.

## BR-010 BEV Maximum Recommended Round Trip
maxRecommendedBEVRoundTripWithoutPlannedCharging must be configurable. Example policy may be 350 km, never hardcoded.

## BR-011 Low Battery Handling
If BEV/PHEV lacks required energy:
1. evaluate time window for charging;
2. if feasible, create/suggest CHARGING task and block required interval;
3. otherwise search alternative vehicle.

## BR-012 Fuel Handling
Low fuel may create FUELING task or notify next user according to configurable operational policy.

## BR-013 External Damage Photo
Normal checklists require no photo.
If external damage is reported, at least one photo is mandatory before completing that damage issue.

## BR-014 Damage Workflow
Damage may create REPAIR or MAINTENANCE task and may block vehicle depending on severity.

## BR-015 Cleaning Workflow
Dirty vehicle may create CLEANING task. Whether cleaning blocks use is configurable.

## BR-016 Safety Equipment
Missing mandatory safety equipment creates SAFETY_CHECK and may block vehicle.

## BR-017 Maintenance Alert
When mileage/date reaches configurable warning threshold, create maintenance alert/task.

## BR-018 Current Parking Location
Final check-in must capture current parking location.

## BR-019 Delay Impact
A reported or calculated delay that conflicts with the next reservation marks that reservation IMPACTED and triggers notification/reassignment evaluation.

## BR-020 Vehicle Reassignment
If assigned vehicle becomes unavailable, system must search for eligible alternative vehicles.

## BR-021 Manual Fleet Manager Override
Fleet Manager may reassign or block vehicles, but all critical changes must be audited.

## BR-022 Reservation Visibility
Users may only view reservation data they are authorized to access.

## BR-023 Inspection Integrity
Driver and Security inspections are independent records.

## BR-024 No Telemetry Dependency
Any feature requiring telemetry must have an MVP operational alternative using manually captured platform data.

## BR-025 Corporate Priority
Corporate operational demand always has priority over any future employee rental usage.
