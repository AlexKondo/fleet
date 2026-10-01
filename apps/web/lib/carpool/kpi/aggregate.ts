/**
 * C7b KPI dashboard - PURE aggregation (no I/O), unit-tested in aggregate.test.ts and asserted against live data
 * in testing/chat-carpool/kpi-dashboard.live.test.ts.
 *
 * DEFINITIONS (also printed on the dashboard):
 *  - trips evaluated for carpool  = rows in carpool_search_log (one per rider search that reached the engine).
 *  - offers enabled               = CarpoolOfferEnabled events in the range; "active now" = offers with status active.
 *  - candidates after prefilter   = sum of prefilter_candidates (Stage A survivors, before the precise-routing cap).
 *  - precise route calls          = sum of precise_route_calls (candidates actually sent to the routing provider).
 *  - compatible matches           = sum of compatible_count.
 *  - ride requests                = carpool_ride_requests created in the range; acceptance rate =
 *                                   ACCEPTED / (ACCEPTED + REJECTED + EXPIRED) (decided requests only).
 *  - invalidations after host changes = RideInvalidated events in the range.
 *  - completed shared trips       = host reservations with status completed (end_at in the range) that have at least
 *                                   one ACCEPTED rider request on the host's offer.
 *  - seats shared                 = sum of requested_seats of those ACCEPTED requests.
 *  - avoided additional vehicle allocations = number of those ACCEPTED requests (riders who did not need a vehicle).
 *  - estimated avoided vehicle-km = ESTIMATE: sum over those requests of haversine(pickup, drop-off stored
 *                                   coordinates) x ROAD_DISTANCE_FACTOR. Requests without stored coordinates are
 *                                   counted separately and contribute 0. Never an exact figure.
 *  - provider calls / errors / avg latency = geo_provider_quota_counters (Cost Guard) per call kind; estimated cost =
 *                                   calls x PROVIDER_UNIT_PRICE_USD (an ESTIMATE from list prices).
 *  - matching latency             = latency_ms of the search log (average and p95).
 */
import { PROVIDER_UNIT_PRICE_USD, ROAD_DISTANCE_FACTOR } from "./config";

export interface SearchLogRow {
  source: string;
  offers_evaluated: number;
  prefilter_candidates: number;
  precise_route_calls: number;
  compatible_count: number;
  outcome: string;
  latency_ms: number;
  created_at: string;
}
export interface RideRequestRow {
  status: string;
  requested_seats: number;
  pickup_location?: unknown;
  dropoff_location?: unknown;
}
export interface EventRow {
  event_type: string;
}
export interface QuotaRow {
  provider_call_kind: string;
  call_count: number;
  error_count: number;
  total_latency_ms: number | string;
}

export interface KpiReport {
  range: { days: number; from: string; to: string };
  search: {
    searches: number;
    offersEvaluated: number;
    prefilterCandidates: number;
    preciseRouteCalls: number;
    compatibleMatches: number;
    outcomes: { matches: number; none: number; unavailable: number; error: number };
    bySource: { web: number; chat: number };
    latencyAvgMs: number | null;
    latencyP95Ms: number | null;
    daily: { day: string; searches: number }[];
  };
  offers: { enabled: number; activeNow: number };
  requests: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    expired: number;
    cancelled: number;
    invalidated: number;
    acceptanceRate: number | null;
  };
  invalidations: number;
  shared: {
    completedSharedTrips: number;
    seatsShared: number;
    avoidedAllocations: number;
    avoidedKmEstimate: number;
    requestsWithoutCoordinates: number;
  };
  provider: {
    byKind: { kind: string; calls: number; errors: number; avgLatencyMs: number | null; estCostUsd: number }[];
    totalCalls: number;
    totalErrors: number;
    estCostUsd: number;
  };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

