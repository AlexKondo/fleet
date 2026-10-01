/**
 * Phase C3 — Matching Engine, Stage A (cheap prefilter).
 *
 * Pure function over already-loaded candidate rows — never calls a `RoutingProvider` or any
 * other I/O (same purity rule as every other file in this directory). The whole point of
 * this stage is to shrink the candidate set to something small/cheap enough to justify
 * paying for real route calls in Stage B (`evaluateRouteMatch.ts`, called by the
 * orchestration layer per `RoutingProvider`), per the pack's two-stage
 * prefilter -> precise-routing design (plan Phase C3).
 *
 * Guard reuse vs. reimplementation (see Phase Report for the full rationale):
 * - `capacity_exhausted`, `cargo_unsupported` are the exact
 *   non-geospatial guards `findCarpoolMatches.ts` already implements — adapted here (not
 *   imported) because that file's `CarpoolCandidate`/`CarpoolMatchResult` shapes are tied to
 *   the OLD reservation/vehicle-based model, while this engine works off the NEW
 *   `carpool_offers`/`carpool_ride_requests` tables (Phase C1) with different field names
 *   and an explicit host-offer `status`. The decision logic itself (the comparisons) is
 *   copied verbatim, not redesigned.
 * - `offer_not_active` / `host_trip_inactive` are NEW — the old engine had no concept of a
 *   published offer or route status at all (its "existingTrip" was always implicitly an
 *   active reservation).
 * - `departure_window_exceeded` reimplements (does not import) the same comparison
 *   `evaluatePolicyPredicates` (`carpoolPolicy.ts`) performs, intentionally duplicated here:
 *   Stage A's job is a *cheap, early* narrowing before the DB round-trip for the full
 *   candidate list is even finished being processed, while `evaluatePolicyPredicates` inside
 *   Stage B (`evaluateRouteMatch.ts`) remains the single authoritative source of truth for
 *   whether a candidate is actually compatible. A candidate that fails here is simply never
 *   routed; one that passes here is still re-checked authoritatively in Stage B.
 * - `coarse_bounds_exceeded` is NEW: a straight-line (haversine) distance check between the
 *   host's destination and the rider's dropoff, used only when both coordinates are cheaply
 *   available on the already-loaded row (see Phase Report: in this phase, host
 *   origin/destination coordinates are not yet persisted anywhere in C1/C2's schema, so this
 *   check is effectively a no-op until a future phase adds that column — included now so the
 *   engine is ready for it without another prefilter rewrite).
 */

import type { LatLng } from "../geospatial/providers";
import { isValidSeatCount } from "./inputValidation";

export interface PrefilterCandidateOffer {
  /** carpool_offers.id */
  offerId: string;
  offerStatus: "draft" | "active" | "disabled" | "completed";
  /** False when the host's underlying trip/reservation is no longer active (cancelled,
   * completed, etc.) — the trip-status half of the pack's `tripStatusOK` predicate. */
  hostTripActive: boolean;
  seatsAvailable: number;
  requestedSeats: number;
  riderRequiresCargo: boolean;
  vehicleSupportsCargo: boolean;
  /** ISO 8601 */
  hostDepartureAt: string;
  /** ISO 8601 */
  riderRequestedDepartureAt: string;
  departureWindowMinutes: number;
  hostDestination?: LatLng;
  riderDropoff?: LatLng;
  /** Cheap geographic bound (km, straight-line) — when omitted, the coarse-bounds check is
   * skipped entirely rather than treated as a pass/fail with a fabricated value. */
  coarseBoundsKm?: number;
}

export type PrefilterRejectionReason =
  | "invalid_input"
  | "offer_not_active"
  | "host_trip_inactive"
  | "capacity_exhausted"
  | "cargo_unsupported"
  | "departure_window_exceeded"
  | "coarse_bounds_exceeded";

export interface PrefilterResult {
  offerId: string;
  passed: boolean;
  reasons: PrefilterRejectionReason[];
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Straight-line (great-circle) distance between two points, in km — intentionally cheap
 * (no network call), used only as a coarse bound ahead of real route calls. */
export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60);
}

export function prefilterCandidate(candidate: PrefilterCandidateOffer): PrefilterResult {
  const reasons: PrefilterRejectionReason[] = [];

  // Fail closed: NaN/Infinity/invalid dates make every `>`/`<` comparison below false,
  // which would read as "passes". Reject outright instead.
  const departureDiff = minutesBetween(candidate.riderRequestedDepartureAt, candidate.hostDepartureAt);
  if (
    !Number.isFinite(departureDiff) ||
    !Number.isFinite(candidate.seatsAvailable) ||
    !isValidSeatCount(candidate.requestedSeats) ||
    !Number.isFinite(candidate.departureWindowMinutes) ||
    (candidate.coarseBoundsKm !== undefined && !Number.isFinite(candidate.coarseBoundsKm))
  ) {
    return { offerId: candidate.offerId, passed: false, reasons: ["invalid_input"] };
  }

  if (candidate.offerStatus !== "active") {
    reasons.push("offer_not_active");
  }
  if (!candidate.hostTripActive) {
    reasons.push("host_trip_inactive");
  }
  // NOTE: the legacy trip_requests.allow_carpool flag is deliberately NOT consulted here. Under
  // the new engine the explicit, active carpool_offers row IS the host's consent (host must opt
  // in to offer seats), so a trip reserved with allow_carpool=false that later publishes an
  // offer must stay visible. Only findCarpoolMatches (legacy matcher) still reads the flag.
  if (candidate.seatsAvailable < candidate.requestedSeats) {
    reasons.push("capacity_exhausted");
  }
  if (candidate.riderRequiresCargo && !candidate.vehicleSupportsCargo) {
    reasons.push("cargo_unsupported");
  }
  const departureDiffMinutes = departureDiff;
  if (departureDiffMinutes > candidate.departureWindowMinutes) {
    reasons.push("departure_window_exceeded");
  }
  if (
    candidate.coarseBoundsKm !== undefined &&
    candidate.hostDestination &&
    candidate.riderDropoff
  ) {
    const straightLineKm = haversineDistanceKm(candidate.hostDestination, candidate.riderDropoff);
    if (!Number.isFinite(straightLineKm) || straightLineKm > candidate.coarseBoundsKm) {
      reasons.push("coarse_bounds_exceeded");
    }
  }

  return { offerId: candidate.offerId, passed: reasons.length === 0, reasons };
}

/** Convenience batch wrapper — order-preserving, pure. */
export function prefilterCandidates(candidates: PrefilterCandidateOffer[]): PrefilterResult[] {
  return candidates.map(prefilterCandidate);
}
