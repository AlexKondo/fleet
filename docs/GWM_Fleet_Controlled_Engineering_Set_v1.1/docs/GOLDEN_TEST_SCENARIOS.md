# GOLDEN TEST SCENARIOS

## GT-001 Standard reservation
User requests trip -> vehicle eligible -> approval -> checkout -> return -> checkin -> available.

## GT-002 Carpool
Compatible trip exists with seats -> carpool recommended -> user joins.

## GT-003 Cargo
Cargo required -> cargo-capable vehicle prioritized.

## GT-004 BEV insufficient range
Battery 10%, usable range 20 km, trip 150 km -> BEV not eligible.

## GT-005 Charging before trip
BEV insufficient now but sufficient charging window exists -> charging task created/proposed.

## GT-006 Vehicle becomes unavailable
Reserved vehicle enters maintenance -> eligible alternative found -> reassignment.

## GT-007 Delay impact
Current driver reports delay -> next reservation conflicts -> next reservation impacted -> notifications sent.

## GT-008 Normal checklist
No damage -> no photo required -> checklist completes.

## GT-009 Damage checklist
External damage -> photo mandatory -> repair workflow created.

## GT-010 Current location
Vehicle returned to Assembly Charger -> current location updated -> next user sees it.

## GT-011 CNH expired
Expired CNH -> user cannot checkout as driver.

## GT-012 Security disagreement
Driver reports no damage; Security reports damage -> independent records preserved -> issue created.

## GT-013 Cleaning
Dirty return -> cleaning task created -> block behavior follows configuration.

## GT-014 Booking mode
AI_RECOMMENDED, USER_CHOICE and HYBRID each produce correct UX/API behavior.

## GT-015 Double booking race
Two concurrent reservation attempts for same last vehicle -> only one succeeds.
