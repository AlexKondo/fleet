import { describe, expect, it } from "vitest";
import type { Vehicle, VehicleCategory } from "../entities/vehicle";
import type { TripRequest } from "../entities/trip";
import { defaultReadinessConfig } from "../readiness/assessTripReadiness";
import { recommendVehicle } from "./recommend";

const now = "2026-09-10T06:00:00Z";

const sedanCategory: VehicleCategory = {
  id: "cat-sedan",
  name: "Sedan",
  passengerCapacity: 5,
  supportsCargo: false,
  energyType: "ICE",
};

const cargoCategory: VehicleCategory = {
  id: "cat-cargo",
  name: "Pickup (Poer P30)",
  passengerCapacity: 3,
  supportsCargo: true,
  energyType: "ICE",
};

const compactEvCategory: VehicleCategory = {
  id: "cat-ev-compact",
  name: "Compact EV (ORA 03)",
  passengerCapacity: 4,
  supportsCargo: false,
  energyType: "BEV",
};

function vehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: "veh",
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

function trip(overrides: Partial<TripRequest> = {}): TripRequest {
  return {
    id: "trip",
    organizationId: "org-1",
    requesterId: "user-1",
    departureAt: "2026-09-10T08:00:00Z",
    expectedReturnAt: "2026-09-10T18:00:00Z",
    origin: "Iracemápolis",
    destination: "São Paulo",
    distanceKm: 200,
    passengerCount: 1,
    requiresCargo: false,
    justification: "Reunião",
    ...overrides,
  };
}

describe("recommendVehicle", () => {
  it("recommends the cargo-capable vehicle for a cargo trip (§3 example: Poer P30)", () => {
    const candidates = [
      { vehicle: vehicle({ id: "veh-sedan", categoryId: "cat-sedan" }), category: sedanCategory },
      { vehicle: vehicle({ id: "veh-cargo", categoryId: "cat-cargo" }), category: cargoCategory },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ requiresCargo: true, passengerCount: 2 }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBe("veh-cargo");
    expect(result.rejectedAlternatives.map((r) => r.vehicleId)).toContain("veh-sedan");
  });

  it("avoids an oversized vehicle for a short solo trip without cargo (§3 example)", () => {
    const candidates = [
      { vehicle: vehicle({ id: "veh-sedan", categoryId: "cat-sedan" }), category: sedanCategory },
      {
        vehicle: vehicle({
          id: "veh-ev",
          categoryId: "cat-ev-compact",
          energyType: "BEV",
          fuelLevelPercent: null,
          batteryLevelPercent: 80,
          estimatedRangeKm: 120,
        }),
        category: compactEvCategory,
      },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ passengerCount: 1, distanceKm: 40 }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBe("veh-ev");
  });

  it("excludes a BEV without enough range and no time to charge, explaining why", () => {
    const candidates = [
      {
        vehicle: vehicle({
          id: "veh-ev-low",
          categoryId: "cat-ev-compact",
          energyType: "BEV",
          fuelLevelPercent: null,
          batteryLevelPercent: 10,
          estimatedRangeKm: 20,
        }),
        category: compactEvCategory,
      },
      { vehicle: vehicle({ id: "veh-sedan", categoryId: "cat-sedan" }), category: sedanCategory },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ distanceKm: 150, departureAt: "2026-09-10T06:30:00Z" }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBe("veh-sedan");
    const rejected = result.rejectedAlternatives.find((r) => r.vehicleId === "veh-ev-low");
    expect(rejected?.reasons).toContain("range_insufficient");
  });

  it("prefers a smaller electric vehicle over a cargo-capable pickup for a solo, non-cargo trip (§3: avoid unnecessary use of larger vehicles)", () => {
    const candidates = [
      { vehicle: vehicle({ id: "veh-cargo", categoryId: "cat-cargo" }), category: cargoCategory },
      {
        vehicle: vehicle({
          id: "veh-ev",
          categoryId: "cat-ev-compact",
          energyType: "BEV",
          fuelLevelPercent: null,
          batteryLevelPercent: 80,
          estimatedRangeKm: 120,
        }),
        category: compactEvCategory,
      },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ passengerCount: 1, distanceKm: 40, requiresCargo: false }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBe("veh-ev");
  });

  it("excludes a vehicle whose category cannot seat the requested passengers", () => {
    const candidates = [
      { vehicle: vehicle({ id: "veh-cargo", categoryId: "cat-cargo" }), category: cargoCategory },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ passengerCount: 4 }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBeNull();
    expect(result.rejectedAlternatives[0]?.reasons).toContain("capacity_insufficient");
  });

  it("exposes every eligible vehicle ranked best-first, not just the winner (BR-005 USER_CHOICE/HYBRID booking modes)", () => {
    const candidates = [
      { vehicle: vehicle({ id: "veh-cargo", categoryId: "cat-cargo" }), category: cargoCategory },
      { vehicle: vehicle({ id: "veh-sedan", categoryId: "cat-sedan" }), category: sedanCategory },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ passengerCount: 1, requiresCargo: false }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBe("veh-sedan");
    expect(result.rankedEligible.map((r) => r.vehicleId)).toEqual(["veh-sedan", "veh-cargo"]);
  });

  it("returns an empty rankedEligible list (not an error) when no candidates are eligible", () => {
    const candidates = [
      { vehicle: vehicle({ id: "veh-cargo", categoryId: "cat-cargo" }), category: cargoCategory },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ passengerCount: 4 }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.rankedEligible).toEqual([]);
  });

  it("breaks ties between equally-suitable vehicles by odometer (lower first), instead of always picking whichever came first from the database", () => {
    const candidates = [
      { vehicle: vehicle({ id: "veh-high-mileage", odometerKm: 20_000 }), category: sedanCategory },
      { vehicle: vehicle({ id: "veh-low-mileage", odometerKm: 5_000 }), category: sedanCategory },
    ];
    const result = recommendVehicle({
      tripRequest: trip({ passengerCount: 1 }),
      candidateVehicles: candidates,
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBe("veh-low-mileage");
    expect(result.rankedEligible.map((r) => r.vehicleId)).toEqual(["veh-low-mileage", "veh-high-mileage"]);
  });

  it("returns null with an explanation when no candidates are eligible", () => {
    const result = recommendVehicle({
      tripRequest: trip(),
      candidateVehicles: [],
      now,
      config: defaultReadinessConfig,
    });
    expect(result.recommendedVehicleId).toBeNull();
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
