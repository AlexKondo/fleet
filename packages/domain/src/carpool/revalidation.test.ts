import { describe, expect, it } from "vitest";
import {
  evaluateHostTripRevalidation,
  invalidateLiveRequest,
  normalizeAddress,
  type HostTripRevalidationInput,
} from "./revalidation";

function input(overrides: Partial<HostTripRevalidationInput> = {}): HostTripRevalidationInput {
  return {
    hostTripActive: true,
    requestedDepartureAt: "2026-10-01T12:00:00.000Z",
    hostDepartureAt: "2026-10-01T12:00:00.000Z",
    departureWindowMinutes: 15,
    snapshotOrigin: "Sede GWM",
    snapshotDestination: "Shopping Morumbi",
    currentOrigin: "Sede GWM",
    currentDestination: "Shopping Morumbi",
    ...overrides,
  };
}

describe("invalidateLiveRequest", () => {
  it("invalidates PENDING and ACCEPTED", () => {
    expect(invalidateLiveRequest({ status: "PENDING" })).toEqual({ ok: true, state: { status: "INVALIDATED" } });
    expect(invalidateLiveRequest({ status: "ACCEPTED" })).toEqual({ ok: true, state: { status: "INVALIDATED" } });
  });
  it("never resurrects or rewrites terminal states", () => {
    for (const status of ["REJECTED", "EXPIRED", "CANCELLED", "INVALIDATED"] as const) {
      expect(invalidateLiveRequest({ status }).ok).toBe(false);
    }
  });
});

describe("normalizeAddress", () => {
  it("trims, collapses whitespace and lowercases", () => {
    expect(normalizeAddress("  Shopping   MORUMBI ")).toBe("shopping morumbi");
    expect(normalizeAddress(null)).toBe("");
  });
});

describe("evaluateHostTripRevalidation", () => {
  it("returns null when nothing material changed", () => {
    expect(evaluateHostTripRevalidation(input())).toBeNull();
  });
  it("cosmetic whitespace/case edits are not a route change", () => {
    expect(evaluateHostTripRevalidation(input({ currentDestination: "  shopping   morumbi " }))).toBeNull();
  });
  it("host trip cancelled wins over everything", () => {
    expect(
      evaluateHostTripRevalidation(input({ hostTripActive: false, currentDestination: "Outro" })),
    ).toBe("HOST_TRIP_CANCELLED");
  });
  it("destination change -> HOST_ROUTE_CHANGED", () => {
    expect(evaluateHostTripRevalidation(input({ currentDestination: "Aeroporto de Guarulhos" }))).toBe(
      "HOST_ROUTE_CHANGED",
    );
  });
  it("origin change -> HOST_ROUTE_CHANGED", () => {
    expect(evaluateHostTripRevalidation(input({ currentOrigin: "Outra sede" }))).toBe("HOST_ROUTE_CHANGED");
  });
  it("departure moved beyond the window -> HOST_SCHEDULE_CHANGED", () => {
    expect(evaluateHostTripRevalidation(input({ hostDepartureAt: "2026-10-01T12:16:00.000Z" }))).toBe(
      "HOST_SCHEDULE_CHANGED",
    );
  });
  it("departure moved exactly to the window boundary survives", () => {
    expect(evaluateHostTripRevalidation(input({ hostDepartureAt: "2026-10-01T12:15:00.000Z" }))).toBeNull();
  });
  it("invalid date fails closed", () => {
    expect(evaluateHostTripRevalidation(input({ hostDepartureAt: "garbage" }))).toBe("HOST_SCHEDULE_CHANGED");
  });
  it("legacy rows without a snapshot skip the route check", () => {
    expect(
      evaluateHostTripRevalidation(
        input({ snapshotOrigin: null, snapshotDestination: null, currentDestination: "Qualquer" }),
      ),
    ).toBeNull();
  });
});
