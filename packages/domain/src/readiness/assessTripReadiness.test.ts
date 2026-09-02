import { describe, expect, it } from "vitest";
import type { Vehicle } from "../entities/vehicle";
import type { TripRequest } from "../entities/trip";
import { assessTripReadiness, defaultReadinessConfig } from "./assessTripReadiness";

const now = "2026-09-10T06:00:00Z";

function baseVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "veh-1",
    organizationId: "org-1",
    plate: "ABC1D23",
    categoryId: "cat-sedan",
    energyType: "ICE",
    status: "available",
    odometerKm: 18_900,
    fuelLevelPercent: 90,
    batteryLevelPercent: null,
    estimatedRangeKm: 500,
    nextServiceOdometerKm: 20_000,
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

function baseTrip(overrides: Partial<TripRequest> = {}): TripRequest {
  return {
    id: "trip-1",
    organizationId: "org-1",
    requesterId: "user-1",
    departureAt: "2026-09-10T08:00:00Z",
    expectedReturnAt: "2026-09-10T18:00:00Z",
    origin: "Iracemápolis",
    destination: "São Paulo",
    distanceKm: 300,
    passengerCount: 1,
    requiresCargo: false,
    justification: "Reunião",
    ...overrides,
  };
}

describe("assessTripReadiness", () => {
  it("returns READY when the vehicle is fully fit for the trip", () => {
    const result = assessTripReadiness(baseVehicle(), baseTrip(), now, defaultReadinessConfig);
    expect(result.status).toBe("READY");
    expect(result.reasons).toEqual([]);
  });

  it("returns NOT_READY when there is not enough range and no time to prepare (ORA 03 example, §7)", () => {
    const vehicle = baseVehicle({
      energyType: "BEV",
      fuelLevelPercent: null,
      batteryLevelPercent: 10,
      estimatedRangeKm: 20,
    });
    const trip = baseTrip({
      distanceKm: 150,
      departureAt: "2026-09-10T06:30:00Z",
    });
    const result = assessTripReadiness(vehicle, trip, now, defaultReadinessConfig);
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toContain("range_insufficient");
  });

  it("returns READY_IF_PREPARED when range is short but there is time to charge before departure", () => {
    const vehicle = baseVehicle({
      energyType: "BEV",
      fuelLevelPercent: null,
      batteryLevelPercent: 15,
      estimatedRangeKm: 60,
    });
    const trip = baseTrip({
      distanceKm: 300,
      departureAt: "2026-09-10T14:00:00Z",
    });
    const result = assessTripReadiness(vehicle, trip, now, defaultReadinessConfig);
    expect(result.status).toBe("READY_IF_PREPARED");
    expect(result.reasons).toContain("energy_insufficient");
    expect(result.requiredPreparation).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "charge" })]),
    );
  });

  it("returns NOT_READY when maintenance is due before the trip distance would be covered", () => {
    const vehicle = baseVehicle({ odometerKm: 19_950, nextServiceOdometerKm: 20_000 });
    const trip = baseTrip({ distanceKm: 300 });
    const result = assessTripReadiness(vehicle, trip, now, defaultReadinessConfig);
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toContain("maintenance_due");
  });

  it("returns NOT_READY for a vehicle with blocking damage", () => {
    const result = assessTripReadiness(
      baseVehicle({ hasBlockingDamage: true }),
      baseTrip(),
      now,
      defaultReadinessConfig,
    );
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toContain("damage_blocking_trip");
  });

  it("returns NOT_READY when required safety equipment is missing", () => {
    const result = assessTripReadiness(
      baseVehicle({ missingSafetyEquipment: ["triangulo"] }),
      baseTrip(),
      now,
      defaultReadinessConfig,
    );
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toContain("safety_equipment_missing");
  });

  it("returns NOT_READY when documentation is invalid", () => {
    const result = assessTripReadiness(
      baseVehicle({ documentationValid: false }),
      baseTrip(),
      now,
      defaultReadinessConfig,
    );
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toContain("documentation_invalid");
  });

  it("returns READY_IF_PREPARED when the vehicle needs cleaning but there is time before departure", () => {
    const trip = baseTrip({ departureAt: "2026-09-10T09:00:00Z" });
    const result = assessTripReadiness(
      baseVehicle({ isCleanExterior: false }),
      trip,
      now,
      defaultReadinessConfig,
    );
    expect(result.status).toBe("READY_IF_PREPARED");
    expect(result.reasons).toContain("cleaning_required");
  });
});
