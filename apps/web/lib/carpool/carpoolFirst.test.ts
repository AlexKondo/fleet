import { describe, expect, it, vi } from "vitest";
import {
  buildOfferCards,
  deriveCarpoolGating,
  runCarpoolFirst,
  type CarpoolFirstDeps,
} from "./carpoolFirst";
import type { ResolveOutcome, ResolvedPlace } from "./resolveLocationText";
import type { CompatibleCarpoolMatch, SearchCarpoolResult } from "./runCarpoolSearch";

const place = (label: string, lat: number): ResolvedPlace => ({
  label,
  coordinates: { lat, lng: -46.6 },
  source: "geocoding_provider",
});
const input = {
  originText: "Fábrica GWM",
  destinationText: "Av. Paulista 1000",
  departureAt: "2026-10-20T12:00:00.000Z",
  passengerCount: 2,
  requiresCargo: false,
};
const match = (offerId: string): CompatibleCarpoolMatch => ({
  offerId,
  hostTripRequestId: "t-" + offerId,
  additionalDistanceKm: 1.26,
  additionalTimeMin: 3.4,
  departureDiffMinutes: 5,
  rankingKey: 1,
  pickup: { lat: -23.1, lng: -46.6 },
  dropoff: { lat: -23.2, lng: -46.6 },
});

function deps(over: Partial<CarpoolFirstDeps> & { resolveMap?: Record<string, ResolveOutcome> } = {}) {
  const resolveMap = over.resolveMap ?? {
    "Fábrica GWM": { status: "resolved", place: place("Fábrica GWM - Iracemápolis", -23.1) },
    "Av. Paulista 1000": { status: "resolved", place: place("Av. Paulista, 1000 - São Paulo", -23.2) },
  };
  const d = {
    resolve: vi.fn(async (t: string) => resolveMap[t] ?? ({ status: "needs_precision", reason: "not_found" } as ResolveOutcome)),
    search: vi.fn(async (): Promise<SearchCarpoolResult> => ({ status: "matches", matches: [match("o1")] })),
    loadOfferCards: vi.fn(async (ms: CompatibleCarpoolMatch[]) =>
      buildOfferCards(ms, ms.map((m) => ({ id: m.offerId, seats_available: 2, hostDepartureAt: "2026-10-20T12:05:00.000Z" })))),
    ...over,
  };
  return d;
}

