# UX AND WORKFLOW DELTA

## Vehicle create/edit
- Category/model
- Powertrain: ICE/HEV/PHEV/BEV
- Color
- Site
- Initial location
- Conditional energy fields

## Energy UI
ICE: Fuel band
HEV: Fuel band
PHEV: Fuel band + Battery % + Electric Range km
BEV: Battery % + Electric Range km; fuel hidden/disabled

## Checklist
Header:
Model | Color | Plate | Powertrain | Current Location
PHEV/BEV: Battery % | Electric Range

Equipment:
Show only model-required equipment.
Interaction asks whether each required item is PRESENT.

Damage:
Default normal flow has no photo requirement.
Selecting external damage reveals mandatory evidence capture.

## Location
Site first, then only valid parking locations for that site.

## Carpool
1. Requester enters trip
2. System finds compatible reservation
3. Show CARPOOL as primary mobility option
4. Requester selects Request Ride
5. Host receives Accept / Reject
6. Accept -> seat confirmed, both notified
7. Reject -> requester notified and vehicle alternatives become available

## Fleet Manager reassignment
Vehicle option card:
Model | Color | Plate | Powertrain | Current Location | Readiness

## Team
Authorized Fleet Manager:
Edit -> Save
Deactivate/Remove where policy permits
Role changes require audit.

## Trip controls
Start Trip button disabled outside valid pickup window.
Return button unavailable until trip is ACTIVE.
Server remains source of truth even if UI is manipulated.
