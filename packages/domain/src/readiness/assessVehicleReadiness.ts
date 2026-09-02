import type { Vehicle } from "../entities/vehicle";

const MAINTENANCE_DUE_SOON_KM = 500;
const LOW_ENERGY_THRESHOLD_PERCENT = 20;

/**
 * General "Vehicle Readiness" (fleet-car-saas.txt §16) — the vehicle's own condition,
 * independent of any specific trip. Distinct from assessTripReadiness, which answers
 * whether a vehicle fits ONE particular trip (§7). Used to drive the Fleet Manager's
 * "needs attention" view (§18), not to gate a reservation by itself.
 */
export function assessVehicleReadiness(vehicle: Vehicle): string[] {
  const reasons: string[] = [];

  if (vehicle.hasBlockingDamage) {
    reasons.push("damage_blocking_trip");
  }
  if (vehicle.missingSafetyEquipment.length > 0) {
    reasons.push("safety_equipment_missing");
  }
  if (!vehicle.documentationValid) {
    reasons.push("documentation_invalid");
  }
  if (
    vehicle.nextServiceOdometerKm !== null &&
    vehicle.nextServiceOdometerKm - vehicle.odometerKm <= MAINTENANCE_DUE_SOON_KM
  ) {
    reasons.push("maintenance_due_soon");
  }
  const energyLevel = vehicle.energyType === "BEV" ? vehicle.batteryLevelPercent : vehicle.fuelLevelPercent;
  if (energyLevel !== null && energyLevel <= LOW_ENERGY_THRESHOLD_PERCENT) {
    reasons.push("energy_low");
  }
  if (!vehicle.isCleanExterior || !vehicle.isCleanInterior) {
    reasons.push("cleaning_required");
  }

  return reasons;
}
