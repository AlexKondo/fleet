# BUSINESS RULES DELTA

## BR-R01 — Timestamp Preservation
Recommendation, carpool search and availability evaluation cannot mutate the requested trip timestamps.

## BR-R02 — Valid Trip Activation
Reservation may transition to ACTIVE only inside the configured permitted pickup window and after required checkout/release conditions.

## BR-R03 — Valid Return
RETURNED cannot occur before ACTIVE/actualDepartureAt.

## BR-R04 — Carpool Priority
Compatible carpool candidates are evaluated before incremental vehicle allocation.

## BR-R05 — Host Acceptance
A requested carpool seat becomes occupied only after host-driver acceptance.

## BR-R06 — Concurrent Seat Safety
Carpool seat acceptance must be concurrency-safe.

## BR-R07 — Concurrent Vehicle Booking Safety
Overlapping reservation confirmation must be transactionally safe.

## BR-R08 — Damage Photo
Photo evidence controls are conditionally required only for external damage.

## BR-R09 — Equipment Presence
Checklist validates presence of equipment required by the selected vehicle model.

## BR-R10 — CNH Expiry
Expired CNH automatically removes driving authorization until valid evidence is submitted, validated and Fleet Manager releases the user.

## BR-R11 — Powertrain Fields
BEV must not require fuel. PHEV requires applicable fuel + battery + electric range. ICE does not require battery/electric range. HEV is distinct from PHEV.

## BR-R12 — Site Location Filtering
Operational location selection is constrained to the relevant site.

## BR-R13 — Circulation Restriction
Restriction warning is evaluated from configured policy, trip geography/date and vehicle/plate applicability.

## BR-R14 — Vehicle Identification
Operational selection/checklist surfaces must provide sufficient vehicle identity: model, color and plate at minimum.
