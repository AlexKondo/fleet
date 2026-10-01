import { describe, expect, it, vi } from "vitest";
import { runCarpoolSearch, type CarpoolOfferCandidateRow, type RiderTripDraft } from "./runCarpoolSearch";
import { defaultCarpoolPolicyConfig } from "@fleet/domain";
import type { RoutingProvider, RouteInsertionOutcome } from "@fleet/domain";

const SP = { lat: -23.55052, lng: -46.633308 };

function draft(overrides: Partial<RiderTripDraft> = {}): RiderTripDraft {
  return {
    requestedDepartureAt: "2026-10-01T12:00:00.000Z",
    requestedSeats: 1,
    requiresCargo: false,
    pickup: SP,
    dropoff: SP,
    ...overrides,
  };
}

function candidate(overrides: Partial<CarpoolOfferCandidateRow> = {}): CarpoolOfferCandidateRow {
  return {
    offerId: "offer-1",
    hostTripRequestId: "trip-1",
    offerStatus: "active",
    hostTripActive: true,
    seatsAvailable: 2,
    vehicleSupportsCargo: false,
    hostDepartureAt: "2026-10-01T12:00:00.000Z",
    hostOrigin: SP,
    hostDestination: SP,
    ...overrides,
  };
}

function okRoute(additionalDistanceKm = 1, additionalTimeMin = 1): RouteInsertionOutcome {
  return {
    status: "ok",
    result: {
      baselineDistanceKm: 10,
      baselineDurationMin: 15,
      candidateRouteDistanceKm: 10 + additionalDistanceKm,
      candidateRouteDurationMin: 15 + additionalTimeMin,
      additionalDistanceKm,
      additionalTimeMin,
    },
  };
}

