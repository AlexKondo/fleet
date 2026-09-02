import type { EnergyType } from "../entities/vehicle";
import type { VehicleTransitionEvent } from "../state-machine/vehicleTransitions";

export type WorkflowTaskType =
  | "repair"
  | "safety"
  | "preventive_maintenance"
  | "cleaning"
  | "fuel"
  | "charging";

export interface ReturnInspection {
  hasNewDamage: boolean;
  missingSafetyEquipment: string[];
  isDirtyExterior: boolean;
  isDirtyInterior: boolean;
  energyType: EnergyType;
  fuelLevelPercent: number | null;
  batteryLevelPercent: number | null;
  maintenanceDueSoon: boolean;
}

export interface ReturnOutcome {
  vehicleEvent: Extract<
    VehicleTransitionEvent,
    | "COMPLETE_RETURN_INSPECTION_CLEAN"
    | "COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING"
    | "COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING"
    | "COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE"
  >;
  workflowTasks: WorkflowTaskType[];
}

const LOW_ENERGY_THRESHOLD_PERCENT = 20;

/**
 * "Uma anomalia deverá gerar automaticamente uma ação" (fleet-car-saas.txt §11). Maps a
 * return checklist straight to a vehicle state transition plus the workflow tasks it
 * spawns — the checklist form calls this instead of deciding vehicle availability itself.
 * Refueling an ICE/PHEV is fast enough to not block availability on its own, so a low
 * fuel level still queues a "fuel" task without forcing the vehicle out of rotation.
 */
export function deriveReturnOutcome(inspection: ReturnInspection): ReturnOutcome {
  const tasks: WorkflowTaskType[] = [];

  if (inspection.hasNewDamage) tasks.push("repair");
  if (inspection.missingSafetyEquipment.length > 0) tasks.push("safety");
  if (inspection.maintenanceDueSoon) tasks.push("preventive_maintenance");
  if (inspection.isDirtyExterior || inspection.isDirtyInterior) tasks.push("cleaning");

  if (
    inspection.energyType === "BEV" &&
    inspection.batteryLevelPercent !== null &&
    inspection.batteryLevelPercent <= LOW_ENERGY_THRESHOLD_PERCENT
  ) {
    tasks.push("charging");
  } else if (
    inspection.energyType !== "BEV" &&
    inspection.fuelLevelPercent !== null &&
    inspection.fuelLevelPercent <= LOW_ENERGY_THRESHOLD_PERCENT
  ) {
    tasks.push("fuel");
  }

  const needsMaintenance = tasks.some((t) => t === "repair" || t === "safety" || t === "preventive_maintenance");
  const needsCleaning = tasks.includes("cleaning");
  const needsCharging = tasks.includes("charging");

  const vehicleEvent: ReturnOutcome["vehicleEvent"] = needsMaintenance
    ? "COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE"
    : needsCleaning
      ? "COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING"
      : needsCharging
        ? "COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING"
        : "COMPLETE_RETURN_INSPECTION_CLEAN";

  return { vehicleEvent, workflowTasks: tasks };
}
