# UX JOURNEYS

## J-01 Request a Trip
Actor: User
Preconditions: authenticated, authorized
Steps:
1. Enter origin/destination
2. Enter departure/return
3. Enter passenger count
4. Enter cargo requirement
5. Enter justification
6. Submit
Outcome: carpool/recommendation evaluation

## J-02 Accept Carpool
1. See compatible trip
2. Review schedule
3. Accept schedule
4. Confirm seat
Outcome: participant added

## J-03 Approve Request
Actor: Approver
1. View request
2. View recommendation
3. Approve or reject

## J-04 Pickup
Actor: User
1. Open reservation
2. See vehicle and current location
3. Perform checklist
4. Resolve blocking issue if any
5. Wait for Security release

## J-05 Security Checkout
1. Find expected departure
2. Perform independent checklist
3. Register km/fuel/battery/equipment
4. Record damage if any
5. Release vehicle

## J-06 During Trip
Use Communication Hub for operational updates.

## J-07 Delay
1. User reports delay/new return time
2. System analyzes next booking impact
3. System notifies affected parties
4. Reassignment evaluated

## J-08 Return
1. Arrive gate
2. Security check-in
3. User check-in/confirmation
4. Record final parking location
5. System evaluates operational tasks

## J-09 External Damage
1. Mark damage
2. Select area/type
3. Add description
4. Take mandatory photo
5. Submit
6. System creates issue/workflow

## J-10 Fleet Manager Maintenance
1. See alert
2. Schedule task
3. Vehicle blocked for task interval
4. Complete task
5. Recalculate readiness

## J-11 Charging
Same flow as maintenance but CHARGING task.

## J-12 Cleaning
Same flow as maintenance but CLEANING task.

## J-13 Reassignment
1. Assigned vehicle becomes unavailable
2. System identifies eligible substitutes
3. Best substitute selected/proposed per policy
4. User notified
