import { describe, expect, it } from "vitest";
import type { TripRequest } from "../entities/trip";
import { findCarpoolMatches, type CarpoolCandidate, defaultCarpoolMatchConfig } from "./findCarpoolMatches";

function request(overrides: Partial<TripRequest> = {}): TripRequest {
  return {
    id: "trip-new",
    organizationId: "org-1",
    requesterId: "user-2",
    departureAt: "2026-09-10T08:00:00Z",
    expectedReturnAt: "2026-09-10T18:00:00Z",
    origin: "Iracemápolis",
    destination: "São Paulo",
    distanceKm: 260,
    passengerCount: 1,
    requiresCargo: false,
    justification: "Reunião",
    ...overrides,
  };
}

function candidate(overrides: Partial<CarpoolCandidate> = {}): CarpoolCandidate {
  return {
    reservationId: "res-1",
    vehicleId: "veh-suv",
    existingTrip: request({
      id: "trip-existing",
      departureAt: "2026-09-10T07:45:00Z",
      expectedReturnAt: "2026-09-10T17:30:00Z",
      passengerCount: 2,
    }),
    vehicleCapacity: 5,
    vehicleSupportsCargo: false,
    currentOccupancy: 2,
    ...overrides,
  };
}

describe("findCarpoolMatches (§4 — Corporate Carpooling Intelligence)", () => {
  it("matches the exact example from fleet-car-saas.txt §4", () => {
    const results = findCarpoolMatches(request(), [candidate()], defaultCarpoolMatchConfig);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ reservationId: "res-1", compatible: true });
    expect(results[0]?.reasons).toContain("destination_match");
  });

  it("rejects a match with a different destination", () => {
    const results = findCarpoolMatches(
      request(),
      [candidate({ existingTrip: request({ id: "t2", destination: "Limeira" }) })],
      defaultCarpoolMatchConfig,
    );
    expect(results[0]?.compatible).toBe(false);
    expect(results[0]?.reasons).toContain("destination_mismatch");
  });

  it("rejects a match when departure is outside tolerance", () => {
    const results = findCarpoolMatches(
      request({ departureAt: "2026-09-10T08:00:00Z" }),
      [
        candidate({
          existingTrip: request({ id: "t2", departureAt: "2026-09-10T11:00:00Z" }),
        }),
      ],
      defaultCarpoolMatchConfig,
    );
    expect(results[0]?.compatible).toBe(false);
    expect(results[0]?.reasons).toContain("departure_time_incompatible");
  });

  it("rejects a match when remaining capacity is insufficient", () => {
    const results = findCarpoolMatches(
      request({ passengerCount: 4 }),
      [candidate({ vehicleCapacity: 5, currentOccupancy: 2 })],
      defaultCarpoolMatchConfig,
    );
    expect(results[0]?.compatible).toBe(false);
    expect(results[0]?.reasons).toContain("capacity_exhausted");
  });

  it("rejects a match when the new trip needs cargo and the vehicle does not support it", () => {
    const results = findCarpoolMatches(
      request({ requiresCargo: true }),
      [candidate({ vehicleSupportsCargo: false })],
      defaultCarpoolMatchConfig,
    );
    expect(results[0]?.compatible).toBe(false);
    expect(results[0]?.reasons).toContain("cargo_unsupported");
  });

  it("rejects a match when the return time is incompatible", () => {
    const results = findCarpoolMatches(
      request({ expectedReturnAt: "2026-09-10T18:00:00Z" }),
      [
        candidate({
          existingTrip: request({ id: "t2", expectedReturnAt: "2026-09-10T13:00:00Z" }),
        }),
      ],
      defaultCarpoolMatchConfig,
    );
    expect(results[0]?.compatible).toBe(false);
    expect(results[0]?.reasons).toContain("return_time_incompatible");
  });

  it("ranks compatible matches before incompatible ones, closest departure first", () => {
    const results = findCarpoolMatches(
      request(),
      [
        candidate({ reservationId: "far", existingTrip: request({ id: "t-far", destination: "Limeira" }) }),
        candidate({
          reservationId: "close",
          existingTrip: request({ id: "t-close", departureAt: "2026-09-10T07:50:00Z" }),
        }),
      ],
      defaultCarpoolMatchConfig,
    );
    expect(results[0]?.reservationId).toBe("close");
    expect(results[0]?.compatible).toBe(true);
  });
});
