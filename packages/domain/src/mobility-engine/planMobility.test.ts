import { describe, expect, it } from "vitest";
import type { TripRequest } from "../entities/trip";
import type { Vehicle, VehicleCategory } from "../entities/vehicle";
import { defaultReadinessConfig } from "../readiness/assessTripReadiness";
import { defaultCarpoolMatchConfig, type CarpoolCandidate } from "../carpool/findCarpoolMatches";
import { planMobility } from "./planMobility";

const now = "2026-09-10T06:00:00Z";

function trip(overrides: Partial<TripRequest> = {}): TripRequest {
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

const sedanCategory: VehicleCategory = {
  id: "cat-sedan",
  name: "Sedan",
  passengerCapacity: 5,
  supportsCargo: false,
  energyType: "ICE",
};

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "veh-sedan",
    organizationId: "org-1",
    plate: "AAA0A00",
    categoryId: "cat-sedan",
    energyType: "ICE",
    status: "available",
    odometerKm: 10_000,
    fuelLevelPercent: 90,
    batteryLevelPercent: null,
    estimatedRangeKm: 500,
    nextServiceOdometerKm: 30_000,
    homeLocationId: "loc-p1",
    currentLocationId: "loc-p1",
    hasBlockingDamage: false,
    missingSafetyEquipment: [],
    documentationValid: true,
    isCleanExterior: true,
    isCleanInterior: true,
    ...overrides,
  };
}

describe("planMobility (§17 — Mobility Decision Engine)", () => {
  it("prefers a compatible carpool over allocating a new vehicle", () => {
    const carpoolCandidates: CarpoolCandidate[] = [
      {
        reservationId: "res-1",
        vehicleId: "veh-suv",
        existingTrip: trip({ id: "t2", departureAt: "2026-09-10T07:45:00Z" }),
        vehicleCapacity: 5,
        vehicleSupportsCargo: false,
        currentOccupancy: 2,
      },
    ];

    const result = planMobility({
      tripRequest: trip(),
      carpoolCandidates,
      carpoolConfig: defaultCarpoolMatchConfig,
      vehicleCandidates: [{ vehicle: vehicle(), category: sedanCategory }],
      now,
      readinessConfig: defaultReadinessConfig,
    });

    expect(result.type).toBe("carpool");
    expect(result.carpoolOptions).toHaveLength(1);
    expect(result.carpoolOptions?.[0]?.reservationId).toBe("res-1");
    expect(result.vehicle).toBeUndefined();
  });

  it("lists every compatible carpool, not just the closest one", () => {
    const carpoolCandidates: CarpoolCandidate[] = [
      {
        reservationId: "res-close",
        vehicleId: "veh-suv",
        existingTrip: trip({ id: "t-close", departureAt: "2026-09-10T07:50:00Z" }),
        vehicleCapacity: 5,
        vehicleSupportsCargo: false,
        currentOccupancy: 2,
      },
      {
        reservationId: "res-far",
        vehicleId: "veh-van",
        existingTrip: trip({ id: "t-far", departureAt: "2026-09-10T08:15:00Z" }),
        vehicleCapacity: 8,
        vehicleSupportsCargo: false,
        currentOccupancy: 1,
      },
    ];

    const result = planMobility({
      tripRequest: trip(),
      carpoolCandidates,
      carpoolConfig: defaultCarpoolMatchConfig,
      vehicleCandidates: [{ vehicle: vehicle(), category: sedanCategory }],
      now,
      readinessConfig: defaultReadinessConfig,
    });

    expect(result.type).toBe("carpool");
    expect(result.carpoolOptions).toHaveLength(2);
    expect(result.carpoolOptions?.map((c) => c.reservationId)).toEqual(["res-close", "res-far"]);
  });

  it("falls back to vehicle recommendation when no carpool is compatible", () => {
    const result = planMobility({
      tripRequest: trip(),
      carpoolCandidates: [],
      carpoolConfig: defaultCarpoolMatchConfig,
      vehicleCandidates: [{ vehicle: vehicle(), category: sedanCategory }],
      now,
      readinessConfig: defaultReadinessConfig,
    });

    expect(result.type).toBe("vehicle");
    expect(result.vehicle?.recommendedVehicleId).toBe("veh-sedan");
    expect(result.carpoolOptions).toBeUndefined();
  });

  it("returns none with an explanation when nothing works", () => {
    const result = planMobility({
      tripRequest: trip({ passengerCount: 99 }),
      carpoolCandidates: [],
      carpoolConfig: defaultCarpoolMatchConfig,
      vehicleCandidates: [{ vehicle: vehicle(), category: sedanCategory }],
      now,
      readinessConfig: defaultReadinessConfig,
    });

    expect(result.type).toBe("none");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  describe("São Paulo traffic restriction (§15) — surfaced as a warning, not a hard exclusion", () => {
    // Monday 2026-09-07, 08:00 São Paulo local time (UTC-3) = 11:00Z — inside the
    // rodízio morning window, and "1" is one of Monday's restricted last digits.
    const restrictedDepartureAt = "2026-09-07T11:00:00Z";

    it("still recommends a rodízio-restricted ICE vehicle but flags the restriction", () => {
      const result = planMobility({
        tripRequest: trip({ departureAt: restrictedDepartureAt, destination: "São Paulo" }),
        carpoolCandidates: [],
        carpoolConfig: defaultCarpoolMatchConfig,
        vehicleCandidates: [
          { vehicle: vehicle({ plate: "AAA0A01", energyType: "ICE" }), category: sedanCategory },
        ],
        now,
        readinessConfig: defaultReadinessConfig,
      });

      expect(result.type).toBe("vehicle");
      expect(result.vehicle?.recommendedVehicleId).toBe("veh-sedan");
      expect(result.trafficRestriction?.restricted).toBe(true);
      expect(result.reasons).toContain("traffic_restriction_active");
      // The web UI's vehicle-recommendation branch renders `plan.vehicle.reasons`, not
      // `plan.reasons` — the restriction must reach that nested array too, or the
      // warning never actually renders in the reasons bullet list (regression check).
      expect(result.vehicle?.reasons).toContain("traffic_restriction_active");
    });

    it("does not flag a BEV recommended for the same restricted trip (rodízio-exempt)", () => {
      const result = planMobility({
        tripRequest: trip({ departureAt: restrictedDepartureAt, destination: "São Paulo" }),
        carpoolCandidates: [],
        carpoolConfig: defaultCarpoolMatchConfig,
        vehicleCandidates: [
          { vehicle: vehicle({ plate: "AAA0A01", energyType: "BEV" }), category: sedanCategory },
        ],
        now,
        readinessConfig: defaultReadinessConfig,
      });

      expect(result.type).toBe("vehicle");
      expect(result.trafficRestriction).toBeUndefined();
      expect(result.reasons).not.toContain("traffic_restriction_active");
    });
  });
});
