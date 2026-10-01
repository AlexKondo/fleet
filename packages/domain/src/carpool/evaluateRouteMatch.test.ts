import { describe, expect, it } from "vitest";
import { evaluateRouteMatch, type RouteMatchInput } from "./evaluateRouteMatch";
import { defaultCarpoolPolicyConfig } from "./carpoolPolicy";
import type { RouteEvaluationResult } from "../geospatial/providers";

function route(overrides: Partial<RouteEvaluationResult> = {}): RouteEvaluationResult {
  return {
    baselineDistanceKm: 20,
    baselineDurationMin: 30,
    candidateRouteDistanceKm: 20,
    candidateRouteDurationMin: 30,
    additionalDistanceKm: 0,
    additionalTimeMin: 0,
    ...overrides,
  };
}

function input(overrides: Partial<RouteMatchInput> = {}): RouteMatchInput {
  return {
    policy: defaultCarpoolPolicyConfig, // 15min window, 5km/10min max detour
    requestedDepartureAt: "2026-10-01T12:00:00.000Z",
    offerDepartureAt: "2026-10-01T12:00:00.000Z",
    requestedSeats: 1,
    seatsAvailable: 2,
    hostTripActive: true,
    route: route(),
    ...overrides,
  };
}

describe("evaluateRouteMatch", () => {
  it("is compatible for a well-formed baseline match", () => {
    const result = evaluateRouteMatch(input());
    expect(result.compatible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  // --- Pack §07 "Destination/route tests" -----------------------------------------------

  it("same city, destinations tens of km apart -> rejects when detour exceeds policy", () => {
    // Simulated as a large additionalDistanceKm, which is exactly what a real route-insertion
    // detour of 'tens of km' across the same city would produce.
    const result = evaluateRouteMatch(
      input({ route: route({ additionalDistanceKm: 25, additionalTimeMin: 40 }) }),
    );
    expect(result.compatible).toBe(false);
    expect(result.reasons).toContain("ADDITIONAL_DISTANCE_EXCEEDS_POLICY");
    expect(result.reasons).toContain("ADDITIONAL_TIME_EXCEEDS_POLICY");
  });

  it("destinations farther apart geographically but rider stop lies on route -> accepts when actual detour is within policy", () => {
    // Baseline route itself is long (far-apart host origin/destination), but inserting the
    // rider's pickup/dropoff barely changes it because the stop sits on the existing route.
    const result = evaluateRouteMatch(
      input({
        route: route({
          baselineDistanceKm: 300,
          baselineDurationMin: 240,
          candidateRouteDistanceKm: 302,
          candidateRouteDurationMin: 245,
          additionalDistanceKm: 2,
          additionalTimeMin: 5,
        }),
      }),
    );
    expect(result.compatible).toBe(true);
  });

  it("same CEP (postal code) but route impact exceeds threshold -> rejects", () => {
    // Same nominal area, but the real insertion detour (e.g. one-way streets, a large campus)
    // still exceeds the configured budget -- route numbers decide, not the postal code.
    const result = evaluateRouteMatch(
      input({ route: route({ additionalDistanceKm: 6, additionalTimeMin: 4 }) }),
    );
    expect(result.compatible).toBe(false);
    expect(result.reasons).toEqual(["ADDITIONAL_DISTANCE_EXCEEDS_POLICY"]);
  });

  it("different CEP (postal code) but low route impact -> may accept", () => {
    const result = evaluateRouteMatch(
      input({ route: route({ additionalDistanceKm: 1.5, additionalTimeMin: 3 }) }),
    );
    expect(result.compatible).toBe(true);
  });

  // "incomplete city-only destination requiring precision" and "Corporate Mobility Point
  // resolves without repeated user entry" and "invalid/unresolvable address -> do not guess"
  // are geocoding-stage (Phase C2) / orchestration-stage concerns, not inputs this pure
  // function receives (it only ever sees an already-computed RouteEvaluationResult) -- see
  // apps/web/app/carpool/actions.test.ts for the orchestration-level coverage of the
  // unresolvable/outage path, and the Phase Report for why precision/CMP resolution itself
  // is out of this file's scope.

  // --- Pack §07 "Policy boundary tests" -------------------------------------------------

  describe("departure window boundary", () => {
    it("passes just below the window (14 of 15 minutes)", () => {
      const result = evaluateRouteMatch(
        input({ offerDepartureAt: "2026-10-01T12:14:00.000Z" }),
      );
      expect(result.reasons).not.toContain("OUTSIDE_DEPARTURE_WINDOW");
    });

    it("passes exactly at the window boundary (15 of 15 minutes)", () => {
      const result = evaluateRouteMatch(
        input({ offerDepartureAt: "2026-10-01T12:15:00.000Z" }),
      );
      expect(result.reasons).not.toContain("OUTSIDE_DEPARTURE_WINDOW");
    });

    it("rejects just above the window (16 of 15 minutes)", () => {
      const result = evaluateRouteMatch(
        input({ offerDepartureAt: "2026-10-01T12:16:00.000Z" }),
      );
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("OUTSIDE_DEPARTURE_WINDOW");
    });
  });

  describe("additional distance boundary (policy default max = 5km)", () => {
    it("passes just below the threshold (4.99km)", () => {
      const result = evaluateRouteMatch(input({ route: route({ additionalDistanceKm: 4.99 }) }));
      expect(result.reasons).not.toContain("ADDITIONAL_DISTANCE_EXCEEDS_POLICY");
    });

    it("passes exactly at the threshold (5km)", () => {
      const result = evaluateRouteMatch(input({ route: route({ additionalDistanceKm: 5 }) }));
      expect(result.reasons).not.toContain("ADDITIONAL_DISTANCE_EXCEEDS_POLICY");
    });

    it("rejects just above the threshold (5.01km)", () => {
      const result = evaluateRouteMatch(input({ route: route({ additionalDistanceKm: 5.01 }) }));
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("ADDITIONAL_DISTANCE_EXCEEDS_POLICY");
    });
  });

  describe("additional time boundary (policy default max = 10min)", () => {
    it("passes just below the threshold (9.99min)", () => {
      const result = evaluateRouteMatch(input({ route: route({ additionalTimeMin: 9.99 }) }));
      expect(result.reasons).not.toContain("ADDITIONAL_TIME_EXCEEDS_POLICY");
    });

    it("passes exactly at the threshold (10min)", () => {
      const result = evaluateRouteMatch(input({ route: route({ additionalTimeMin: 10 }) }));
      expect(result.reasons).not.toContain("ADDITIONAL_TIME_EXCEEDS_POLICY");
    });

    it("rejects just above the threshold (10.01min)", () => {
      const result = evaluateRouteMatch(input({ route: route({ additionalTimeMin: 10.01 }) }));
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("ADDITIONAL_TIME_EXCEEDS_POLICY");
    });
  });

  describe("seat availability boundary (requesting 2 seats)", () => {
    it("rejects just below (1 of 2 required seats available)", () => {
      const result = evaluateRouteMatch(input({ requestedSeats: 2, seatsAvailable: 1 }));
      expect(result.compatible).toBe(false);
      expect(result.reasons).toContain("INSUFFICIENT_SEATS_AVAILABLE");
    });

    it("passes exactly at the threshold (2 of 2 required seats available)", () => {
      const result = evaluateRouteMatch(input({ requestedSeats: 2, seatsAvailable: 2 }));
      expect(result.reasons).not.toContain("INSUFFICIENT_SEATS_AVAILABLE");
    });

    it("passes just above (3 available for 2 required seats)", () => {
      const result = evaluateRouteMatch(input({ requestedSeats: 2, seatsAvailable: 3 }));
      expect(result.reasons).not.toContain("INSUFFICIENT_SEATS_AVAILABLE");
    });
  });

  // --- tripStatusOK / policyOK (CARPOOL_DISABLED) ---------------------------------------

  it("rejects when the host trip is no longer active (tripStatusOK)", () => {
    const result = evaluateRouteMatch(input({ hostTripActive: false }));
    expect(result.compatible).toBe(false);
    expect(result.reasons).toContain("HOST_TRIP_INACTIVE");
  });

  it("rejects when carpool is disabled at the policy level (policyOK)", () => {
    const result = evaluateRouteMatch(
      input({ policy: { ...defaultCarpoolPolicyConfig, carpoolEnabled: false } }),
    );
    expect(result.compatible).toBe(false);
    expect(result.reasons).toContain("CARPOOL_DISABLED");
  });

  // --- ranking --------------------------------------------------------------------------

  it("ranks a lower-detour candidate ahead of a higher-detour candidate", () => {
    const closer = evaluateRouteMatch(input({ route: route({ additionalDistanceKm: 1 }) }));
    const farther = evaluateRouteMatch(input({ route: route({ additionalDistanceKm: 4 }) }));
    expect(closer.rankingKey).toBeLessThan(farther.rankingKey);
  });

  it("never lets ranking override the strict compatibility decision", () => {
    // A candidate with a tiny detour but outside the schedule window must still be
    // incompatible, even though its rankingKey would otherwise look attractive.
    const result = evaluateRouteMatch(
      input({
        offerDepartureAt: "2026-10-01T13:00:00.000Z",
        route: route({ additionalDistanceKm: 0.1, additionalTimeMin: 0.1 }),
      }),
    );
    expect(result.compatible).toBe(false);
  });

  // --- fail-closed on non-finite / invalid input ----------------------------------------

  describe("fails closed on invalid input", () => {
    const cases: Array<[string, Partial<RouteMatchInput>]> = [
      ["NaN additionalDistanceKm", { route: route({ additionalDistanceKm: Number.NaN }) }],
      ["NaN additionalTimeMin", { route: route({ additionalTimeMin: Number.NaN }) }],
      ["Infinity additionalDistanceKm", { route: route({ additionalDistanceKm: Infinity }) }],
      ["Infinity additionalTimeMin", { route: route({ additionalTimeMin: Infinity }) }],
      ["invalid requestedDepartureAt", { requestedDepartureAt: "garbage" }],
      ["invalid offerDepartureAt", { offerDepartureAt: "garbage" }],
      ["NaN seatsAvailable", { seatsAvailable: Number.NaN }],
      ["negative additionalDistanceKm (C3 carry-over c)", { route: route({ additionalDistanceKm: -1 }) }],
      ["negative additionalTimeMin (C3 carry-over c)", { route: route({ additionalTimeMin: -0.5 }) }],
      ["zero requestedSeats (C3 carry-over a)", { requestedSeats: 0 }],
      ["negative requestedSeats (C3 carry-over a)", { requestedSeats: -1 }],
      ["fractional requestedSeats (C3 carry-over a)", { requestedSeats: 0.5 }],
      [
        "NaN policy max distance",
        { policy: { ...defaultCarpoolPolicyConfig, maxAdditionalDistanceKm: Number.NaN } },
      ],
    ];
    for (const [name, overrides] of cases) {
      it(`rejects ${name}`, () => {
        const result = evaluateRouteMatch(input(overrides));
        expect(result.compatible).toBe(false);
        expect(result.reasons).toEqual(["INVALID_INPUT"]);
      });
    }
  });
});
