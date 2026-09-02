import { describe, expect, it } from "vitest";
import type { TripRequest } from "../entities/trip";
import type { Vehicle, VehicleCategory } from "../entities/vehicle";
import { defaultReadinessConfig } from "../readiness/assessTripReadiness";
import { defaultCarpoolMatchConfig, type CarpoolCandidate } from "../carpool/findCarpoolMatches";
import { planMobility } from "./planMobility";

const now = "2026-09-10T06:00:00Z";

function trip(overrides: Partial<TripRequest> = {}): TripRequest {
  return {
    id: "trip-new",
    organizationId: "org-1",
    requesterId: "user-2",
    departureAt: "2026-09-10T08:00:00Z",
    expectedReturnAt: "2026-09-10T18:00:00Z",
    origin: "Iracemápolis",
    destination: "São Paulo",
    distanceKm: 260,
    passengerCount: 1,
    requiresCargo: false,
    justification: "Reunião",
    ...overrides,
  };
}

const sedanCategory: VehicleCategory = {
  id: "cat-sedan",
  name: "Sedan",
  passengerCapacity: 5,
  supportsCargo: false,
};

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "veh-sedan",
    organizationId: "org-1",
    plate: "AAA0A00",
    categoryId: "cat-sedan",
    energyType: "ICE",
    status: "available",
    odometerKm: 10_000,
    fuelLevelPercent: 90,
    batteryLevelPercent: null,
    estimatedRangeKm: 500,
    nextServiceOdometerKm: 30_000,
    homeLocationId: "loc-p1",
    currentLocationId: "loc-p1",
    hasBlockingDamage: false,
    missingSafetyEquipment: [],
    documentationValid: true,
    isCleanExterior: true,
    isCleanInterior: true,
    ...overrides,
  };
}

describe("planMobility (§17 — Mobility Decision Engine)", () => {
  it("prefers a compatible carpool over allocating a new vehicle", () => {
    const carpoolCandidates: CarpoolCandidate[] = [
      {
        reservationId: "res-1",
        vehicleId: "veh-suv",
        existingTrip: trip({ id: "t2", departureAt: "2026-09-10T07:45:00Z" }),
        vehicleCapacity: 5,
        vehicleSupportsCargo: false,
        currentOccupancy: 2,
      },
    ];

    const result = planMobility({
      tripRequest: trip(),
      carpoolCandidates,
      carpoolConfig: defaultCarpoolMatchConfig,
      vehicleCandidates: [{ vehicle: vehicle(), category: sedanCategory }],
      now,
      readinessConfig: defaultReadinessConfig,
    });

    expect(result.type).toBe("carpool");
    expect(result.carpool?.reservationId).toBe("res-1");
    expect(result.vehicle).toBeUndefined();
  });

  it("falls back to vehicle recommendation when no carpool is compatible", () => {
    const result = planMobility({
      tripRequest: trip(),
      carpoolCandidates: [],
      carpoolConfig: defaultCarpoolMatchConfig,
      vehicleCandidates: [{ vehicle: vehicle(), category: sedanCategory }],
      now,
      readinessConfig: defaultReadinessConfig,
    });

    expect(result.type).toBe("vehicle");
    expect(result.vehicle?.recommendedVehicleId).toBe("veh-sedan");
    expect(result.carpool).toBeUndefined();
  });

  it("returns none with an explanation when nothing works", () => {
    const result = planMobility({
      tripRequest: trip({ passengerCount: 99 }),
      carpoolCandidates: [],
      carpoolConfig: defaultCarpoolMatchConfig,
      vehicleCandidates: [{ vehicle: vehicle(), category: sedanCategory }],
      now,
      readinessConfig: defaultReadinessConfig,
    });

    expect(result.type).toBe("none");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
