import type { TripRequest } from "../entities/trip";

export interface CarpoolCandidate {
  reservationId: string;
  vehicleId: string;
  /** The trip request behind the already-reserved vehicle. */
  existingTrip: TripRequest;
  vehicleCapacity: number;
  vehicleSupportsCargo: boolean;
  /** Passengers already committed to the existing trip. */
  currentOccupancy: number;
}

export interface CarpoolMatchConfig {
  departureToleranceMinutes: number;
  returnToleranceMinutes: number;
}

export const defaultCarpoolMatchConfig: CarpoolMatchConfig = {
  departureToleranceMinutes: 30,
  returnToleranceMinutes: 30,
};

export interface CarpoolMatchResult {
  reservationId: string;
  vehicleId: string;
  compatible: boolean;
  reasons: string[];
  departureDiffMinutes: number;
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60);
}

/**
 * "Antes de disponibilizar outro veículo, a plataforma verifica se já existe uma viagem
 * compatível." (fleet-car-saas.txt §4). Destination matching is exact-string for this v1
 * — geographic proximity needs geocoding and is out of MVP scope (see workbench
 * Assumptions). Never force a match that violates a hard constraint (capacity, cargo,
 * schedule tolerance).
 */
export function findCarpoolMatches(
  request: TripRequest,
  candidates: CarpoolCandidate[],
  config: CarpoolMatchConfig,
): CarpoolMatchResult[] {
  const results = candidates.map((candidate) => {
    const blockingReasons: string[] = [];
    const positiveReasons: string[] = [];

    if (candidate.existingTrip.destination !== request.destination) {
      blockingReasons.push("destination_mismatch");
    } else {
      positiveReasons.push("destination_match");
    }

    const departureDiffMinutes = minutesBetween(request.departureAt, candidate.existingTrip.departureAt);
    if (departureDiffMinutes > config.departureToleranceMinutes) {
      blockingReasons.push("departure_time_incompatible");
    }

    const returnDiffMinutes = minutesBetween(
      request.expectedReturnAt,
      candidate.existingTrip.expectedReturnAt,
    );
    if (returnDiffMinutes > config.returnToleranceMinutes) {
      blockingReasons.push("return_time_incompatible");
    }

    const remainingCapacity = candidate.vehicleCapacity - candidate.currentOccupancy;
    if (remainingCapacity < request.passengerCount) {
      blockingReasons.push("capacity_exhausted");
    }

    if (request.requiresCargo && !candidate.vehicleSupportsCargo) {
      blockingReasons.push("cargo_unsupported");
    }

    return {
      reservationId: candidate.reservationId,
      vehicleId: candidate.vehicleId,
      compatible: blockingReasons.length === 0,
      reasons: [...positiveReasons, ...blockingReasons],
      departureDiffMinutes,
    };
  });

  return results.sort((a, b) => {
    if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
    return a.departureDiffMinutes - b.departureDiffMinutes;
  });
}
