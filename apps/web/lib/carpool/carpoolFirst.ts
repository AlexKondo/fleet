/**
 * Phase C5 — carpool-first orchestration for New Trip (pack 05/01): after the rider submits the
 * core trip data and before the vehicle result, resolve their origin/destination, run the
 * C3 geospatial search and hand back ONLY what the UI may show.
 *
 * Privacy: a card carries the host's departure time, seats still available and the detour this
 * rider would cause - never the host's name, address or coordinates; incompatible offers never
 * reach this module's output (runCarpoolSearch already drops them).
 *
 * Pure orchestration with injected dependencies (unit-tested without Next/Supabase/Google).
 */

import type { LatLng } from "@fleet/domain";
import type { CompatibleCarpoolMatch, RiderTripDraft, SearchCarpoolResult } from "./runCarpoolSearch";
import type { NeedsPrecisionReason, ResolveOutcome, ResolvedPlace } from "./resolveLocationText";

export interface CarpoolOfferCard {
  offerId: string;
  /** Host trip departure (ISO) - the rider compares it with their own requested time. */
  hostDepartureAt: string;
  seatsAvailable: number;
  /** Rounded for display (0.1 km / whole minutes). */
  additionalDistanceKm: number;
  additionalTimeMin: number;
}

/** What the browser needs to request a ride later; coordinates were resolved server-side
 * and are re-validated + re-evaluated by requestCarpoolRide, never trusted. */
export interface CarpoolDraftWire {
  requestedDepartureAt: string;
  requestedSeats: number;
  requiresCargo: boolean;
  pickup: LatLng;
  dropoff: LatLng;
}

export type PlaceCheck =
  | { query: string; ok: true; place: ResolvedPlace }
  | { query: string; ok: false; reason: NeedsPrecisionReason };

export type CarpoolFirstState =
  | {
      status: "offers";
      origin: ResolvedPlace;
      destination: ResolvedPlace;
      offers: CarpoolOfferCard[];
      draft: CarpoolDraftWire;
    }
  | { status: "none"; origin: ResolvedPlace; destination: ResolvedPlace }
  | { status: "needs_precision"; origin: PlaceCheck; destination: PlaceCheck }
  | { status: "unavailable"; reason: string };

export interface CarpoolFirstInput {
  originText: string;
  destinationText: string;
  departureAt: string;
  passengerCount: number;
  requiresCargo: boolean;
}

export interface CarpoolFirstDeps {
  resolve(text: string): Promise<ResolveOutcome>;
  search(draft: RiderTripDraft): Promise<SearchCarpoolResult>;
  loadOfferCards(matches: CompatibleCarpoolMatch[]): Promise<CarpoolOfferCard[]>;
}

export async function runCarpoolFirst(
  input: CarpoolFirstInput,
  deps: CarpoolFirstDeps,
): Promise<CarpoolFirstState> {
  const [o, d] = await Promise.all([deps.resolve(input.originText), deps.resolve(input.destinationText)]);

  // Provider/policy outage on either side: say so, let the normal vehicle flow proceed.
  if (o.status === "unavailable") return { status: "unavailable", reason: o.reason };
  if (d.status === "unavailable") return { status: "unavailable", reason: d.reason };

  const check = (text: string, r: Exclude<ResolveOutcome, { status: "unavailable" }>): PlaceCheck =>
    r.status === "resolved"
      ? { query: text, ok: true, place: r.place }
      : { query: text, ok: false, reason: r.reason };

  if (o.status === "needs_precision" || d.status === "needs_precision") {
    // Not resolved precisely => the search is NOT run and nothing is guessed.
    return {
      status: "needs_precision",
      origin: check(input.originText, o),
      destination: check(input.destinationText, d),
    };
  }

  const draft: CarpoolDraftWire = {
    requestedDepartureAt: input.departureAt,
    requestedSeats: input.passengerCount,
    requiresCargo: input.requiresCargo,
    pickup: o.place.coordinates,
    dropoff: d.place.coordinates,
  };

  const result = await deps.search(draft);
  if (result.status === "unavailable") return { status: "unavailable", reason: result.reason };
  if (result.status === "error") return { status: "unavailable", reason: result.error };

  if (result.matches.length === 0) {
    return { status: "none", origin: o.place, destination: d.place };
  }
  const offers = await deps.loadOfferCards(result.matches);
  if (offers.length === 0) {
    return { status: "none", origin: o.place, destination: d.place };
  }
  return { status: "offers", origin: o.place, destination: d.place, offers, draft };
}

/** Pure: builds display cards from matches + the offer rows loaded under the rider's own RLS.
 * An offer row that could not be loaded is dropped (never shown half-informed). */
export function buildOfferCards(
  matches: CompatibleCarpoolMatch[],
  rows: { id: string; seats_available: number; hostDepartureAt: string | null }[],
): CarpoolOfferCard[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cards: CarpoolOfferCard[] = [];
  for (const match of matches) {
    const row = byId.get(match.offerId);
    if (!row || !row.hostDepartureAt || row.seats_available < 1) continue;
    cards.push({
      offerId: match.offerId,
      hostDepartureAt: row.hostDepartureAt,
      seatsAvailable: row.seats_available,
      additionalDistanceKm: Math.round(match.additionalDistanceKm * 10) / 10,
      additionalTimeMin: Math.round(match.additionalTimeMin),
    });
  }
  return cards;
}

/** Org-policy gating for New Trip / planTrip (pack: carpool-first). `newEngine` is true whenever
 * the new geospatial engine owns carpool for the org: the OLD city-string matcher must then not
 * produce offers (a pack NO-GO). */
export interface CarpoolGating {
  /** The new engine is active for this org: old text matching suppressed. */
  newEngine: boolean;
  /** The rider-side carpool-first search runs in New Trip. */
  carpoolFirst: boolean;
  /** The host "offer seats" step is shown (needs a known policy with carpool enabled). */
  hostStep: boolean;
  hostApprovalRequired: boolean;
}

export function deriveCarpoolGating(
  load:
    | {
        ok: true;
        policy: { carpoolEnabled: boolean; carpoolFirstEnabled: boolean; hostApprovalRequired: boolean };
      }
    | { ok: false },
): CarpoolGating {
  if (!load.ok) {
    // Policy unknown (query failed): fail closed on the OLD matcher (never a city-string
    // carpool offer) and surface the outage banner; never offer to publish seats.
    return { newEngine: true, carpoolFirst: true, hostStep: false, hostApprovalRequired: true };
  }
  const { carpoolEnabled, carpoolFirstEnabled, hostApprovalRequired } = load.policy;
  return {
    newEngine: carpoolEnabled,
    carpoolFirst: carpoolEnabled && carpoolFirstEnabled,
    hostStep: carpoolEnabled,
    hostApprovalRequired,
  };
}
