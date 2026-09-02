import type { TripRequest } from "../entities/trip";
import type { Vehicle } from "../entities/vehicle";

export type ReadinessStatus = "READY" | "NOT_READY" | "READY_IF_PREPARED";

export interface PreparationAction {
  type: "charge" | "refuel" | "clean";
  /** ISO 8601 — start of the window available to perform the preparation. */
  windowStart: string;
  /** ISO 8601 — must complete before this (typically the trip's departureAt). */
  windowEnd: string;
}

export interface ReadinessResult {
  status: ReadinessStatus;
  reasons: string[];
  requiredPreparation?: PreparationAction[];
}

export interface ReadinessConfig {
  /** % of estimated range withheld as safety margin before comparing against trip distance. */
  rangeSafetyBufferPercent: number;
  minChargeHoursBEV: number;
  minRefuelHoursICEorPHEV: number;
  minCleaningHours: number;
}

export const defaultReadinessConfig: ReadinessConfig = {
  rangeSafetyBufferPercent: 20,
  minChargeHoursBEV: 6,
  minRefuelHoursICEorPHEV: 1,
  minCleaningHours: 1,
};

function hoursBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60);
}

/**
 * Answers "is THIS vehicle apt for THIS specific trip?" (fleet-car-saas.txt §7), not just
 * whether the vehicle is generically operational. Hard blockers always yield NOT_READY;
 * energy and cleaning gaps become READY_IF_PREPARED when there is time to fix them before
 * departure, otherwise they also become NOT_READY.
 */
export function assessTripReadiness(
  vehicle: Vehicle,
  trip: TripRequest,
  now: string,
  config: ReadinessConfig,
): ReadinessResult {
  const blocking: string[] = [];
  const preparable: { reason: string; action: PreparationAction }[] = [];

  if (vehicle.hasBlockingDamage) {
    blocking.push("damage_blocking_trip");
  }
  if (vehicle.missingSafetyEquipment.length > 0) {
    blocking.push("safety_equipment_missing");
  }
  if (!vehicle.documentationValid) {
    blocking.push("documentation_invalid");
  }
  if (
    vehicle.nextServiceOdometerKm !== null &&
    vehicle.odometerKm + trip.distanceKm >= vehicle.nextServiceOdometerKm
  ) {
    blocking.push("maintenance_due");
  }

  const usableRangeKm = vehicle.estimatedRangeKm * (1 - config.rangeSafetyBufferPercent / 100);
  if (usableRangeKm < trip.distanceKm) {
    const hoursUntilDeparture = hoursBetween(now, trip.departureAt);
    const requiredHours =
      vehicle.energyType === "BEV" ? config.minChargeHoursBEV : config.minRefuelHoursICEorPHEV;
    if (hoursUntilDeparture >= requiredHours) {
      preparable.push({
        reason: "energy_insufficient",
        action: {
          type: vehicle.energyType === "BEV" ? "charge" : "refuel",
          windowStart: now,
          windowEnd: trip.departureAt,
        },
      });
    } else {
      blocking.push("range_insufficient");
    }
  }

  if (!vehicle.isCleanExterior || !vehicle.isCleanInterior) {
    const hoursUntilDeparture = hoursBetween(now, trip.departureAt);
    if (hoursUntilDeparture >= config.minCleaningHours) {
      preparable.push({
        reason: "cleaning_required",
        action: { type: "clean", windowStart: now, windowEnd: trip.departureAt },
      });
    } else {
      blocking.push("cleaning_required");
    }
  }

  if (blocking.length > 0) {
    return { status: "NOT_READY", reasons: blocking };
  }
  if (preparable.length > 0) {
    return {
      status: "READY_IF_PREPARED",
      reasons: preparable.map((p) => p.reason),
      requiredPreparation: preparable.map((p) => p.action),
    };
  }
  return { status: "READY", reasons: [] };
}
