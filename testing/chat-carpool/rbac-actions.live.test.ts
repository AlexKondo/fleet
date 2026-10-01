/**
 * C7b - LIVE RBAC matrix for the carpool SERVER ACTIONS (the real code of apps/web/app/carpool/*, settings/carpoolPolicyActions,
 * settings/mobility-points/actions) x roles, against the live project with REAL user JWTs (disposable org). Only the
 * cookie/session boundary is replaced (the server client = a supabase-js client signed in as the current role; anon =
 * no session). Prints the matrix (cell = ACTUAL: Y authorised / . refused) and asserts it equals the expectation.
 *
 * Run from apps/web: npx vitest run --config vitest.battery.config.ts rbac-actions
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const text = fs.readFileSync("C:/projects/fleet/.env", "utf8");
  const get = (n: string) => text.match(new RegExp("^" + n + "=(.*)$", "m"))?.[1]?.trim() ?? "";
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) process.env[k] = get(k);
  return { current: { id: "", client: null as unknown } };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => "pt-BR", getDictionary: async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => env.current.client }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => (env.current.id ? { id: env.current.id } : null) }));

import { createClient } from "@supabase/supabase-js";
import {
  acceptCarpoolRequest, cancelCarpoolRequest, disableCarpoolOffer, enableCarpoolOffer, rejectCarpoolRequest, requestCarpoolRide,
  revalidateCarpoolMatches, updateCarpoolOffer,
} from "@/app/carpool/requestActions";
import { searchCompatibleCarpool } from "@/app/carpool/actions";
import { getMyCarpoolRequestStatus } from "@/app/carpool/formActions";
import { publishCarpoolPolicy } from "@/app/settings/carpoolPolicyActions";
import { createMobilityPoint, deactivateMobilityPoint, updateMobilityPoint } from "@/app/settings/mobility-points/actions";
// @ts-expect-error plain ESM helper shared with the other live scripts
import { sql, provisionOrg, cleanupOrgs, PASSWORD, URL_, ANON } from "../live-demo/carpool-c5-lib.mjs";

const ROLES = ["anon", "host", "rider", "stranger", "sec", "mgr", "adm", "mnt", "other"] as const;
type Role = (typeof ROLES)[number];
type Org = { orgId: string; users: Record<string, { id: string; email: string }>; vehicles: { id: string }[] };
const orgs: Org[] = [];
let A: Org, B: Org;
const clients: Record<string, unknown> = {};
const ids: Record<Role, string> = { anon: "", host: "", rider: "", stranger: "", sec: "", mgr: "", adm: "", mnt: "", other: "" };
let n = 0;

async function signIn(email: string) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j = await r.json();
  return createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${j.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}
const as = (role: Role) => {
  env.current.id = ids[role];
  env.current.client = role === "anon" ? createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } }) : clients[role];
};

async function fresh(kind: "trip" | "offer" | "pending") {
  n += 1;
  const h = 300 + n * 8;
  const [r] = await sql(`with t as (insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, allow_carpool)
      values ('${A.orgId}', '${A.users.host!.id}', now() + interval '${h} hours', now() + interval '${h + 4} hours', 'Origem', 'Destino', 10, 1, false, 'rbac', true) returning id),
    rs as (insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) select '${A.orgId}', '${A.vehicles[n % 2]!.id}', t.id, 'confirmed', now() + interval '${h} hours', now() + interval '${h + 4} hours' from t returning id),
    o as (insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) select '${A.orgId}', t.id, '${A.users.host!.id}', 'active', 3, 3, 1 from t where ${kind !== "trip"} returning id),
    q as (insert into carpool_ride_requests (organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location, requested_departure_at, status, policy_version, match_additional_distance_km, match_additional_time_min)
      select '${A.orgId}', o.id, '${A.users.rider!.id}', 1, '{"label":"Rua Rider 10","coordinates":{"lat":-23.55,"lng":-46.63}}', '{"label":"Av Destino 20","coordinates":{"lat":-23.56,"lng":-46.64}}', now() + interval '${h} hours', 'PENDING', 1, 1, 2 from o where ${kind === "pending"} returning id)
    select (select id from t) trip, (select id from o) offer, (select id from q) req, (select count(*) from rs) rs`);
  return r as { trip: string; offer: string; req: string };
}

interface Probe { name: string; kind?: "trip" | "offer" | "pending"; allowed: Role[]; run: (s: { trip: string; offer: string; req: string }, role: Role) => Promise<boolean> }
const okStatus = (r: { status: string }) => r.status === "success";
const policyForm = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ departureWindowMinutes: "15", returnWindowMinutes: "15", maxAdditionalDistanceKm: "5", maxAdditionalTimeMinutes: "10", maxCandidatesForPreciseRouting: "5", requestExpiryMinutes: "30", minimumSeatAvailability: "1", carpoolEnabled: "on", carpoolFirstEnabled: "on", hostOptInRequired: "on", hostApprovalRequired: "on", allowIntermediatePickup: "on", allowIntermediateDropoff: "on" })) f.set(k, v);
  return f;
};
const mpForm = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: "Ponto RBAC " + randomUUID().slice(0, 4), addressLabel: "Av Teste 3, São Paulo", latitude: "-23.55", longitude: "-46.63", category: "gate", aliases: "", ...extra })) f.set(k, v);
  return f;
};
let mpId = "";

const PROBES: Probe[] = [
  { name: "enableCarpoolOffer", kind: "trip", allowed: ["host", "mgr", "adm"], run: async (s) => okStatus(await enableCarpoolOffer(s.trip, 2)) },
  { name: "updateCarpoolOffer", kind: "offer", allowed: ["host", "mgr", "adm"], run: async (s) => okStatus(await updateCarpoolOffer(s.offer, 2)) },
  { name: "disableCarpoolOffer", kind: "offer", allowed: ["host", "mgr", "adm"], run: async (s) => okStatus(await disableCarpoolOffer(s.offer)) },
  { name: "revalidateCarpoolMatches", kind: "offer", allowed: ["host", "mgr", "adm"], run: async (s) => okStatus(await revalidateCarpoolMatches(s.trip)) },
  { name: "acceptCarpoolRequest", kind: "pending", allowed: ["host", "mgr", "adm"], run: async (s) => okStatus(await acceptCarpoolRequest(s.req)) },
  { name: "rejectCarpoolRequest", kind: "pending", allowed: ["host", "mgr", "adm"], run: async (s) => okStatus(await rejectCarpoolRequest(s.req, "rbac")) },
  { name: "cancelCarpoolRequest", kind: "pending", allowed: ["rider", "mgr", "adm"], run: async (s) => okStatus(await cancelCarpoolRequest(s.req)) },
  { name: "getMyCarpoolRequestStatus (own request only)", kind: "pending", allowed: ["rider"], run: async (s) => (await getMyCarpoolRequestStatus(s.req)) !== null },
  {
    name: "searchCompatibleCarpool (any signed-in user; no provider call: empty shortlist)",
    allowed: ["host", "rider", "stranger", "sec", "mgr", "adm", "mnt", "other"],
    run: async () => (await searchCompatibleCarpool({ requestedDepartureAt: new Date(Date.now() + 9000 * 3600e3).toISOString(), requestedSeats: 1, requiresCargo: false, pickup: { lat: -23.55, lng: -46.63 }, dropoff: { lat: -23.56, lng: -46.64 } })).status !== "error",
  },
  { name: "requestCarpoolRide (needs a session; forged ids refused)", allowed: [], run: async () => okStatus(await requestCarpoolRide({ offerId: randomUUID(), clientRequestId: randomUUID(), draft: { requestedDepartureAt: new Date().toISOString(), requestedSeats: 1, requiresCargo: false, pickup: { lat: -23.55, lng: -46.63 }, dropoff: { lat: -23.56, lng: -46.64 } } })) },
  { name: "publishCarpoolPolicy (settings)", allowed: ["mgr", "adm"], run: async () => (await publishCarpoolPolicy({ status: "idle" }, policyForm())).status === "success" },
  { name: "createMobilityPoint (settings)", allowed: ["mgr", "adm"], run: async () => (await createMobilityPoint({ status: "idle" }, mpForm())).status === "success" },
  { name: "updateMobilityPoint (settings)", allowed: ["mgr", "adm"], run: async () => (await updateMobilityPoint({ status: "idle" }, mpForm({ id: mpId, name: "Renomeado " + randomUUID().slice(0, 3) }))).status === "success" },
  {
    name: "deactivateMobilityPoint (settings; effect checked in the DB)",
    allowed: ["mgr", "adm"],
    run: async () => {
      const [before] = await sql(`select is_active a from corporate_mobility_points where id='${mpId}'`);
      await deactivateMobilityPoint(mpId);
      const [after] = await sql(`select is_active a from corporate_mobility_points where id='${mpId}'`);
      await sql(`update corporate_mobility_points set is_active = true where id='${mpId}'`);
      return before.a === true && after.a === false;
    },
  },
];

const matrix: { name: string; allowed: Role[]; actual: Record<Role, boolean> }[] = [];

beforeAll(async () => {
  A = await provisionOrg("ra", [["host", "employee"], ["rider", "employee"], ["stranger", "employee"], ["sec", "security"], ["mgr", "fleet_manager"], ["adm", "administrator"], ["mnt", "maintenance_operator"]]);
  B = await provisionOrg("rb", [["other", "employee"]]);
  orgs.push(A, B);
  for (const r of ["host", "rider", "stranger", "sec", "mgr", "adm", "mnt"] as const) { clients[r] = await signIn(A.users[r]!.email); ids[r] = A.users[r]!.id; }
  clients.other = await signIn(B.users.other!.email); ids.other = B.users.other!.id;
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);
  const [mp] = await sql(`insert into corporate_mobility_points (organization_id, name, address_label, latitude, longitude) values ('${A.orgId}', 'Ponto base', 'Av Teste 1', -23.5, -46.6) returning id`);
  mpId = mp.id;
  await new Promise((r) => setTimeout(r, 1500));
}, 300_000);

afterAll(async () => {
  const w = Math.max(...matrix.map((m) => m.name.length)) + 2;
  console.log("\nCarpool server-action RBAC matrix (cell = ACTUAL: Y authorised / . refused; '!' = differs from the expectation)");
  console.log("endpoint".padEnd(w) + ROLES.map((r) => r.padEnd(9)).join(""));
  for (const m of matrix) console.log(m.name.padEnd(w) + ROLES.map((r) => ((m.actual[r] ? "Y" : ".") + (m.actual[r] === m.allowed.includes(r) ? "" : "!")).padEnd(9)).join(""));
  await cleanupOrgs(orgs, "RBAC-actions");
}, 300_000);

describe("carpool server actions x roles (live, real RLS + RPCs)", () => {
  for (const probe of PROBES) {
    it(probe.name, async () => {
      const actual = {} as Record<Role, boolean>;
      for (const role of ROLES) {
        const st = probe.kind ? await fresh(probe.kind) : { trip: randomUUID(), offer: randomUUID(), req: randomUUID() };
        as(role);
        let ok = false;
        try { ok = await probe.run(st, role); } catch { ok = false; }
        actual[role] = ok;
      }
      matrix.push({ name: probe.name, allowed: probe.allowed, actual });
      const mismatches = ROLES.filter((r) => actual[r] !== probe.allowed.includes(r));
      expect(mismatches, `unexpected outcomes for: ${mismatches.join(", ")}`).toEqual([]);
    }, 300_000);
  }
});
