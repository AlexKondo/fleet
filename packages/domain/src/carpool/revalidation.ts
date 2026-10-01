/**
 * Phase C4 — pure logic behind `revalidate_carpool_matches` (0059_carpool_lifecycle_rpcs.sql).
 * The SQL implements the same rules (the migration marks the transition guard with
 * `-- DOMAIN-MIRROR revalidation.invalidateLiveRequest`, verified by sqlMirror.test.ts); the
 * pure form exists so the rules have one readable, unit-tested definition.
 *
 * Why a new function instead of reusing `rideRequest.invalidate`: that one (Phase C1, audited)
 * only allows ACCEPTED -> INVALIDATED. When a host's trip is cancelled or materially changed,
 * a still-PENDING request is equally dead (accepting it would create an impossible ride), and
 * the C4 requirement is "ACCEPTED/PENDING requests that became incompatible become
 * INVALIDATED". C1's function is left untouched.
 */

import type {
  CarpoolRideRequestState,
  CarpoolRideRequestTransitionResult,
} from "./rideRequest";
import type { RideInvalidationReason } from "./events";

/** PENDING or ACCEPTED -> INVALIDATED. Terminal states stay terminal. */
export function invalidateLiveRequest(
  current: CarpoolRideRequestState,
): CarpoolRideRequestTransitionResult {
  if (current.status !== "PENDING" && current.status !== "ACCEPTED") {
    return { ok: false, reason: "NOT_PENDING" };
  }
  return { ok: true, state: { status: "INVALIDATED" } };
}

/** Same normalisation as `carpool_norm_text` in 0058: trim, collapse whitespace, lowercase. */
export function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export interface HostTripRevalidationInput {
  hostTripActive: boolean;
  /** ISO 8601 — the departure the rider asked for. */
  requestedDepartureAt: string;
  /** ISO 8601 — the host trip's CURRENT departure. */
  hostDepartureAt: string;
  departureWindowMinutes: number;
  /** Host origin/destination text captured when the rider requested (null for legacy rows). */
  snapshotOrigin?: string | null;
  snapshotDestination?: string | null;
  /** Host origin/destination text NOW. */
  currentOrigin: string;
  currentDestination: string;
}

/**
 * Returns the reason a live request must be invalidated after a host trip change, or null if
 * it is still compatible. Order matches the SQL: cancelled, then schedule, then route.
 * Route changes cannot be re-priced without a provider, so any change to origin/destination
 * text fails closed (the rider just searches again).
 */
export function evaluateHostTripRevalidation(
  input: HostTripRevalidationInput,
): RideInvalidationReason | null {
  if (!input.hostTripActive) return "HOST_TRIP_CANCELLED";

  const diffMinutes =
    Math.abs(new Date(input.requestedDepartureAt).getTime() - new Date(input.hostDepartureAt).getTime()) /
    60000;
  // NaN (invalid date) must not read as "within window": fail closed.
  if (!Number.isFinite(diffMinutes) || diffMinutes > input.departureWindowMinutes) {
    return "HOST_SCHEDULE_CHANGED";
  }

  if (
    (input.snapshotDestination != null &&
      normalizeAddress(input.snapshotDestination) !== normalizeAddress(input.currentDestination)) ||
    (input.snapshotOrigin != null &&
      normalizeAddress(input.snapshotOrigin) !== normalizeAddress(input.currentOrigin))
  ) {
    return "HOST_ROUTE_CHANGED";
  }
  return null;
}
