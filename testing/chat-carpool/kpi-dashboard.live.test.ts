/**
 * C7b - LIVE check of the KPI dashboard data function (apps/web/lib/carpool/kpi/loadKpis.ts).
 *
 * A small KNOWN scenario is created in a disposable organization through the REAL RPCs (enable_carpool_offer,
 * create_carpool_ride_request_as_rider, accept/reject_carpool_ride_request, the host-change revalidation
 * trigger, Cost Guard's increment/record functions) and a few telemetry rows, then every KPI returned by
 * loadCarpoolKpis is asserted to equal the number derived BY HAND below. Everything is deleted in afterAll.
 *
 * Run from apps/web: npx vitest run --config vitest.battery.config.ts kpi-dashboard
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const text = fs.readFileSync("C:/projects/fleet/.env", "utf8");
  const get = (n: string) => text.match(new RegExp("^" + n + "=(.*)$", "m"))?.[1]?.trim() ?? "";
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("NEXT_PUBLIC_SUPABASE_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
});

import { createClient } from "@supabase/supabase-js";
import { loadCarpoolKpis } from "@/lib/carpool/kpi/loadKpis";
import { haversineKm } from "@/lib/carpool/kpi/aggregate";
import { ROAD_DISTANCE_FACTOR } from "@/lib/carpool/kpi/config";
// @ts-expect-error plain ESM helpers shared with the live scripts
import { sql, rpc, provisionOrg, signInAll, cleanupOrgs, URL_, SVC, summary } from "../../supabase/tests/lib/live.mjs";

const loc = (lat: number, lng: number) => ({ label: `L${lat},${lng}`, coordinates: { lat, lng } });
const P1 = loc(-23.5505, -46.6333);
const Q1 = loc(-23.5614, -46.6559);
const PX = loc(-23.55, -46.63);
const QX = loc(-23.56, -46.64);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Org = any;
let org: Org;
const orgs: Org[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
let log: { rpcFail: string[] } = { rpcFail: [] };

async function mkTrip(userId: string, hours: number, vehicleId: string, dest: string) {
  const [t] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, allow_carpool)
    values ('${org.orgId}', '${userId}', now() + interval '${hours} hours', now() + interval '${hours + 4} hours', 'Origem ${dest}', 'Destino ${dest}', 20, 1, false, 'kpi', true) returning id, departure_at`);
  const [r] = await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at)
    values ('${org.orgId}', '${vehicleId}', '${t.id}', 'confirmed', now() + interval '${hours} hours', now() + interval '${hours + 4} hours') returning id`);
  return { tripId: t.id as string, reservationId: r.id as string, departureAt: t.departure_at as string };
}

async function mkRequest(riderId: string, offerId: string, departureAt: string, seats: number, pickup = PX, dropoff = QX) {
  const res = await rpc(SVC, "create_carpool_ride_request_as_rider", {
    p_rider_id: riderId, p_offer_id: offerId, p_seats: seats, p_pickup: pickup, p_dropoff: dropoff,
    p_requested_departure_at: departureAt, p_client_request_id: randomUUID(),
    p_match_additional_distance_km: 1, p_match_additional_time_min: 2,
  }, SVC);
  if (!res.ok) log.rpcFail.push(`create request: ${JSON.stringify(res.body)}`);
  return (res.body as { id?: string } | string | null) && typeof res.body === "object" && res.body ? (res.body as { id?: string }).id ?? (res.body as unknown as string) : (res.body as unknown as string);
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  admin = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
  org = await provisionOrg("k", [
    ["h1", "employee"], ["h2", "employee"], ["h3", "employee"], ["r1", "employee"], ["r2", "employee"], ["r3", "employee"], ["r4", "employee"], ["mgr", "fleet_manager"],
  ], 3);
  orgs.push(org);
  await signInAll(org);
  const U = org.users;
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${org.orgId}', 1, 15, 15, 5, 15, 30)`);

  const t1 = await mkTrip(U.h1.id, 30, org.vehicles[0].id, "H1");
  const t2 = await mkTrip(U.h2.id, 30, org.vehicles[1].id, "H2");
  const t3 = await mkTrip(U.h3.id, 30, org.vehicles[2].id, "H3");
  const enable = async (user: { token: string }, tripId: string, seats: number) => {
    const r = await rpc(user.token, "enable_carpool_offer", { p_trip_request_id: tripId, p_seats: seats });
    if (!r.ok) log.rpcFail.push(`enable: ${JSON.stringify(r.body)}`);
    return (typeof r.body === "string" ? r.body : (r.body as { id?: string })?.id) as string;
  };
  ids.o1 = await enable(U.h1, t1.tripId, 3);
  ids.o2 = await enable(U.h2, t2.tripId, 2);
  ids.o3 = await enable(U.h3, t3.tripId, 2);

  ids.rA = await mkRequest(U.r1.id, ids.o1, t1.departureAt, 2, P1, Q1); // accepted, host trip completed
  ids.rB = await mkRequest(U.r2.id, ids.o1, t1.departureAt, 1);          // rejected
  ids.rC = await mkRequest(U.r3.id, ids.o2, t2.departureAt, 1);          // accepted, host trip NOT completed
  ids.rD = await mkRequest(U.r4.id, ids.o3, t3.departureAt, 1);          // accepted, then invalidated by host change
  ids.rE = await mkRequest(U.r2.id, ids.o2, t2.departureAt, 1);          // stays pending

  const ok = async (user: { token: string }, fn: string, args: Record<string, unknown>) => {
    const r = await rpc(user.token, fn, args);
    if (!r.ok) log.rpcFail.push(`${fn}: ${JSON.stringify(r.body)}`);
  };
  await ok(U.h1, "accept_carpool_ride_request", { p_request_id: ids.rA });
  await ok(U.h1, "reject_carpool_ride_request", { p_request_id: ids.rB, p_reason: "no_room" });
  await ok(U.h2, "accept_carpool_ride_request", { p_request_id: ids.rC });
  await ok(U.h3, "accept_carpool_ride_request", { p_request_id: ids.rD });

  // host H3 changes the destination -> revalidation trigger invalidates the accepted request (RideInvalidated)
  await sql(`update trip_requests set destination = 'Destino NOVO H3' where id = '${t3.tripId}'`);

  // H1 and H3 trips are completed (H1 has an ACCEPTED rider, H3's only rider was invalidated); H2 stays confirmed
  await sql(`update reservations set status = 'completed', start_at = now() - interval '6 hours', end_at = now() - interval '2 hours' where id in ('${t1.reservationId}', '${t3.reservationId}')`);

  // telemetry rows (what searchCompatibleCarpool writes) incl. one OUTSIDE the 30-day range
  const row = (o: Record<string, unknown>) => ({ organization_id: org.orgId, user_id: U.r1.id, created_at: new Date().toISOString(), ...o });
  const { error: logError } = await admin.from("carpool_search_log").insert([
    row({ source: "web", offers_evaluated: 4, prefilter_candidates: 3, precise_route_calls: 2, compatible_count: 2, outcome: "matches", latency_ms: 120 }),
    row({ source: "web", offers_evaluated: 2, prefilter_candidates: 0, precise_route_calls: 0, compatible_count: 0, outcome: "none", latency_ms: 40 }),
    row({ source: "chat", offers_evaluated: 5, prefilter_candidates: 2, precise_route_calls: 2, compatible_count: 1, outcome: "matches", latency_ms: 200 }),
    row({ source: "chat", offers_evaluated: 3, prefilter_candidates: 2, precise_route_calls: 2, compatible_count: 0, outcome: "unavailable", latency_ms: 500 }),
    row({ source: "web", offers_evaluated: 0, prefilter_candidates: 0, precise_route_calls: 0, compatible_count: 0, outcome: "error", latency_ms: 10 }),
    row({ source: "web", offers_evaluated: 9, prefilter_candidates: 9, precise_route_calls: 9, compatible_count: 9, outcome: "matches", latency_ms: 999, created_at: new Date(Date.now() - 40 * 86400000).toISOString() }),
  ]);
  if (logError) log.rpcFail.push("search log insert: " + JSON.stringify(logError));

  // Cost Guard counters through the real functions
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 5; i++) await rpc(SVC, "increment_geo_provider_quota_counter", { p_organization_id: org.orgId, p_provider_call_kind: "routing", p_day: day }, SVC);
  for (const [ok2, ms] of [[true, 100], [true, 200], [true, 300], [true, 400], [false, 1000]] as const) {
    await rpc(SVC, "record_geo_provider_call_outcome", { p_organization_id: org.orgId, p_provider_call_kind: "routing", p_day: day, p_ok: ok2, p_latency_ms: ms }, SVC);
  }
  for (let i = 0; i < 3; i++) {
    await rpc(SVC, "increment_geo_provider_quota_counter", { p_organization_id: org.orgId, p_provider_call_kind: "geocode", p_day: day }, SVC);
    await rpc(SVC, "record_geo_provider_call_outcome", { p_organization_id: org.orgId, p_provider_call_kind: "geocode", p_day: day, p_ok: true, p_latency_ms: 90 }, SVC);
  }
}, 600_000);

afterAll(async () => {
  await cleanupOrgs(orgs, "KPI");
  console.log("cleanup:", summary("kpi live cleanup") === 0 ? "all zeros" : "NOT CLEAN");
}, 600_000);

describe("KPI dashboard data function vs the known scenario", () => {
  it("scenario was created through the real RPCs without failures", () => {
    expect(log.rpcFail).toEqual([]);
    const states = ids;
    expect(Object.values(states).every((v) => typeof v === "string" && v.length > 10)).toBe(true);
  });

  it("every KPI equals the hand-derived expectation (30-day range)", async () => {
    const r = await loadCarpoolKpis(admin, org.orgId, 30);
    console.log("KPI report (30d):", JSON.stringify(r));

    // search telemetry (rows inside the range only)
    expect(r.search.searches).toBe(5);
    expect(r.search.offersEvaluated).toBe(4 + 2 + 5 + 3 + 0);
    expect(r.search.prefilterCandidates).toBe(3 + 0 + 2 + 2 + 0);
    expect(r.search.preciseRouteCalls).toBe(2 + 0 + 2 + 2 + 0);
    expect(r.search.compatibleMatches).toBe(2 + 0 + 1 + 0 + 0);
    expect(r.search.outcomes).toEqual({ matches: 2, none: 1, unavailable: 1, error: 1 });
    expect(r.search.bySource).toEqual({ web: 3, chat: 2 });
    expect(r.search.latencyAvgMs).toBe(Math.round((120 + 40 + 200 + 500 + 10) / 5));
    expect(r.search.latencyP95Ms).toBe(500);

    // offers + invalidations (events written by the real RPCs / trigger)
    expect(r.offers.enabled).toBe(3);
    expect(r.offers.activeNow).toBe(3);
    expect(r.invalidations).toBe(1);

    // ride requests: A accepted, B rejected, C accepted, D invalidated, E pending
    expect(r.requests).toEqual({ total: 5, pending: 1, accepted: 2, rejected: 1, expired: 0, cancelled: 0, invalidated: 1, acceptanceRate: 66.7 });

    // shared trips: only H1's completed trip has an ACCEPTED rider (rA, 2 seats)
    const expectedKm = Math.round(haversineKm(P1.coordinates, Q1.coordinates) * ROAD_DISTANCE_FACTOR * 10) / 10;
    expect(r.shared).toEqual({ completedSharedTrips: 1, seatsShared: 2, avoidedAllocations: 1, avoidedKmEstimate: expectedKm, requestsWithoutCoordinates: 0 });

    // provider counters written by Cost Guard's functions
    expect(r.provider.byKind).toEqual([
      { kind: "geocode", calls: 3, errors: 0, avgLatencyMs: 90, estCostUsd: 0.015 },
      { kind: "routing", calls: 5, errors: 1, avgLatencyMs: 400, estCostUsd: 0.05 },
    ]);
    expect(r.provider.totalCalls).toBe(8);
    expect(r.provider.totalErrors).toBe(1);
    expect(r.provider.estCostUsd).toBe(0.065);
  }, 120_000);

  it("range filtering: 7d equals 30d for fresh data; 90d also includes the 40-day-old search row", async () => {
    const r7 = await loadCarpoolKpis(admin, org.orgId, 7);
    const r90 = await loadCarpoolKpis(admin, org.orgId, 90);
    expect(r7.search.searches).toBe(5);
    expect(r90.search.searches).toBe(6);
    expect(r90.search.compatibleMatches).toBe(2 + 1 + 9);
    expect(r7.requests.total).toBe(5);
  }, 120_000);

  it("another organization sees none of this scenario's numbers", async () => {
    const r = await loadCarpoolKpis(admin, "00000000-0000-4000-8000-00000000dead", 30);
    expect(r.search.searches).toBe(0);
    expect(r.requests.total).toBe(0);
    expect(r.shared.completedSharedTrips).toBe(0);
    expect(r.provider.totalCalls).toBe(0);
  }, 60_000);
});
