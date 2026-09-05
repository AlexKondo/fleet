# ACTORS AND PERMISSIONS

## DRIVER / USER
Can:
- create trip requests
- see own requests/reservations
- view eligible vehicles according to booking mode
- accept carpool
- perform user checklist
- report issues
- send operational messages
- record final parking location when responsible for return

Cannot:
- manually unblock vehicles
- alter fleet configuration
- alter another user's checklist
- alter maintenance completion
- bypass approval

## APPROVER
Can:
- approve/reject requests
- view request justification and recommendation
- add comments

## FLEET_MANAGER
Can:
- manage fleet master
- configure policies
- block/unblock vehicles
- reassign reservations
- schedule operational tasks
- manage locations
- manage vehicle readiness decisions
- view all fleet reservations and incidents

## SECURITY_GATE
Can:
- see expected departures/returns
- perform independent security checklist
- record mileage, fuel, battery, equipment and damage
- register gate departure/return
- attach damage evidence

## SYSTEM_AUTOMATION
Can only act through explicit documented rules:
- create recommendations
- create alerts
- create operational tasks
- mark reservation impacted
- suggest or execute reallocation where rule allows
- block vehicle where rule requires
