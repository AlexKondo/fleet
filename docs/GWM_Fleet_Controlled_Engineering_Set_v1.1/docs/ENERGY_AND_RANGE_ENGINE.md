# ENERGY AND RANGE ENGINE

## ICE
Inputs:
- fuel level
- estimated fuel range if available
- trip distance
- safety buffer

## PHEV
Inputs:
- fuel level
- battery SOC
- estimated combined usable range
- trip distance
- safety buffer

## BEV
Inputs:
- battery SOC
- estimated usable electric range
- trip distance
- configurable BEV policy
- safety buffer

## Required Trip Range
requiredTripRangeKm = estimatedRoundTripDistanceKm * rangeSafetyFactor

## BEV policy
Configuration key:
BEV_MAX_ROUND_TRIP_WITHOUT_PLANNED_CHARGING_KM

## Charging decision
If range insufficient:
- determine available charging window before departure
- if feasible, create/propose charging task
- if not feasible, request reassignment

## Charging point awareness
MVP may store known internal charging locations.
External charging integrations are future.
