# CARPOOL ENGINE

## MVP objective
Detect compatible corporate trips before allocating another fleet vehicle.

## Candidate criteria
- reservation is active/planned
- same or compatible destination region
- departure within configured tolerance
- return time compatible
- available seats > 0
- reservation policy allows passengers

## Configuration
CARPOOL_DEPARTURE_TOLERANCE_MINUTES
CARPOOL_RETURN_TOLERANCE_MINUTES

## Rules
- Never alter original driver's schedule automatically.
- New passenger explicitly accepts existing schedule.
- Seat occupancy must update transactionally.
- Carpool joining must not exceed capacity.