describe("runCarpoolFirst", () => {
  it("compatible match -> offers state with the resolved labels, draft coordinates and a minimal card", async () => {
    const d = deps();
    const out = await runCarpoolFirst(input, d);
    expect(out.status).toBe("offers");
    if (out.status !== "offers") throw new Error("unreachable");
    expect(out.origin.label).toBe("Fábrica GWM - Iracemápolis");
    expect(out.destination.label).toBe("Av. Paulista, 1000 - São Paulo");
    expect(out.draft).toMatchObject({ requestedSeats: 2, pickup: { lat: -23.1 }, dropoff: { lat: -23.2 } });
    // Pack 05: ONLY these fields - no host name/address/coordinates can be on a card.
    expect(Object.keys(out.offers[0]!).sort()).toEqual(
      ["additionalDistanceKm", "additionalTimeMin", "hostDepartureAt", "offerId", "seatsAvailable"],
    );
    expect(out.offers[0]).toMatchObject({ additionalDistanceKm: 1.3, additionalTimeMin: 3 });
  });

  it("city-only destination -> needs_precision, search is NEVER run (pack 07: request clarification)", async () => {
    const d = deps({
      resolveMap: {
        "Fábrica GWM": { status: "resolved", place: place("Fábrica", -23.1) },
        "Av. Paulista 1000": { status: "needs_precision", reason: "city_level" },
      },
    });
    const out = await runCarpoolFirst(input, d);
    expect(out).toMatchObject({
      status: "needs_precision",
      origin: { ok: true },
      destination: { ok: false, reason: "city_level", query: "Av. Paulista 1000" },
    });
    expect(d.search).not.toHaveBeenCalled();
  });

  it("unresolvable address -> needs_precision (not_found), nothing guessed", async () => {
    const d = deps({ resolveMap: { "Fábrica GWM": { status: "needs_precision", reason: "not_found" }, "Av. Paulista 1000": { status: "needs_precision", reason: "city_level" } } });
    const out = await runCarpoolFirst(input, d);
    expect(out).toMatchObject({ status: "needs_precision", origin: { ok: false, reason: "not_found" }, destination: { ok: false, reason: "city_level" } });
    expect(d.search).not.toHaveBeenCalled();
  });

  it("provider outage while resolving -> unavailable (banner), search not run", async () => {
    const d = deps({ resolveMap: { "Fábrica GWM": { status: "unavailable", reason: "circuit_open" }, "Av. Paulista 1000": { status: "resolved", place: place("x", 1) } } });
    expect(await runCarpoolFirst(input, d)).toEqual({ status: "unavailable", reason: "circuit_open" });
    expect(d.search).not.toHaveBeenCalled();
  });

  it("search 'unavailable' (routing outage) -> unavailable; never a reduced-confidence match", async () => {
    const d = deps({ search: vi.fn(async () => ({ status: "unavailable", reason: "routing_provider_unavailable" }) as SearchCarpoolResult) });
    expect(await runCarpoolFirst(input, d)).toEqual({ status: "unavailable", reason: "routing_provider_unavailable" });
  });

  it("search error code -> unavailable, no card", async () => {
    const d = deps({ search: vi.fn(async () => ({ status: "error", error: "invalid_coordinates" }) as SearchCarpoolResult) });
    expect(await runCarpoolFirst(input, d)).toMatchObject({ status: "unavailable" });
  });

  it("no compatible offer -> 'none' with the confirmed labels (the vehicle flow continues)", async () => {
    const d = deps({ search: vi.fn(async () => ({ status: "matches", matches: [] }) as SearchCarpoolResult) });
    const out = await runCarpoolFirst(input, d);
    expect(out.status).toBe("none");
    expect(d.loadOfferCards).not.toHaveBeenCalled();
  });

  it("matches whose offer rows could not be loaded are dropped -> 'none' (never half-informed)", async () => {
    const d = deps({ loadOfferCards: vi.fn(async () => []) });
    expect((await runCarpoolFirst(input, d)).status).toBe("none");
  });
});

describe("buildOfferCards", () => {
  it("drops offers with no row, no departure, or no seat left", () => {
    const cards = buildOfferCards(
      [match("a"), match("b"), match("c"), match("d")],
      [
        { id: "a", seats_available: 1, hostDepartureAt: "2026-10-20T12:00:00Z" },
        { id: "b", seats_available: 0, hostDepartureAt: "2026-10-20T12:00:00Z" },
        { id: "c", seats_available: 2, hostDepartureAt: null },
      ],
    );
    expect(cards.map((c) => c.offerId)).toEqual(["a"]);
  });
  it("keeps the engine's ranking order", () => {
    const cards = buildOfferCards(
      [match("z"), match("a")],
      [
        { id: "a", seats_available: 1, hostDepartureAt: "2026-10-20T12:00:00Z" },
        { id: "z", seats_available: 1, hostDepartureAt: "2026-10-20T12:00:00Z" },
      ],
    );
    expect(cards.map((c) => c.offerId)).toEqual(["z", "a"]);
  });
});

describe("deriveCarpoolGating (planTrip gating)", () => {
  const policy = (o: object) => ({ ok: true as const, policy: { carpoolEnabled: true, carpoolFirstEnabled: true, hostApprovalRequired: true, ...o } });
  it("carpool enabled + carpool-first: new engine owns carpool (old matcher suppressed), host step on", () => {
    expect(deriveCarpoolGating(policy({}))).toEqual({ newEngine: true, carpoolFirst: true, hostStep: true, hostApprovalRequired: true });
  });
  it("carpool enabled, carpool-first off: old matcher still suppressed, no rider search, host step on", () => {
    expect(deriveCarpoolGating(policy({ carpoolFirstEnabled: false }))).toMatchObject({ newEngine: true, carpoolFirst: false, hostStep: true });
  });
  it("carpool DISABLED by policy: today's behaviour untouched (old matcher stays, no new UI)", () => {
    expect(deriveCarpoolGating(policy({ carpoolEnabled: false }))).toMatchObject({ newEngine: false, carpoolFirst: false, hostStep: false });
  });
  it("policy load failure fails closed on the old matcher and never offers to publish seats", () => {
    expect(deriveCarpoolGating({ ok: false })).toMatchObject({ newEngine: true, carpoolFirst: true, hostStep: false });
  });
});