describe("runCarpoolSearch", () => {
  it("returns a compatible match for a well-formed single candidate", async () => {
    const evaluateInsertion = vi.fn(async () => okRoute(1, 1));
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const result = await runCarpoolSearch(draft(), [candidate()], defaultCarpoolPolicyConfig, provider);

    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.offerId).toBe("offer-1");
    }
  });

  it("never calls the RoutingProvider for a candidate that fails Stage A prefilter", async () => {
    const evaluateInsertion = vi.fn(async () => okRoute());
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const failing = candidate({ offerStatus: "disabled" }); // fails prefilter: offer_not_active
    const result = await runCarpoolSearch(draft(), [failing], defaultCarpoolPolicyConfig, provider);

    expect(evaluateInsertion).not.toHaveBeenCalled();
    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.matches).toHaveLength(0);
    }
  });

  it("never calls the RoutingProvider for a candidate with insufficient seats (capacity_exhausted)", async () => {
    const evaluateInsertion = vi.fn(async () => okRoute());
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const failing = candidate({ seatsAvailable: 0 });
    await runCarpoolSearch(draft({ requestedSeats: 1 }), [failing], defaultCarpoolPolicyConfig, provider);

    expect(evaluateInsertion).not.toHaveBeenCalled();
  });

  it("enforces maxCandidatesForPreciseRouting: only the cap's worth are routed when more candidates pass prefilter", async () => {
    const policy = { ...defaultCarpoolPolicyConfig, maxCandidatesForPreciseRouting: 2 };
    const evaluateInsertion = vi.fn(async () => okRoute());
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const candidates = [
      candidate({ offerId: "a" }),
      candidate({ offerId: "b" }),
      candidate({ offerId: "c" }),
      candidate({ offerId: "d" }),
    ];

    await runCarpoolSearch(draft(), candidates, policy, provider);

    expect(evaluateInsertion).toHaveBeenCalledTimes(2);
  });

  it("excludes a candidate when the RoutingProvider reports unavailable, without falling back to a guessed match", async () => {
    const evaluateInsertion = vi.fn(async () => ({ status: "unavailable", reason: "routes_http_503" }) as const);
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const result = await runCarpoolSearch(draft(), [candidate()], defaultCarpoolPolicyConfig, provider);

    expect(result.status).toBe("unavailable");
  });

  it("reports carpoolUnavailable only when EVERY shortlisted candidate fails due to provider outage, not when some succeed", async () => {
    let call = 0;
    const evaluateInsertion = vi.fn(async () => {
      call += 1;
      return call === 1 ? ({ status: "unavailable", reason: "routes_http_503" } as const) : okRoute(1, 1);
    });
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const candidates = [candidate({ offerId: "a" }), candidate({ offerId: "b" })];
    const result = await runCarpoolSearch(draft(), candidates, defaultCarpoolPolicyConfig, provider);

    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.offerId).toBe("b");
    }
  });

  it("never includes an incompatible candidate in the results array (privacy rule: absent, not flagged)", async () => {
    // Within policy max (5km/10min default) for 'a', exceeding it for 'b'.
    let call = 0;
    const evaluateInsertion = vi.fn(async () => {
      call += 1;
      return call === 1 ? okRoute(1, 1) : okRoute(20, 30);
    });
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const candidates = [candidate({ offerId: "compatible" }), candidate({ offerId: "incompatible" })];
    const result = await runCarpoolSearch(draft(), candidates, defaultCarpoolPolicyConfig, provider);

    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      const ids = result.matches.map((m) => m.offerId);
      expect(ids).toEqual(["compatible"]);
      expect(ids).not.toContain("incompatible");
      expect(JSON.stringify(result.matches)).not.toContain("incompatible");
    }
  });

  it("ranks matches by ascending rankingKey (lower detour first)", async () => {
    let call = 0;
    const evaluateInsertion = vi.fn(async () => {
      call += 1;
      return call === 1 ? okRoute(4, 8) : okRoute(1, 1);
    });
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const candidates = [candidate({ offerId: "farther" }), candidate({ offerId: "closer" })];
    const result = await runCarpoolSearch(draft(), candidates, defaultCarpoolPolicyConfig, provider);

    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.matches.map((m) => m.offerId)).toEqual(["closer", "farther"]);
    }
  });

  it("returns no matches (not an outage) when no candidates pass prefilter at all", async () => {
    const evaluateInsertion = vi.fn(async () => okRoute());
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const result = await runCarpoolSearch(
      draft(),
      [candidate({ offerStatus: "draft" }), candidate({ hostTripActive: false })],
      defaultCarpoolPolicyConfig,
      provider,
    );

    expect(result.status).toBe("matches");
    expect(evaluateInsertion).not.toHaveBeenCalled();
  });

  it("sorts Stage A survivors before applying the cap: early failing candidates never consume the cap, and the closest departure wins", async () => {
    const policy = { ...defaultCarpoolPolicyConfig, maxCandidatesForPreciseRouting: 1 };
    const routed: string[] = [];
    const evaluateInsertion = vi.fn(async (input: { hostOrigin: { lat: number } }) => {
      routed.push(String(input.hostOrigin.lat));
      return okRoute(1, 1);
    });
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };

    const candidates = [
      candidate({ offerId: "bad1", offerStatus: "disabled", hostOrigin: { lat: 1, lng: 0 } }),
      candidate({ offerId: "bad2", seatsAvailable: 0, hostOrigin: { lat: 2, lng: 0 } }),
      candidate({
        offerId: "far",
        hostDepartureAt: "2026-10-01T12:14:00.000Z",
        hostOrigin: { lat: 3, lng: 0 },
      }),
      candidate({
        offerId: "near",
        hostDepartureAt: "2026-10-01T12:01:00.000Z",
        hostOrigin: { lat: 4, lng: 0 },
      }),
    ];
    const result = await runCarpoolSearch(draft(), candidates, policy, provider);

    expect(routed).toEqual(["4"]);
    expect(result.status).toBe("matches");
    if (result.status === "matches") {
      expect(result.matches.map((m) => m.offerId)).toEqual(["near"]);
    }
  });

  it("fails closed when the rider's departure time is not a valid date (never reaches the provider)", async () => {
    const evaluateInsertion = vi.fn(async () => okRoute());
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };
    const result = await runCarpoolSearch(
      draft({ requestedDepartureAt: "garbage" }),
      [candidate()],
      defaultCarpoolPolicyConfig,
      provider,
    );
    expect(evaluateInsertion).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "matches", matches: [] });
  });

  it("rejects a provider result containing NaN detour numbers (never compatible)", async () => {
    const evaluateInsertion = vi.fn(async () => okRoute(Number.NaN, Number.NaN));
    const provider: RoutingProvider = { computeRoute: vi.fn(), evaluateInsertion };
    const result = await runCarpoolSearch(draft(), [candidate()], defaultCarpoolPolicyConfig, provider);
    expect(result).toEqual({ status: "matches", matches: [] });
  });
});
