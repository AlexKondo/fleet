import type { VehicleStatus } from "../entities/vehicle";

export type VehicleTransitionEvent =
  | "APPROVE_RESERVATION"
  | "BEGIN_PICKUP"
  | "CONFIRM_PICKUP"
  | "BEGIN_RETURN"
  | "COMPLETE_RETURN_INSPECTION_CLEAN"
  | "COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING"
  | "COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING"
  | "COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE"
  | "FINISH_CLEANING"
  | "FINISH_CHARGING"
  | "START_MAINTENANCE"
  | "FINISH_MAINTENANCE"
  | "BLOCK"
  | "UNBLOCK";

export class IllegalTransitionError extends Error {
  constructor(from: VehicleStatus, event: VehicleTransitionEvent) {
    super(`Cannot apply "${event}" to a vehicle in status "${from}".`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * The only legal source status for each event, mapped to the resulting status. UI and
 * API code must call applyVehicleTransition() instead of assigning vehicle.status
 * directly (fleet-car-saas.txt §11 — "Available" being true today says nothing about
 * whether an arbitrary status jump tomorrow is a legal operation).
 */
const TRANSITIONS: Record<VehicleTransitionEvent, Partial<Record<VehicleStatus, VehicleStatus>>> = {
  APPROVE_RESERVATION: { available: "reserved" },
  BEGIN_PICKUP: { reserved: "awaiting_pickup" },
  CONFIRM_PICKUP: { awaiting_pickup: "in_use", reserved: "in_use" },
  BEGIN_RETURN: { in_use: "returning" },
  COMPLETE_RETURN_INSPECTION_CLEAN: { returning: "available" },
  COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING: { returning: "cleaning" },
  COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING: { returning: "charging" },
  COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE: { returning: "maintenance" },
  FINISH_CLEANING: { cleaning: "available" },
  FINISH_CHARGING: { charging: "available" },
  START_MAINTENANCE: {
    available: "maintenance",
    blocked: "maintenance",
    returning: "maintenance",
  },
  FINISH_MAINTENANCE: { maintenance: "available" },
  BLOCK: {
    available: "blocked",
    reserved: "blocked",
    awaiting_pickup: "blocked",
    in_use: "blocked",
    returning: "blocked",
    inspection: "blocked",
    charging: "blocked",
    cleaning: "blocked",
    maintenance: "blocked",
  },
  UNBLOCK: { blocked: "available" },
};

export function applyVehicleTransition(
  from: VehicleStatus,
  event: VehicleTransitionEvent,
): VehicleStatus {
  const to = TRANSITIONS[event][from];
  if (!to) {
    throw new IllegalTransitionError(from, event);
  }
  return to;
}
