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
  // Raised from 30 per a live report: "mesma região e diferença de 2hrs no retorno
  // deveria permitir o aviso de carona" — the app itself always sources this from
  // organization_settings.carpool_return_tolerance_minutes
  // (0047_carpool_consent_and_tolerance.sql, same 120 default), this constant is the
  // fallback for any other caller (tests, tools) that doesn't load org config.
  returnToleranceMinutes: 120,
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
 * Case/accent/whitespace-insensitive normalization for destination comparison. Exported
 * so callers (e.g. a UI that wants to explain *why* something didn't match) can reuse the
 * exact same normalization the matcher itself uses.
 */
const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

export function normalizeDestination(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_DIACRITICAL_MARKS, "")
    .trim()
    .toLowerCase();
}

/**
 * Two destinations are treated as the same place if they're equal after normalization, or
 * one contains the other (e.g. "São Paulo" vs. "São Paulo - Filial Centro"). This is still
 * a text heuristic, not geocoding — "Av. Paulista" and "Avenida Paulista, 1000" won't
 * match — but it closes the false-negative gap a pure `===` had for the same place typed
 * with different accents, casing, or an added suffix.
 */
function destinationsMatch(a: string, b: string): boolean {
  const normalizedA = normalizeDestination(a);
  const normalizedB = normalizeDestination(b);
  return (
    normalizedA === normalizedB ||
    normalizedA.includes(normalizedB) ||
    normalizedB.includes(normalizedA)
  );
}

/**
 * "Antes de disponibilizar outro veículo, a plataforma verifica se já existe uma viagem
 * compatível." (fleet-car-saas.txt §4). Destination matching is normalized-text for this
 * v1 (see `destinationsMatch`) — true geographic proximity needs geocoding and is out of
 * MVP scope (see workbench Assumptions). Never force a match that violates a hard
 * constraint (capacity, cargo, schedule tolerance): those stay exact, only the free-text
 * destination comparison is loosened.
 */
export function findCarpoolMatches(
  request: TripRequest,
  candidates: CarpoolCandidate[],
  config: CarpoolMatchConfig,
): CarpoolMatchResult[] {
  const results = candidates.map((candidate) => {
    const blockingReasons: string[] = [];
    const positiveReasons: string[] = [];

    if (!destinationsMatch(candidate.existingTrip.destination, request.destination)) {
      blockingReasons.push("destination_mismatch");
    } else {
      positiveReasons.push("destination_match");
    }

    // Only the host's own explicit opt-out blocks — undefined (older records, or a
    // caller that never set it) is treated as consent, same as the field's own default.
    if (candidate.existingTrip.allowCarpool === false) {
      blockingReasons.push("host_declined_carpool");
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
