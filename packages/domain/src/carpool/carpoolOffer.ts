/**
 * Pure state-transition functions for `carpool_offers` (Phase C1 — Domain & Data Model,
 * FleetMind Smart Carpool & Geospatial Intelligence pack). No I/O: these functions take the
 * current row state plus an action's inputs and return either the next state or a typed
 * rejection reason — the RPCs in Phase C4 are the only place that actually reads/writes the
 * `carpool_offers` table and enforces these transitions transactionally (row locking,
 * concurrency) — see the "Concurrency" note on `updateSeats` below for what this phase does
 * and does not guarantee.
 *
 * Mirrors the host "offer N seats" step described in the pack's §04 root-cause analysis:
 * today `trip_requests.allow_carpool` is a one-time consent checkbox, not an explicit
 * publish/manage action — this is the pure logic behind that new action.
 */

export type CarpoolOfferStatus = "draft" | "active" | "disabled" | "completed";

export interface CarpoolOfferState {
  status: CarpoolOfferStatus;
  seatsOffered: number;
  seatsAvailable: number;
}

export type CarpoolOfferRejectionReason =
  | "ALREADY_ACTIVE"
  | "ALREADY_DISABLED"
  | "OFFER_COMPLETED"
  | "INVALID_SEAT_COUNT"
  | "SEATS_AVAILABLE_EXCEEDS_OFFERED"
  | "SEATS_AVAILABLE_NEGATIVE"
  | "CANNOT_REDUCE_BELOW_SEATS_TAKEN";

export type CarpoolOfferTransitionResult =
  | { ok: true; state: CarpoolOfferState }
  | { ok: false; reason: CarpoolOfferRejectionReason };

/**
 * Publishes a draft offer (or re-activates a disabled one) with a starting seat count.
 * `seatsOffered` also becomes the initial `seatsAvailable` — no seats have been claimed by
 * any ride request yet at the moment an offer (re-)enters `active`.
 */
export function enableOffer(
  current: CarpoolOfferState,
  input: { seatsOffered: number },
): CarpoolOfferTransitionResult {
  if (current.status === "completed") {
    return { ok: false, reason: "OFFER_COMPLETED" };
  }
  if (current.status === "active") {
    return { ok: false, reason: "ALREADY_ACTIVE" };
  }
  if (!Number.isInteger(input.seatsOffered) || input.seatsOffered < 1) {
    return { ok: false, reason: "INVALID_SEAT_COUNT" };
  }
  return {
    ok: true,
    state: { status: "active", seatsOffered: input.seatsOffered, seatsAvailable: input.seatsOffered },
  };
}

/**
 * Adjusts the total seats an active offer is publishing. `seatsAvailable` moves by the same
 * delta as `seatsOffered` so seats already claimed by accepted ride requests
 * (`seatsOffered - seatsAvailable`, at the time of the call) stay claimed — e.g. offering 4,
 * 2 accepted (2 available), then updating to 3 total leaves 1 available, not 3.
 *
 * Concurrency (see C1 checklist / Phase Report): this pure function is the single source of
 * truth for "must never go negative" — the `check (seats_available >= 0)` constraint on
 * `carpool_offers` (0052_carpool_offers_and_ride_requests.sql) backs it at the DB level too.
 * Full transactional atomicity under concurrent accept/update calls (`SELECT ... FOR UPDATE`)
 * is a Phase C4 concern — no RPC exists yet in this phase to race against.
 */
export function updateSeats(
  current: CarpoolOfferState,
  input: { seatsOffered: number },
): CarpoolOfferTransitionResult {
  if (current.status !== "active") {
    return { ok: false, reason: "ALREADY_DISABLED" };
  }
  if (!Number.isInteger(input.seatsOffered) || input.seatsOffered < 1) {
    return { ok: false, reason: "INVALID_SEAT_COUNT" };
  }
  const seatsTaken = current.seatsOffered - current.seatsAvailable;
  const nextSeatsAvailable = input.seatsOffered - seatsTaken;
  if (nextSeatsAvailable < 0) {
    return { ok: false, reason: "CANNOT_REDUCE_BELOW_SEATS_TAKEN" };
  }
  return {
    ok: true,
    state: { status: "active", seatsOffered: input.seatsOffered, seatsAvailable: nextSeatsAvailable },
  };
}

/**
 * Host takes the offer down. Seats already accepted are left as-is in this pure model — the
 * pack's revalidation flow (Phase C4's `revalidate_carpool_matches`) is what decides whether
 * already-accepted riders get invalidated when a host disables/changes a trip, not this
 * function.
 */
export function disableOffer(current: CarpoolOfferState): CarpoolOfferTransitionResult {
  if (current.status === "completed") {
    return { ok: false, reason: "OFFER_COMPLETED" };
  }
  if (current.status === "disabled") {
    return { ok: false, reason: "ALREADY_DISABLED" };
  }
  return { ok: true, state: { ...current, status: "disabled" } };
}
