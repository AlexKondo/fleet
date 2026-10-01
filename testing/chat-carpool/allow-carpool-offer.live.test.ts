/**
 * LIVE regression: host reserves with allow_carpool=false, later enables an offer; a compatible
 * rider's real searchCompatibleCarpool (live DB + RLS + real Google) must now return it.
 * Disposable org/users, cleaned in afterAll. Run from apps/web:
 *   npx vitest run --config vitest.battery.config.ts allow-carpool-offer
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const text = fs.readFileSync("C:/projects/fleet/.env", "utf8");
  const get = (n: string) => text.match(new RegExp("^" + n + "=(.*)$", "m"))?.[1]?.trim() ?? "";
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_MAPS_API_KEY"]) process.env[k] = get(k);
  return { current: { id: "", client: null as unknown } };
});
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => env.current.client }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => ({ id: env.current.id }) }));

import { createClient } from "@supabase/supabase-js";
import { searchCompatibleCarpool } from "@/app/carpool/actions";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";
// @ts-expect-error shared ESM helper
import { sql, provisionOrg, cleanupOrgs, PASSWORD, URL_, ANON } from "../live-demo/carpool-c5-lib.mjs";

let org: { orgId: string; users: Record<string, { id: string; email: string }>; vehicles: { id: string }[] };
const clients: Record<string, ReturnType<typeof createClient>> = {};
let tripId = "", offerId = "", dep = new Date();

async function signIn(email: string) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j = await r.json();
  return createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${j.access_token}` } }, auth: { persistSession: false } });
}

beforeAll(async () => {
  org = await provisionOrg("alw", [["host", "employee"], ["rider", "employee"]]);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${org.orgId}', 1, 15, 15, 5, 15, 30)`);
  dep = new Date(Date.now() + 5 * 86400000);
  const ret = new Date(dep.getTime() + 8 * 3600000);
  // allow_carpool = FALSE: the host answered "No" at reservation time
  const [t] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification, allow_carpool)
    values ('${org.orgId}', '${org.users.host!.id}', '${dep.toISOString()}', '${ret.toISOString()}', 'Avenida Paulista, 1578, São Paulo', 'Aeroporto de Congonhas, São Paulo', 10, 1, 'allow_carpool regression', false) returning id`);
  tripId = t.id;
  await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${org.orgId}', '${org.vehicles[0]!.id}', '${tripId}', 'confirmed', '${dep.toISOString()}', '${ret.toISOString()}')`);
  for (const n of ["host", "rider"]) clients[n] = await signIn(org.users[n]!.email);
  await new Promise((r) => setTimeout(r, 1500));
  const e = await clients.host!.rpc("enable_carpool_offer", { p_trip_request_id: tripId, p_seats: 2 });
  if (e.error) throw new Error(JSON.stringify(e.error));
  offerId = e.data as string;
}, 180_000);

afterAll(async () => { await cleanupOrgs([org]); }, 120_000);

describe("allow_carpool=false trip with an enabled offer", () => {
  it("DB precondition: the trip really has allow_carpool=false and the offer is active", async () => {
    const [r] = await sql(`select tr.allow_carpool, o.status from trip_requests tr join carpool_offers o on o.trip_request_id=tr.id where tr.id='${tripId}'`);
    expect(r).toEqual({ allow_carpool: false, status: "active" });
  });

  it("a compatible rider's real search returns that offer", async () => {
    env.current.id = org.users.rider!.id;
    env.current.client = clients.rider;
    const geo = createGooglePlacesProvider(org.orgId);
    const p = await geo.geocode("Avenida Paulista, 1578, São Paulo");
    const d = await geo.geocode("Avenida Washington Luís, 5000, São Paulo");
    if (p.status !== "ok" || d.status !== "ok") throw new Error("geocode failed " + JSON.stringify([p, d]));
    const result = await searchCompatibleCarpool({
      requestedDepartureAt: dep.toISOString(),
      requestedSeats: 1,
      requiresCargo: false,
      pickup: p.location.coordinates,
      dropoff: d.location.coordinates,
    });
    console.log("SEARCH RESULT", JSON.stringify(result));
    if (result.status === "matches" && result.matches.length === 0) {
      const rr = await clients.rider!.from("reservations").select("trip_request_id,status,end_at").eq("trip_request_id", tripId);
      const oo = await clients.rider!.from("carpool_offers").select("id,status,seats_available").eq("id", offerId);
      console.log("DEBUG rider sees", JSON.stringify({ rr: rr.data, oo: oo.data }));
    }
    expect(result.status).toBe("matches");
    if (result.status === "matches") expect(result.matches.map((m) => m.offerId)).toEqual([offerId]);
  }, 120_000);
});
