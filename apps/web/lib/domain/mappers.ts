import type { EnergyType, Vehicle, VehicleCategory } from "@fleet/domain";
import type { Database } from "@fleet/supabase-client";

type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

/**
 * The exact `vehicles` columns `toDomainVehicle` reads — nothing more. Every caller that
 * only needs a domain Vehicle selects this string instead of `*`: the table carries
 * several columns (created_at, updated_at, name, photo_storage_path, pre_block_status)
 * that no readiness/recommendation code path ever looks at, and a wildcard select pays
 * for them on the wire and in Postgres on every fleet-wide query.
 */
export const VEHICLE_DOMAIN_COLUMNS =
  "id, organization_id, plate, category_id, status, odometer_km, fuel_level_percent, battery_level_percent, estimated_range_km, next_service_odometer_km, home_location_id, current_location_id, has_blocking_damage, missing_safety_equipment, documentation_valid, is_clean_exterior, is_clean_interior";

/** Structural shape `VEHICLE_DOMAIN_COLUMNS` produces — a full `VehicleRow` still satisfies it. */
export type VehicleRowForDomain = Pick<
  VehicleRow,
  | "id"
  | "organization_id"
  | "plate"
  | "category_id"
  | "status"
  | "odometer_km"
  | "fuel_level_percent"
  | "battery_level_percent"
  | "estimated_range_km"
  | "next_service_odometer_km"
  | "home_location_id"
  | "current_location_id"
  | "has_blocking_damage"
  | "missing_safety_equipment"
  | "documentation_valid"
  | "is_clean_exterior"
  | "is_clean_interior"
>;

/**
 * Maps a raw `vehicles` row (snake_case, DB-shaped) to the domain Vehicle entity.
 * `energy_type` lives on `vehicle_categories`, not `vehicles` (0026_move_energy_type_to_
 * category.sql) — the caller passes the already-joined category's energy type along.
 */
export function toDomainVehicle(row: VehicleRowForDomain, categoryEnergyType: EnergyType): Vehicle {
  return {
    id: row.id,
    organizationId: row.organization_id,
    plate: row.plate,
    categoryId: row.category_id,
    energyType: categoryEnergyType,
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

/** The exact `vehicle_categories` columns `toDomainCategory` reads (i.e. all but organization_id). */
export const VEHICLE_CATEGORY_DOMAIN_COLUMNS =
  "id, name, passenger_capacity, supports_cargo, energy_type";

export type VehicleCategoryRowForDomain = Pick<
  VehicleCategoryRow,
  "id" | "name" | "passenger_capacity" | "supports_cargo" | "energy_type"
>;

export function toDomainCategory(row: VehicleCategoryRowForDomain): VehicleCategory {
  return {
    id: row.id,
    name: row.name,
    passengerCapacity: row.passenger_capacity,
    supportsCargo: row.supports_cargo,
    energyType: row.energy_type,
  };
}
