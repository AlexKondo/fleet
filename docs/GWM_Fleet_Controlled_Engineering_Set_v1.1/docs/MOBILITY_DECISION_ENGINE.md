# MOBILITY DECISION ENGINE

## Objective
Determine the best mobility option for a trip request.

## Decision pipeline
1. Validate user/driver
2. Validate trip data
3. Search carpool candidates
4. Build eligible vehicle pool
5. Evaluate Trip-Specific Readiness
6. Evaluate Energy & Range
7. Evaluate cargo/passenger fit
8. Evaluate operational conflicts
9. Score eligible vehicles
10. Apply configured booking mode
11. Return recommendation(s) and explanation

## Recommendation dimensions
- availability
- passenger fit
- cargo fit
- trip distance
- powertrain suitability
- current fuel
- current battery
- estimated usable range
- maintenance condition
- blocking issues
- current location
- upcoming operational tasks
- upcoming reservation conflicts
- configured restrictions

## Explainability
Every recommendation must return human-readable reasons.

Example:
Recommended because:
- available during requested period
- capacity sufficient
- cargo-capable
- range sufficient
- no blocking maintenance
- lower operational mismatch than alternatives

## Architecture
Use deterministic rule/scoring engine in MVP.
Weights and thresholds should be configuration-driven.
Do not require generative AI for correctness.
