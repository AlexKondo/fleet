import type { TripRequest } from "../entities/trip";
import {
  findCarpoolMatches,
  type CarpoolCandidate,
  type CarpoolMatchConfig,
  type CarpoolMatchResult,
} from "../carpool/findCarpoolMatches";
import type { ReadinessConfig } from "../readiness/assessTripReadiness";
import {
  checkTrafficRestriction,
  defaultTrafficRestrictionConfig,
  type TrafficRestrictionConfig,
  type TrafficRestrictionResult,
} from "../traffic-restriction/checkTrafficRestriction";
import { recommendVehicle, type CandidateVehicle, type RecommendationResult } from "./recommend";

export interface PlanMobilityInput {
  tripRequest: TripRequest;
  carpoolCandidates: CarpoolCandidate[];
  carpoolConfig: CarpoolMatchConfig;
  vehicleCandidates: CandidateVehicle[];
  now: string;
  readinessConfig: ReadinessConfig;
  /** Defaults to `defaultTrafficRestrictionConfig` (§15) when omitted. */
  trafficRestrictionConfig?: TrafficRestrictionConfig;
}

export interface MobilityPlan {
  type: "carpool" | "vehicle" | "none";
  carpool?: CarpoolMatchResult;
  vehicle?: RecommendationResult;
  reasons: string[];
  /**
   * Present only when the recommended vehicle would be affected by a circulation
   * restriction (§15, e.g. São Paulo rodízio) for this specific trip. See the
   * "traffic restriction" comment on `planMobility` for why this is a warning
   * rather than a hard exclusion.
   */
  trafficRestriction?: TrafficRestrictionResult;
}

/**
 * Top-level entry point for the Mobility Decision Engine (fleet-car-saas.txt §17):
 * "1. Já existe viagem compatível para carona? -> não -> 2. Qual veículo melhor atende?"
 * Carpooling is checked first — only falls back to allocating a vehicle when no existing
 * trip can absorb the request.
 */
export function planMobility(input: PlanMobilityInput): MobilityPlan {
  const carpoolResults = findCarpoolMatches(
    input.tripRequest,
    input.carpoolCandidates,
    input.carpoolConfig,
  );
  const bestCarpool = carpoolResults.find((r) => r.compatible);
  if (bestCarpool) {
    return { type: "carpool", carpool: bestCarpool, reasons: ["compatible_trip_found"] };
  }

  const recommendation = recommendVehicle({
    tripRequest: input.tripRequest,
    candidateVehicles: input.vehicleCandidates,
    now: input.now,
    config: input.readinessConfig,
  });

  if (recommendation.recommendedVehicleId) {
    // §15: "Essa informação também poderá participar da recomendação do veículo." We treat
    // this as a soft warning rather than a hard exclusion from candidacy: recommendVehicle
    // (owned elsewhere) already picks the Right Vehicle for the Right Trip on capacity/
    // readiness grounds, and a restricted vehicle may still be the only — or the
    // organization-approved — option for a given trip (e.g. traveling despite the rodízio
    // with an exception permit, or accepting a fine as a business decision). The
    // requirement is that the restriction is never *silently* recommended, so we surface it
    // as an explicit reason plus a dedicated `trafficRestriction` field for the caller to
    // display prominently, rather than filtering the vehicle out here.
    const recommendedCandidate = input.vehicleCandidates.find(
      (c) => c.vehicle.id === recommendation.recommendedVehicleId,
    );
    const trafficRestriction = recommendedCandidate
      ? checkTrafficRestriction(
          recommendedCandidate.vehicle,
          input.tripRequest,
          input.trafficRestrictionConfig ?? defaultTrafficRestrictionConfig,
        )
      : undefined;

    const isRestricted = trafficRestriction?.restricted === true;
    const reasons = isRestricted
      ? [...recommendation.reasons, "traffic_restriction_active"]
      : recommendation.reasons;
    return {
      type: "vehicle",
      // `reasons` is rebuilt here (not just on the top-level MobilityPlan below) because
      // the web UI's vehicle-recommendation branch renders `plan.vehicle.reasons`, not
      // `plan.reasons` — the restriction has to reach the same array the caller actually
      // displays, or the bullet the caller built for this stays permanently empty.
      vehicle: { ...recommendation, reasons },
      reasons,
      trafficRestriction: isRestricted ? trafficRestriction : undefined,
    };
  }

  return { type: "none", reasons: recommendation.reasons };
}
