/**
 * Phase C3 — Matching Engine orchestration core (non-action module).
 *
 * Deliberately NOT in a "use server" file: everything exported from a "use server" module is
 * a client-reachable server action, and this core takes caller-supplied candidates/policy/
 * provider arguments that must never be reachable from the client. Only
 * `apps/web/app/carpool/actions.ts#searchCompatibleCarpool` (which derives everything from the
 * authenticated session) is a real action.
 */

import type { CarpoolPolicyConfig, LatLng, RoutingProvider } from "@fleet/domain";
import {
  evaluateRouteMatch,
  prefilterCandidates,
  type PrefilterCandidateOffer,
} from "@fleet/domain";

export interface RiderTripDraft {
  /** ISO 8601 */
  requestedDepartureAt: string;
  requestedSeats: number;
  requiresCargo: boolean;
  pickup: LatLng;
  dropoff: LatLng;
}

export interface CompatibleCarpoolMatch {
  offerId: string;
  hostTripRequestId: string;
  additionalDistanceKm: number;
  additionalTimeMin: number;
  departureDiffMinutes: number;
  rankingKey: number;
  /** The exact (already validated) coordinates this match was route-evaluated with. Echoed so
   * the request-creation path records server-evaluated facts, not a second client copy. */
  pickup: LatLng;
  dropoff: LatLng;
}

/** Three-way discriminated union on `status`. `unavailable` is the outage/disabled signal a
 * future UI turns into a banner; `error` is a caller-side failure (auth/profile). */
export type SearchCarpoolResult =
  | { status: "matches"; matches: CompatibleCarpoolMatch[] }
  | { status: "unavailable"; reason: string }
  | { status: "error"; error: string };

/** One already-loaded candidate row, assembled from `carpool_offers` + host trip + vehicle. */
export interface CarpoolOfferCandidateRow {
  offerId: string;
  hostTripRequestId: string;
  offerStatus: "draft" | "active" | "disabled" | "completed";
  hostTripActive: boolean;
  seatsAvailable: number;
  vehicleSupportsCargo: boolean;
  /** ISO 8601 */
  hostDepartureAt: string;
  hostOrigin: LatLng;
  hostDestination: LatLng;
}

function departureDiffMinutes(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

/**
 * Stage A + cap, shared by the real wrapper (before geocoding) and `runCarpoolSearch`:
 * prefilter FIRST, then sort the survivors deterministically (closest departure, then offer
 * id) and only then truncate to the cap — so the cap can never drop the best candidate in
 * favor of an arbitrary one, and can never be consumed by candidates that fail Stage A.
 */
export function selectShortlistOfferIds(
  prefilterInputs: PrefilterCandidateOffer[],
  maxCandidates: number,
): string[] {
  const byId = new Map(prefilterInputs.map((c) => [c.offerId, c]));
  const survivors = prefilterCandidates(prefilterInputs)
    .filter((r) => r.passed)
    .map((r) => byId.get(r.offerId)!);
  survivors.sort((a, b) => {
    const diff =
      departureDiffMinutes(a.riderRequestedDepartureAt, a.hostDepartureAt) -
      departureDiffMinutes(b.riderRequestedDepartureAt, b.hostDepartureAt);
    if (diff !== 0) return diff;
    return a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0;
  });
  const cap = Number.isFinite(maxCandidates) ? Math.max(0, Math.floor(maxCandidates)) : 0;
  return survivors.slice(0, cap).map((c) => c.offerId);
}

/** Telemetry: how many offers pass Stage A (before the precise-routing cap). */
export function countPrefilterSurvivors(prefilterInputs: PrefilterCandidateOffer[]): number {
  return prefilterCandidates(prefilterInputs).filter((r) => r.passed).length;
}

export function toPrefilterInput(
  candidate: Pick<
    CarpoolOfferCandidateRow,
    | "offerId"
    | "offerStatus"
    | "hostTripActive"
    | "seatsAvailable"
    | "vehicleSupportsCargo"
    | "hostDepartureAt"
  >,
  draft: RiderTripDraft,
  policy: CarpoolPolicyConfig,
): PrefilterCandidateOffer {
  return {
    offerId: candidate.offerId,
    offerStatus: candidate.offerStatus,
    hostTripActive: candidate.hostTripActive,
    seatsAvailable: candidate.seatsAvailable,
    requestedSeats: draft.requestedSeats,
    riderRequiresCargo: draft.requiresCargo,
    vehicleSupportsCargo: candidate.vehicleSupportsCargo,
    hostDepartureAt: candidate.hostDepartureAt,
    riderRequestedDepartureAt: draft.requestedDepartureAt,
    departureWindowMinutes: policy.departureWindowMinutes,
  };
}

export async function runCarpoolSearch(
  riderTripDraft: RiderTripDraft,
  candidates: CarpoolOfferCandidateRow[],
  policy: CarpoolPolicyConfig,
  routingProvider: RoutingProvider,
): Promise<SearchCarpoolResult> {
  // Stage A + deterministic cap, BEFORE any provider call.
  const shortlistIds = new Set(
    selectShortlistOfferIds(
      candidates.map((c) => toPrefilterInput(c, riderTripDraft, policy)),
      policy.maxCandidatesForPreciseRouting,
    ),
  );
  const shortlist = candidates.filter((c) => shortlistIds.has(c.offerId));

  if (shortlist.length === 0) {
    return { status: "matches", matches: [] };
  }

  const matches: CompatibleCarpoolMatch[] = [];
  let unavailableCount = 0;

  for (const candidate of shortlist) {
    const outcome = await routingProvider.evaluateInsertion({
      hostOrigin: candidate.hostOrigin,
      hostDestination: candidate.hostDestination,
      candidatePickup: riderTripDraft.pickup,
      candidateDropoff: riderTripDraft.dropoff,
    });

    if (outcome.status === "unavailable") {
      // Outage / Cost Guard open: excluded, never a reduced-confidence guess.
      unavailableCount += 1;
      continue;
    }

    const result = evaluateRouteMatch({
      policy,
      requestedDepartureAt: riderTripDraft.requestedDepartureAt,
      offerDepartureAt: candidate.hostDepartureAt,
      requestedSeats: riderTripDraft.requestedSeats,
      seatsAvailable: candidate.seatsAvailable,
      hostTripActive: candidate.hostTripActive,
      route: outcome.result,
    });

    // Incompatible candidates are never pushed — absent from results (privacy rule).
    if (result.compatible) {
      matches.push({
        offerId: candidate.offerId,
        hostTripRequestId: candidate.hostTripRequestId,
        additionalDistanceKm: result.additionalDistanceKm,
        additionalTimeMin: result.additionalTimeMin,
        departureDiffMinutes: result.departureDiffMinutes,
        rankingKey: result.rankingKey,
        pickup: riderTripDraft.pickup,
        dropoff: riderTripDraft.dropoff,
      });
    }
  }

  if (unavailableCount === shortlist.length) {
    return { status: "unavailable", reason: "routing_provider_unavailable" };
  }

  matches.sort((a, b) => a.rankingKey - b.rankingKey || (a.offerId < b.offerId ? -1 : 1));
  return { status: "matches", matches };
}
