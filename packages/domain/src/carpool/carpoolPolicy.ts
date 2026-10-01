/**
 * Typed policy config mirroring `carpool_policy_settings` (Phase C1 —
 * 0053_carpool_policy_settings.sql) plus a pure evaluator for the predicates that don't
 * need a route. Route compatibility (`routeOK` in Phase C3's `evaluateRouteMatch.ts`) is
 * deliberately NOT implemented here — no `RoutingProvider` exists yet (that's Phase C2), so
 * this only evaluates schedule and seats. See the TODO on `evaluatePolicyPredicates` below
 * for exactly where C3 plugs in.
 */

export interface CarpoolPolicyConfig {
  carpoolEnabled: boolean;
  carpoolFirstEnabled: boolean;
  hostOptInRequired: boolean;
  hostApprovalRequired: boolean;
  /** Minutes of allowed difference on the departure leg. */
  departureWindowMinutes: number;
  /** Minutes of allowed difference on the return leg. */
  returnWindowMinutes: number;
  /** Max additional route distance (km) a detour to pick up/drop off a rider may add —
   * evaluated by Phase C3 once a RoutingProvider exists, not here. */
  maxAdditionalDistanceKm: number;
  /** Max additional route time (minutes) a detour may add — same C3 note as above. */
  maxAdditionalTimeMinutes: number;
  maxCandidatesForPreciseRouting: number;
  requestExpiryMinutes: number;
  allowIntermediatePickup: boolean;
  allowIntermediateDropoff: boolean;
  /** Floor for how many seats an offer must still have available to be worth considering —
   * the pack's default is "minimum seats = requested passenger seats", i.e. an offer must
   * have at least as many seats available as the rider is requesting; this field is the
   * policy-level minimum requests are additionally held to (default 1). */
  minimumSeatAvailability: number;
}

/**
 * Pack TEST/UAT defaults (§ referenced in the plan's Phase C1 scope): ±15 minute departure
 * window, 5km / 10min max detour, seats = requested, host opt-in + host approval required.
 * `carpool_policy_settings` seeds real per-org rows from this shape at policy_version 1
 * (0053_carpool_policy_settings.sql) — this constant is the fallback for any caller (tests,
 * tools) that doesn't load a real org's policy row, matching the precedent set by
 * `findCarpoolMatches.ts`'s `defaultCarpoolMatchConfig`.
 */
export const defaultCarpoolPolicyConfig: CarpoolPolicyConfig = {
  carpoolEnabled: true,
  carpoolFirstEnabled: true,
  hostOptInRequired: true,
  hostApprovalRequired: true,
  departureWindowMinutes: 15,
  returnWindowMinutes: 15,
  maxAdditionalDistanceKm: 5,
  maxAdditionalTimeMinutes: 10,
  maxCandidatesForPreciseRouting: 5,
  requestExpiryMinutes: 30,
  allowIntermediatePickup: true,
  allowIntermediateDropoff: true,
  minimumSeatAvailability: 1,
};

export interface PolicyPredicateInput {
  policy: CarpoolPolicyConfig;
  /** ISO 8601 departure time the rider is requesting. */
  requestedDepartureAt: string;
  /** ISO 8601 departure time the offer's host trip is running. */
  offerDepartureAt: string;
  requestedSeats: number;
  seatsAvailable: number;
}

export type PolicyPredicateFailureReason =
  | "CARPOOL_DISABLED"
  | "OUTSIDE_DEPARTURE_WINDOW"
  | "INSUFFICIENT_SEATS_AVAILABLE"
  | "BELOW_MINIMUM_SEAT_AVAILABILITY";

export interface PolicyPredicateResult {
  /** True only when every predicate implemented in this phase passes. Does NOT include the
   * route predicate — see the TODO below. A caller must additionally require `routeOK` from
   * Phase C3's `evaluateRouteMatch` before treating a candidate as truly compatible. */
  scheduleAndSeatsOK: boolean;
  reasons: PolicyPredicateFailureReason[];
  departureDiffMinutes: number;
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60);
}

/**
 * Evaluates ONLY the non-route predicates from the pack's compatibility rule
 * (`scheduleOK && seatsOK && routeOK && tripStatusOK && policyOK`, Phase C3's plan text):
 * schedule window and seat availability. `tripStatusOK` (is the underlying trip still
 * active/not cancelled) is left to the caller, which has the actual trip row this pure
 * function never sees.
 *
 * TODO(C3): `routeOK` — whether a detour through the rider's pickup/dropoff stays within
 * `maxAdditionalDistanceKm`/`maxAdditionalTimeMinutes` — is NOT evaluated here. It requires
 * a `RouteEvaluationResult` from a `RoutingProvider` (Phase C2, doesn't exist yet). Phase
 * C3's `evaluateRouteMatch.ts` is responsible for combining this function's
 * `scheduleAndSeatsOK` with its own `routeOK` into the final compatibility decision.
 */
export function evaluatePolicyPredicates(input: PolicyPredicateInput): PolicyPredicateResult {
  const reasons: PolicyPredicateFailureReason[] = [];

  if (!input.policy.carpoolEnabled) {
    reasons.push("CARPOOL_DISABLED");
  }

  const departureDiffMinutes = minutesBetween(input.requestedDepartureAt, input.offerDepartureAt);
  if (departureDiffMinutes > input.policy.departureWindowMinutes) {
    reasons.push("OUTSIDE_DEPARTURE_WINDOW");
  }

  if (input.seatsAvailable < input.requestedSeats) {
    reasons.push("INSUFFICIENT_SEATS_AVAILABLE");
  }

  if (input.seatsAvailable < input.policy.minimumSeatAvailability) {
    reasons.push("BELOW_MINIMUM_SEAT_AVAILABILITY");
  }

  return {
    scheduleAndSeatsOK: reasons.length === 0,
    reasons,
    departureDiffMinutes,
  };
}
