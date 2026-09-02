import type { Vehicle, VehicleCategory } from "@fleet/domain";
import type { Database } from "@fleet/supabase-client";

type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

/** Maps a raw `vehicles` row (snake_case, DB-shaped) to the domain Vehicle entity. */
export function toDomainVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    organizationId: row.organization_id,
    plate: row.plate,
    categoryId: row.category_id,
    energyType: row.energy_type,
    status: row.status,
    odometerKm: row.odometer_km,
    fuelLevelPercent: row.fuel_level_percent,
    batteryLevelPercent: row.battery_level_percent,
    estimatedRangeKm: row.estimated_range_km,
    nextServiceOdometerKm: row.next_service_odometer_km,
    homeLocationId: row.home_location_id ?? "",
    currentLocationId: row.current_location_id ?? "",
    hasBlockingDamage: row.has_blocking_damage,
    missingSafetyEquipment: row.missing_safety_equipment,
    documentationValid: row.documentation_valid,
    isCleanExterior: row.is_clean_exterior,
    isCleanInterior: row.is_clean_interior,
  };
}

type VehicleCategoryRow = Database["public"]["Tables"]["vehicle_categories"]["Row"];

export function toDomainCategory(row: VehicleCategoryRow): VehicleCategory {
  return {
    id: row.id,
    name: row.name,
    passengerCapacity: row.passenger_capacity,
    supportsCargo: row.supports_cargo,
  };
}
