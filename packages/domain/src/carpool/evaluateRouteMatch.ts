/**
 * Phase C3 — Matching Engine, Stage B (precise route decision).
 *
 * Pure function: takes an already-computed `RouteEvaluationResult` (the orchestration layer
 * is the only place that calls a `RoutingProvider`, per Phase C2's dependency-inversion
 * design — this file never imports a provider or does I/O) plus policy config, and returns
 * the final compatibility decision:
 *
 *   compatible == scheduleOK && seatsOK && routeOK && tripStatusOK && policyOK
 *
 * exactly as named in the plan's Phase C3 text. `scheduleOK`/`seatsOK`/`policyOK` (the
 * CARPOOL_DISABLED / BELOW_MINIMUM_SEAT_AVAILABILITY checks) are delegated to
 * `evaluatePolicyPredicates` (Phase C1's `carpoolPolicy.ts`) — this is exactly the plug-in
 * point its own TODO comment calls out. `tripStatusOK` and `routeOK` are evaluated here,
 * the two predicates `evaluatePolicyPredicates` explicitly leaves to its caller.
 */

import {
  evaluatePolicyPredicates,
  type CarpoolPolicyConfig,
  type PolicyPredicateFailureReason,
} from "./carpoolPolicy";
import type { RouteEvaluationResult } from "../geospatial/providers";
import { isValidSeatCount } from "./inputValidation";

export interface RouteMatchInput {
  policy: CarpoolPolicyConfig;
  /** ISO 8601 */
  requestedDepartureAt: string;
  /** ISO 8601 */
  offerDepartureAt: string;
  requestedSeats: number;
  seatsAvailable: number;
  /** `tripStatusOK` — false when the host's underlying trip/reservation is no longer
   * active (cancelled, completed, etc.). This pure function never sees the trip row itself,
   * same convention as `evaluatePolicyPredicates`. */
  hostTripActive: boolean;
  /** Already computed by the orchestration layer via a `RoutingProvider` — this function
   * never calls the provider itself. */
  route: RouteEvaluationResult;
}

export type RouteMatchFailureReason =
  | PolicyPredicateFailureReason
  | "HOST_TRIP_INACTIVE"
  | "INVALID_INPUT"
  | "ADDITIONAL_DISTANCE_EXCEEDS_POLICY"
  | "ADDITIONAL_TIME_EXCEEDS_POLICY";

export interface RouteMatchResult {
  /** True only when every predicate (schedule, seats, route, trip status, policy) passes.
   * Never make an ineligible candidate eligible by weighing one predicate against another —
   * this is a strict AND, matching the pack's §02 rule verbatim. */
  compatible: boolean;
  reasons: RouteMatchFailureReason[];
  additionalDistanceKm: number;
  additionalTimeMin: number;
  departureDiffMinutes: number;
  /**
   * Deterministic ranking key — lower is better/closer fit. Pack §02: "ranking may consider
   * lower detour, closer schedule, fewer stops... must never make an ineligible candidate
   * eligible" — ranking is therefore computed independently of (and after) the strict
   * `compatible` boolean above; it never feeds back into that decision. Primary signal is
   * additional distance (the detour itself), tie-broken by additional time, then by how
   * close the schedules are. NOTE: this is a plain weighted sum (x1000 / x10 / x1), NOT a
   * strict lexicographic ordering — e.g. 0.1km less detour is worth 100 points, which a
   * 10+ minute time difference (x10) can outweigh. That is an accepted ranking heuristic;
   * it is deterministic for identical inputs, and never affects eligibility.
   */
  rankingKey: number;
}

function isValidDate(value: string): boolean {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

/** Fail-closed guard: NaN/Infinity/invalid-date inputs make every `>` comparison false,
 * which would silently read as "within policy" — so any non-finite input is rejected
 * outright instead (pack NO-GO: never falsely declare compatible). */
function hasInvalidInput(input: RouteMatchInput): boolean {
  return (
    !Number.isFinite(input.route?.additionalDistanceKm) ||
    !Number.isFinite(input.route?.additionalTimeMin) ||
    // A detour can never make the trip shorter (adapters clamp to 0): a negative value is
    // malformed provider/caller data, never "even better than within policy".
    input.route.additionalDistanceKm < 0 ||
    input.route.additionalTimeMin < 0 ||
    // Positive integer seats (C3 audit carry-over): 0 / -1 / 0.5 are invalid, not "free rides".
    !isValidSeatCount(input.requestedSeats) ||
    !Number.isFinite(input.seatsAvailable) ||
    !Number.isFinite(input.policy?.maxAdditionalDistanceKm) ||
    !Number.isFinite(input.policy?.maxAdditionalTimeMinutes) ||
    !Number.isFinite(input.policy?.departureWindowMinutes) ||
    !isValidDate(input.requestedDepartureAt) ||
    !isValidDate(input.offerDepartureAt)
  );
}

export function evaluateRouteMatch(input: RouteMatchInput): RouteMatchResult {
  if (hasInvalidInput(input)) {
    return {
      compatible: false,
      reasons: ["INVALID_INPUT"],
      additionalDistanceKm: input.route?.additionalDistanceKm ?? Number.NaN,
      additionalTimeMin: input.route?.additionalTimeMin ?? Number.NaN,
      departureDiffMinutes: Number.NaN,
      rankingKey: Number.POSITIVE_INFINITY,
    };
  }
  const predicates = evaluatePolicyPredicates({
    policy: input.policy,
    requestedDepartureAt: input.requestedDepartureAt,
    offerDepartureAt: input.offerDepartureAt,
    requestedSeats: input.requestedSeats,
    seatsAvailable: input.seatsAvailable,
  });

  const reasons: RouteMatchFailureReason[] = [...predicates.reasons];

  if (!input.hostTripActive) {
    reasons.push("HOST_TRIP_INACTIVE");
  }

  const { additionalDistanceKm, additionalTimeMin } = input.route;
  if (additionalDistanceKm > input.policy.maxAdditionalDistanceKm) {
    reasons.push("ADDITIONAL_DISTANCE_EXCEEDS_POLICY");
  }
  if (additionalTimeMin > input.policy.maxAdditionalTimeMinutes) {
    reasons.push("ADDITIONAL_TIME_EXCEEDS_POLICY");
  }

  const rankingKey =
    additionalDistanceKm * 1000 + additionalTimeMin * 10 + predicates.departureDiffMinutes;

  return {
    compatible: reasons.length === 0,
    reasons,
    additionalDistanceKm,
    additionalTimeMin,
    departureDiffMinutes: predicates.departureDiffMinutes,
    rankingKey,
  };
}
