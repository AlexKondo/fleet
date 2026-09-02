import type { TripRequest } from "../entities/trip";
import type { Vehicle, VehicleCategory, VehicleStatus } from "../entities/vehicle";
import {
  assessTripReadiness,
  type PreparationAction,
  type ReadinessConfig,
} from "../readiness/assessTripReadiness";

export interface CandidateVehicle {
  vehicle: Vehicle;
  category: VehicleCategory;
}

export interface RecommendationInput {
  tripRequest: TripRequest;
  /**
   * Vehicles to consider. Callers are responsible for pre-filtering out vehicles that
   * would double-book (see reservation/availability.ts) — this engine reasons about
   * suitability and readiness, not scheduling conflicts.
   */
  candidateVehicles: CandidateVehicle[];
  now: string;
  config: ReadinessConfig;
}

export interface RejectedAlternative {
  vehicleId: string;
  reasons: string[];
}

export interface RecommendationResult {
  recommendedVehicleId: string | null;
  reasons: string[];
  rejectedAlternatives: RejectedAlternative[];
  requiredPreparation?: PreparationAction[];
}

/**
 * Statuses from which a vehicle could realistically become Ready for Trip. Vehicles
 * already committed elsewhere (in_use, returning, inspection) or hard-blocked
 * (maintenance, blocked, reserved) are excluded from this engine's candidate pool.
 */
const OPERATIONALLY_CANDIDATE_STATUSES: VehicleStatus[] = ["available", "charging", "cleaning"];

interface EligibleCandidate {
  vehicleId: string;
  category: VehicleCategory;
  energyType: Vehicle["energyType"];
  /** 0 = fully READY, 1 = READY_IF_PREPARED. Lower tier always wins. */
  tier: 0 | 1;
  reasons: string[];
  requiredPreparation?: PreparationAction[];
}

/**
 * "Qual veículo atende melhor esta necessidade específica?" (fleet-car-saas.txt §3).
 * Pipeline: eligibility filter (hard constraints) → Trip-Specific Readiness →
 * ranking (Right Vehicle for the Right Trip, avoiding oversized vehicles) → explanation.
 * Carpooling matching is a separate, earlier stage in the Mobility Decision Engine and is
 * intentionally out of scope for this v1 (see workbench W4).
 */
export function recommendVehicle(input: RecommendationInput): RecommendationResult {
  const { tripRequest, candidateVehicles, now, config } = input;

  if (candidateVehicles.length === 0) {
    return {
      recommendedVehicleId: null,
      reasons: ["no_candidates_available"],
      rejectedAlternatives: [],
    };
  }

  const eligible: EligibleCandidate[] = [];
  const rejected: RejectedAlternative[] = [];

  for (const { vehicle, category } of candidateVehicles) {
    const hardReasons: string[] = [];
    if (category.passengerCapacity < tripRequest.passengerCount) {
      hardReasons.push("capacity_insufficient");
    }
    if (tripRequest.requiresCargo && !category.supportsCargo) {
      hardReasons.push("cargo_unsupported");
    }
    if (!OPERATIONALLY_CANDIDATE_STATUSES.includes(vehicle.status)) {
      hardReasons.push("vehicle_not_operationally_available");
    }

    if (hardReasons.length > 0) {
      rejected.push({ vehicleId: vehicle.id, reasons: hardReasons });
      continue;
    }

    const readiness = assessTripReadiness(vehicle, tripRequest, now, config);
    if (readiness.status === "NOT_READY") {
      rejected.push({ vehicleId: vehicle.id, reasons: readiness.reasons });
      continue;
    }

    eligible.push({
      vehicleId: vehicle.id,
      category,
      energyType: vehicle.energyType,
      tier: readiness.status === "READY" ? 0 : 1,
      reasons:
        readiness.status === "READY"
          ? [
              "passenger_capacity_sufficient",
              ...(tripRequest.requiresCargo ? ["cargo_capable"] : []),
            ]
          : readiness.reasons,
      requiredPreparation: readiness.requiredPreparation,
    });
  }

  if (eligible.length === 0) {
    return {
      recommendedVehicleId: null,
      reasons: ["no_eligible_vehicle_for_trip_requirements"],
      rejectedAlternatives: rejected,
    };
  }

  // Right Vehicle for the Right Trip (§3): prefer fully-ready candidates, then avoid
  // unnecessary use of larger/cargo-capable vehicles when the trip doesn't need one,
  // then prefer electric over combustion when adequate, then the smallest adequate
  // seating capacity. Passenger capacity alone is a poor size proxy — a 3-seat cargo
  // pickup is not "smaller" than a 4-seat compact EV for a solo trip with no cargo.
  const rankScore = (c: EligibleCandidate): number => {
    const unnecessaryCargo = c.category.supportsCargo && !tripRequest.requiresCargo ? 1 : 0;
    const notElectric = c.energyType !== "BEV" ? 1 : 0;
    return c.tier * 1000 + unnecessaryCargo * 100 + notElectric * 10 + c.category.passengerCapacity;
  };
  eligible.sort((a, b) => rankScore(a) - rankScore(b));
  const [winner, ...losers] = eligible as [EligibleCandidate, ...EligibleCandidate[]];

  for (const loser of losers) {
    rejected.push({
      vehicleId: loser.vehicleId,
      reasons: ["not_selected_better_candidate_available"],
    });
  }

  return {
    recommendedVehicleId: winner.vehicleId,
    reasons: winner.reasons,
    rejectedAlternatives: rejected,
    requiredPreparation: winner.requiredPreparation,
  };
}