const EARTH_RADIUS_KM = 6371.0088;
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Reads `{ coordinates: { lat, lng } }` (the stored location shape); null when absent / malformed. */
export function readCoordinates(location: unknown): { lat: number; lng: number } | null {
  const c = (location as { coordinates?: { lat?: unknown; lng?: unknown } } | null | undefined)?.coordinates;
  if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") return null;
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) return null;
  return { lat: c.lat, lng: c.lng };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function aggregateSearchLog(rows: SearchLogRow[]) {
  const outcomes = { matches: 0, none: 0, unavailable: 0, error: 0 };
  const bySource = { web: 0, chat: 0 };
  const perDay = new Map<string, number>();
  let offersEvaluated = 0;
  let prefilterCandidates = 0;
  let preciseRouteCalls = 0;
  let compatibleMatches = 0;
  const latencies: number[] = [];
  for (const r of rows) {
    if (r.outcome in outcomes) outcomes[r.outcome as keyof typeof outcomes] += 1;
    if (r.source === "web" || r.source === "chat") bySource[r.source] += 1;
    offersEvaluated += r.offers_evaluated;
    prefilterCandidates += r.prefilter_candidates;
    preciseRouteCalls += r.precise_route_calls;
    compatibleMatches += r.compatible_count;
    latencies.push(r.latency_ms);
    const day = r.created_at.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return {
    searches: rows.length,
    offersEvaluated,
    prefilterCandidates,
    preciseRouteCalls,
    compatibleMatches,
    outcomes,
    bySource,
    latencyAvgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    latencyP95Ms: percentile(latencies, 95),
    daily: [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, searches]) => ({ day, searches })),
  };
}

export function aggregateRequests(rows: RideRequestRow[]) {
  const c = { pending: 0, accepted: 0, rejected: 0, expired: 0, cancelled: 0, invalidated: 0 };
  for (const r of rows) {
    const k = r.status.toLowerCase() as keyof typeof c;
    if (k in c) c[k] += 1;
  }
  const decided = c.accepted + c.rejected + c.expired;
  return { total: rows.length, ...c, acceptanceRate: decided > 0 ? Math.round((c.accepted / decided) * 1000) / 10 : null };
}

export function countEvents(rows: EventRow[], type: string): number {
  return rows.reduce((n, r) => n + (r.event_type === type ? 1 : 0), 0);
}

/** `completedSharedTrips` = number of distinct host trips (computed by the loader); `acceptedOnCompleted` = their ACCEPTED requests. */
export function aggregateShared(completedSharedTrips: number, acceptedOnCompleted: RideRequestRow[]) {
  let seats = 0;
  let km = 0;
  let withoutCoords = 0;
  for (const r of acceptedOnCompleted) {
    seats += r.requested_seats;
    const p = readCoordinates(r.pickup_location);
    const d = readCoordinates(r.dropoff_location);
    if (p && d) km += haversineKm(p, d) * ROAD_DISTANCE_FACTOR;
    else withoutCoords += 1;
  }
  return {
    completedSharedTrips,
    seatsShared: seats,
    avoidedAllocations: acceptedOnCompleted.length,
    avoidedKmEstimate: round1(km),
    requestsWithoutCoordinates: withoutCoords,
  };
}

export function aggregateProvider(rows: QuotaRow[]) {
  const acc = new Map<string, { calls: number; errors: number; latency: number }>();
  for (const r of rows) {
    const a = acc.get(r.provider_call_kind) ?? { calls: 0, errors: 0, latency: 0 };
    a.calls += r.call_count;
    a.errors += r.error_count;
    a.latency += Number(r.total_latency_ms);
    acc.set(r.provider_call_kind, a);
  }
  const byKind = [...acc.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([kind, a]) => {
      const price = (PROVIDER_UNIT_PRICE_USD as Record<string, number>)[kind] ?? 0;
      return {
        kind,
        calls: a.calls,
        errors: a.errors,
        avgLatencyMs: a.calls > 0 && a.latency > 0 ? Math.round(a.latency / a.calls) : null,
        estCostUsd: Math.round(a.calls * price * 10000) / 10000,
      };
    });
  return {
    byKind,
    totalCalls: byKind.reduce((n, k) => n + k.calls, 0),
    totalErrors: byKind.reduce((n, k) => n + k.errors, 0),
    estCostUsd: Math.round(byKind.reduce((n, k) => n + k.estCostUsd, 0) * 10000) / 10000,
  };
}
