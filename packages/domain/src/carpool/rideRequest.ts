/**
 * Pure state-transition functions for `carpool_ride_requests` (Phase C1 — Domain & Data
 * Model, FleetMind Smart Carpool & Geospatial Intelligence pack). No I/O — the RPCs in
 * Phase C4 own the actual row locking, seat decrement/release, and audit logging.
 *
 * Root-cause context (pack §04 / plan C0 item #3): today `respond_to_carpool_request`
 * (0020/0021) *hard-deletes* a `trip_participants` row on reject, so there is no durable
 * REJECTED state at all. These transitions exist specifically so a rejection (or any other
 * terminal state) is recorded, never erased.
 */

export type CarpoolRideRequestStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "INVALIDATED";

export interface CarpoolRideRequestState {
  status: CarpoolRideRequestStatus;
}

export type CarpoolRideRequestRejectionReason =
  | "NOT_PENDING"
  | "NOT_ACCEPTED";

export type CarpoolRideRequestTransitionResult =
  | { ok: true; state: CarpoolRideRequestState }
  | { ok: false; reason: CarpoolRideRequestRejectionReason };

/** Guard shared by every transition below that only makes sense from PENDING. */
function requirePending(current: CarpoolRideRequestState): CarpoolRideRequestTransitionResult | null {
  if (current.status !== "PENDING") {
    return { ok: false, reason: "NOT_PENDING" };
  }
  return null;
}

/** Host accepts a pending request. */
export function accept(current: CarpoolRideRequestState): CarpoolRideRequestTransitionResult {
  const guard = requirePending(current);
  if (guard) return guard;
  return { ok: true, state: { status: "ACCEPTED" } };
}

/** Host rejects a pending request — a durable status, never a delete (see module doc). */
export function reject(current: CarpoolRideRequestState): CarpoolRideRequestTransitionResult {
  const guard = requirePending(current);
  if (guard) return guard;
  return { ok: true, state: { status: "REJECTED" } };
}

/** Rider withdraws their own request. Allowed from PENDING (not yet decided) or ACCEPTED
 * (rider changes their mind after being accepted) — not from a state that's already terminal. */
export function cancel(current: CarpoolRideRequestState): CarpoolRideRequestTransitionResult {
  if (current.status !== "PENDING" && current.status !== "ACCEPTED") {
    return { ok: false, reason: "NOT_PENDING" };
  }
  return { ok: true, state: { status: "CANCELLED" } };
}

/** System-driven: a pending request outlives `requestExpiryMinutes` (carpool_policy_settings)
 * without a host response. */
export function expire(current: CarpoolRideRequestState): CarpoolRideRequestTransitionResult {
  const guard = requirePending(current);
  if (guard) return guard;
  return { ok: true, state: { status: "EXPIRED" } };
}

/** System-driven: the host's underlying trip changes (destination/schedule) or is cancelled
 * after this request was already ACCEPTED, per `revalidate_carpool_matches` (Phase C4) —
 * only a currently-accepted ride can become invalidated, never a still-pending one (that
 * case is handled by the offer simply no longer matching in a fresh search). */
export function invalidate(current: CarpoolRideRequestState): CarpoolRideRequestTransitionResult {
  if (current.status !== "ACCEPTED") {
    return { ok: false, reason: "NOT_ACCEPTED" };
  }
  return { ok: true, state: { status: "INVALIDATED" } };
}
