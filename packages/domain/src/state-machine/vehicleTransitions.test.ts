import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  applyVehicleTransition,
} from "./vehicleTransitions";

describe("applyVehicleTransition (§11 — no raw status writes)", () => {
  it.each([
    ["available", "APPROVE_RESERVATION", "reserved"],
    ["reserved", "BEGIN_PICKUP", "awaiting_pickup"],
    ["awaiting_pickup", "CONFIRM_PICKUP", "in_use"],
    ["reserved", "CONFIRM_PICKUP", "in_use"],
    ["in_use", "BEGIN_RETURN", "returning"],
    ["returning", "COMPLETE_RETURN_INSPECTION_CLEAN", "available"],
    ["returning", "COMPLETE_RETURN_INSPECTION_NEEDS_CLEANING", "cleaning"],
    ["returning", "COMPLETE_RETURN_INSPECTION_NEEDS_CHARGING", "charging"],
    ["returning", "COMPLETE_RETURN_INSPECTION_NEEDS_MAINTENANCE", "maintenance"],
    ["cleaning", "FINISH_CLEANING", "available"],
    ["charging", "FINISH_CHARGING", "available"],
    ["maintenance", "FINISH_MAINTENANCE", "available"],
    ["available", "BLOCK", "blocked"],
    ["in_use", "BLOCK", "blocked"],
    ["blocked", "UNBLOCK", "available"],
  ] as const)("allows %s --%s--> %s", (from, event, to) => {
    expect(applyVehicleTransition(from, event)).toBe(to);
  });

  it("rejects confirming pickup on a vehicle that was never marked awaiting_pickup", () => {
    expect(() => applyVehicleTransition("available", "CONFIRM_PICKUP")).toThrow(
      IllegalTransitionError,
    );
  });

  it("rejects starting a return on a vehicle that isn't in_use", () => {
    expect(() => applyVehicleTransition("maintenance", "BEGIN_RETURN")).toThrow(
      IllegalTransitionError,
    );
  });

  it("rejects double-approving an already reserved vehicle", () => {
    expect(() => applyVehicleTransition("reserved", "APPROVE_RESERVATION")).toThrow(
      IllegalTransitionError,
    );
  });
});
