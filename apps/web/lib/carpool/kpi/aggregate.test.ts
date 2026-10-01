import { describe, expect, it } from "vitest";
import {
  aggregateProvider, aggregateRequests, aggregateSearchLog, aggregateShared, countEvents, haversineKm, percentile, readCoordinates,
} from "./aggregate";
import { PROVIDER_UNIT_PRICE_USD, ROAD_DISTANCE_FACTOR } from "./config";

const log = (o: Partial<Parameters<typeof aggregateSearchLog>[0][number]> = {}) => ({
  source: "web", offers_evaluated: 4, prefilter_candidates: 2, precise_route_calls: 2, compatible_count: 1,
  outcome: "matches", latency_ms: 100, created_at: "2026-10-01T10:00:00Z", ...o,
});

describe("aggregateSearchLog", () => {
  it("sums counters, splits outcomes/sources, averages latency and takes p95", () => {
    const r = aggregateSearchLog([
      log(), log({ source: "chat", outcome: "none", compatible_count: 0, latency_ms: 300 }),
      log({ outcome: "unavailable", compatible_count: 0, precise_route_calls: 0, latency_ms: 200, created_at: "2026-10-02T10:00:00Z" }),
      log({ outcome: "error", offers_evaluated: 0, prefilter_candidates: 0, precise_route_calls: 0, compatible_count: 0, latency_ms: 400, created_at: "2026-10-02T11:00:00Z" }),
    ]);
    expect(r.searches).toBe(4);
    expect(r.offersEvaluated).toBe(12);
    expect(r.prefilterCandidates).toBe(6);
    expect(r.preciseRouteCalls).toBe(4);
    expect(r.compatibleMatches).toBe(1);
    expect(r.outcomes).toEqual({ matches: 1, none: 1, unavailable: 1, error: 1 });
    expect(r.bySource).toEqual({ web: 3, chat: 1 });
    expect(r.latencyAvgMs).toBe(250);
    expect(r.latencyP95Ms).toBe(400);
    expect(r.daily).toEqual([{ day: "2026-10-01", searches: 2 }, { day: "2026-10-02", searches: 2 }]);
  });
  it("empty input yields zeros and null latencies (no NaN)", () => {
    const r = aggregateSearchLog([]);
    expect(r).toMatchObject({ searches: 0, latencyAvgMs: null, latencyP95Ms: null, daily: [] });
  });
});

describe("percentile", () => {
  it("nearest-rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([], 95)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("aggregateRequests", () => {
  it("counts statuses; acceptance rate only over decided requests", () => {
    const r = aggregateRequests(["ACCEPTED", "ACCEPTED", "REJECTED", "EXPIRED", "PENDING", "CANCELLED", "INVALIDATED"].map((status) => ({ status, requested_seats: 1 })));
    expect(r).toEqual({ total: 7, pending: 1, accepted: 2, rejected: 1, expired: 1, cancelled: 1, invalidated: 1, acceptanceRate: 50 });
  });
  it("rate is null with no decided request", () => {
    expect(aggregateRequests([{ status: "PENDING", requested_seats: 1 }]).acceptanceRate).toBeNull();
  });
});

describe("countEvents", () => {
  it("counts only the asked type", () => {
    expect(countEvents([{ event_type: "RideInvalidated" }, { event_type: "RideAccepted" }, { event_type: "RideInvalidated" }], "RideInvalidated")).toBe(2);
  });
});

describe("haversine / coordinates", () => {
  it("Praça da Sé -> Av. Paulista is about 2.4 km straight line", () => {
    const d = haversineKm({ lat: -23.5505, lng: -46.6333 }, { lat: -23.5614, lng: -46.6559 });
    expect(d).toBeGreaterThan(2.3);
    expect(d).toBeLessThan(2.7);
  });
  it("same point = 0; antipodal sanity", () => {
    expect(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20015.1, 0);
  });
  it("readCoordinates rejects malformed shapes", () => {
    expect(readCoordinates({ coordinates: { lat: -23, lng: -46 } })).toEqual({ lat: -23, lng: -46 });
    for (const bad of [null, undefined, {}, { coordinates: {} }, { coordinates: { lat: "1", lng: 2 } }, { coordinates: { lat: 91, lng: 0 } }, { coordinates: { lat: NaN, lng: 0 } }]) {
      expect(readCoordinates(bad)).toBeNull();
    }
  });
});

describe("aggregateShared", () => {
  const loc = (lat: number, lng: number) => ({ label: "x", coordinates: { lat, lng } });
  it("seats, avoided allocations and a labelled km estimate (straight line x road factor)", () => {
    const rows = [
      { status: "ACCEPTED", requested_seats: 2, pickup_location: loc(0, 0), dropoff_location: loc(0, 1) },
      { status: "ACCEPTED", requested_seats: 1, pickup_location: null, dropoff_location: loc(0, 1) },
    ];
    const r = aggregateShared(1, rows);
    const oneDegreeKm = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(r.completedSharedTrips).toBe(1);
    expect(r.seatsShared).toBe(3);
    expect(r.avoidedAllocations).toBe(2);
    expect(r.requestsWithoutCoordinates).toBe(1);
    expect(r.avoidedKmEstimate).toBeCloseTo(Math.round(oneDegreeKm * ROAD_DISTANCE_FACTOR * 10) / 10, 5);
  });
});

describe("aggregateProvider", () => {
  it("per-kind calls/errors/avg latency and an estimated cost from the single price constant", () => {
    const r = aggregateProvider([
      { provider_call_kind: "routing", call_count: 10, error_count: 1, total_latency_ms: 2000 },
      { provider_call_kind: "routing", call_count: 10, error_count: 0, total_latency_ms: "1000" },
      { provider_call_kind: "geocode", call_count: 4, error_count: 2, total_latency_ms: 0 },
    ]);
    expect(r.byKind).toEqual([
      { kind: "geocode", calls: 4, errors: 2, avgLatencyMs: null, estCostUsd: Math.round(4 * PROVIDER_UNIT_PRICE_USD.geocode * 10000) / 10000 },
      { kind: "routing", calls: 20, errors: 1, avgLatencyMs: 150, estCostUsd: Math.round(20 * PROVIDER_UNIT_PRICE_USD.routing * 10000) / 10000 },
    ]);
    expect(r.totalCalls).toBe(24);
    expect(r.totalErrors).toBe(3);
    expect(r.estCostUsd).toBeCloseTo(0.02 + 0.2, 4);
  });
});
