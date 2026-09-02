import { describe, expect, it } from "vitest";
import { deriveReturnOutcome, type ReturnInspection } from "./deriveReturnOutcome";

function inspection(overrides: Partial<ReturnInspection> = {}): ReturnInspection {
  return {
    hasNewDamage: false,
    missingSafetyEquipment: [],
    isDirtyExterior: false,
    isDirtyInterior: false,
    energyType: "ICE",
    fuelLevelPercent: 80,
    batteryLevelPercent: null,
    maintenanceDueSoon: false,
    ...overrides,
  };
}

describe("deriveReturnOutcome (§11 — checklist is a trigger, not just a record)", () => {
  it("routes a clean, fit vehicle straight back to available", () => {
    const result = deriveReturnOutcome(inspection());
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_CLEAN");
    expect(result.workflowTasks).toEqual([]);
  });

  it("routes new damage to maintenance with a repair task, overriding lesser issues", () => {
    const result = deriveReturnOutcome(inspection({ hasNewDamage: true, isDirtyExterior: true }));
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE");
    expect(result.workflowTasks).toContain("repair");
  });

  it("routes missing safety equipment to maintenance with a safety task", () => {
    const result = deriveReturnOutcome(inspection({ missingSafetyEquipment: ["triangulo"] }));
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE");
    expect(result.workflowTasks).toContain("safety");
  });

  it("routes maintenance-due-soon to maintenance with a preventive task", () => {
    const result = deriveReturnOutcome(inspection({ maintenanceDueSoon: true }));
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE");
    expect(result.workflowTasks).toContain("preventive_maintenance");
  });

  it("routes a dirty vehicle to cleaning when nothing more critical is pending", () => {
    const result = deriveReturnOutcome(inspection({ isDirtyInterior: true }));
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING");
    expect(result.workflowTasks).toContain("cleaning");
  });

  it("routes a low-battery BEV to charging when nothing more critical is pending", () => {
    const result = deriveReturnOutcome(
      inspection({ energyType: "BEV", fuelLevelPercent: null, batteryLevelPercent: 15 }),
    );
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING");
    expect(result.workflowTasks).toContain("charging");
  });

  it("does not block on low fuel for an ICE vehicle, but still queues a fuel task", () => {
    const result = deriveReturnOutcome(inspection({ fuelLevelPercent: 10 }));
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_CLEAN");
    expect(result.workflowTasks).toContain("fuel");
  });

  it("prioritizes maintenance over cleaning and charging when several issues coexist", () => {
    const result = deriveReturnOutcome(
      inspection({
        hasNewDamage: true,
        isDirtyExterior: true,
        energyType: "BEV",
        fuelLevelPercent: null,
        batteryLevelPercent: 10,
      }),
    );
    expect(result.vehicleEvent).toBe("COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE");
    expect(result.workflowTasks).toEqual(
      expect.arrayContaining(["repair", "cleaning", "charging"]),
    );
  });
});
