export type EnergyType = "ICE" | "PHEV" | "BEV" | "HEV";

/**
 * "Available" na frota física não implica "Ready for Trip" (fleet-car-saas.txt §6).
 * Esses são os estados operacionais canônicos; transições devem passar por comandos
 * de domínio (reserveVehicle, startPickup, etc.), nunca por atribuição direta.
 */
export type VehicleStatus =
  | "available"
  | "reserved"
  | "awaiting_pickup"
  | "in_use"
  | "returning"
  | "inspection"
  | "charging"
  | "cleaning"
  | "maintenance"
  | "blocked";

export interface VehicleCategory {
  id: string;
  name: string;
  passengerCapacity: number;
  supportsCargo: boolean;
  /** Every vehicle added to this category shares this energy type — set once per
   * category rather than per vehicle, since a category groups vehicles that are
   * operationally interchangeable, including how they're refueled/recharged. */
  energyType: EnergyType;
}

export interface VehicleLocation {
  id: string;
  name: string;
}

export interface Vehicle {
  id: string;
  organizationId: string;
  plate: string;
  categoryId: string;
  /** Denormalized from the vehicle's own category (`VehicleCategory.energyType`) at
   * mapping time — not a column on the vehicles table itself. Kept here so every
   * existing domain function that reasons about a single Vehicle (readiness, ranking,
   * traffic restrictions) doesn't need a second category lookup. */
  energyType: EnergyType;
  status: VehicleStatus;
  odometerKm: number;
  /** 0-100. null quando não aplicável ao energyType (ex.: BEV puro sem combustível). */
  fuelLevelPercent: number | null;
  /** 0-100. null quando não aplicável ao energyType (ex.: ICE puro sem bateria de tração). */
  batteryLevelPercent: number | null;
  /** Autonomia estimada combinada para o estado energético atual do veículo. */
  estimatedRangeKm: number;
  nextServiceOdometerKm: number | null;
  homeLocationId: string;
  currentLocationId: string;
  hasBlockingDamage: boolean;
  /** Itens de equipamento de segurança obrigatórios atualmente ausentes. */
  missingSafetyEquipment: string[];
  documentationValid: boolean;
  isCleanExterior: boolean;
  isCleanInterior: boolean;
}
