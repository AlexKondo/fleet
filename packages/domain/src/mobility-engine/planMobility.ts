import type { TripRequest } from "../entities/trip";
import {
  findCarpoolMatches,
  type CarpoolCandidate,
  type CarpoolMatchConfig,
  type CarpoolMatchResult,
} from "../carpool/findCarpoolMatches";
import type { ReadinessConfig } from "../readiness/assessTripReadiness";
import { recommendVehicle, type CandidateVehicle, type RecommendationResult } from "./recommend";

export interface PlanMobilityInput {
  tripRequest: TripRequest;
  carpoolCandidates: CarpoolCandidate[];
  carpoolConfig: CarpoolMatchConfig;
  vehicleCandidates: CandidateVehicle[];
  now: string;
  readinessConfig: ReadinessConfig;
}

export interface MobilityPlan {
  type: "carpool" | "vehicle" | "none";
  carpool?: CarpoolMatchResult;
  vehicle?: RecommendationResult;
  reasons: string[];
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
    return { type: "vehicle", vehicle: recommendation, reasons: recommendation.reasons };
  }

  return { type: "none", reasons: recommendation.reasons };
}
