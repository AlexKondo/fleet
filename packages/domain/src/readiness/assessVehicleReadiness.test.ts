import { describe, expect, it } from "vitest";
import type { Vehicle } from "../entities/vehicle";
import { assessVehicleReadiness } from "./assessVehicleReadiness";

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

describe("assessVehicleReadiness (§16, general — not trip-specific)", () => {
  it("returns no attention flags for a fully fit vehicle", () => {
    expect(assessVehicleReadiness(baseVehicle())).toEqual([]);
  });

  it("flags blocking damage", () => {
    expect(assessVehicleReadiness(baseVehicle({ hasBlockingDamage: true }))).toContain(
      "damage_blocking_trip",
    );
  });

  it("flags missing safety equipment", () => {
    expect(
      assessVehicleReadiness(baseVehicle({ missingSafetyEquipment: ["macaco"] })),
    ).toContain("safety_equipment_missing");
  });

  it("flags invalid documentation", () => {
    expect(assessVehicleReadiness(baseVehicle({ documentationValid: false }))).toContain(
      "documentation_invalid",
    );
  });

  it("flags maintenance due soon (within 500km)", () => {
    expect(
      assessVehicleReadiness(baseVehicle({ odometerKm: 19_600, nextServiceOdometerKm: 20_000 })),
    ).toContain("maintenance_due_soon");
  });

  it("does not flag maintenance far from due", () => {
    expect(
      assessVehicleReadiness(baseVehicle({ odometerKm: 10_000, nextServiceOdometerKm: 20_000 })),
    ).not.toContain("maintenance_due_soon");
  });

  it("flags low battery for a BEV", () => {
    expect(
      assessVehicleReadiness(
        baseVehicle({ energyType: "BEV", fuelLevelPercent: null, batteryLevelPercent: 15 }),
      ),
    ).toContain("energy_low");
  });

  it("flags low fuel for an ICE", () => {
    expect(assessVehicleReadiness(baseVehicle({ fuelLevelPercent: 12 }))).toContain(
      "energy_low",
    );
  });

  it("flags a vehicle needing cleaning", () => {
    expect(assessVehicleReadiness(baseVehicle({ isCleanInterior: false }))).toContain(
      "cleaning_required",
    );
  });
});
