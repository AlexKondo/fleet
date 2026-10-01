/**
 * Phase C6 - LIVE-DB security test of the chat/voice carpool path (pack 07 "Security tests":
 * unauthorized access, forged ids, direct call bypassing the UI).
 *
 * The REAL code under test (apps/web/app/chat/carpoolChat.ts -> apps/web/app/carpool/
 * requestActions.ts -> the security-definer RPCs + RLS) runs against the live Supabase project
 * with REAL user JWTs of disposable users (same approach as supabase/tests/carpool-lifecycle-
 * rpcs.mjs). Only the cookie/session boundary is replaced: createSupabaseServerClient returns a
 * supabase-js client signed in as "the current user" and getCurrentUser returns that user.
 * Every row it creates is deleted in afterAll (cleanup query printed).
 *
 * Run from apps/web: npx vitest run --config vitest.battery.config.ts chat-security
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const text = fs.readFileSync("C:/projects/fleet/.env", "utf8");
  const get = (n: string) => text.match(new RegExp("^" + n + "=(.*)$", "m"))?.[1]?.trim() ?? "";
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("NEXT_PUBLIC_SUPABASE_URL");
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
  return { current: { id: "", client: null as unknown } };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => "pt-BR" }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => env.current.client }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => (env.current.id ? { id: env.current.id } : null) }));

import { createClient } from "@supabase/supabase-js";
import { dispatchIntent } from "@/app/chat/dispatch";
import { prepareCarpoolIntent, loadChatCarpoolCtx } from "@/app/chat/carpoolChat";
import { acceptCarpoolRequest, disableCarpoolOffer, rejectCarpoolRequest } from "@/app/carpool/requestActions";
// @ts-expect-error plain ESM helper shared with the C5 walk-through
import { sql, provisionOrg, cleanupOrgs, PASSWORD, URL_, ANON, SVC } from "../live-demo/carpool-c5-lib.mjs";

const ROOT = "C:/projects/fleet";
void ROOT; void path; void readFileSync;

interface U { id: string; email: string; fullName: string }
const orgs: unknown[] = [];
let org: { orgId: string; users: Record<string, U>; vehicles: { id: string }[] };
const ctxs: Record<string, { client: unknown }> = {};
let tripHost = "", offerHost = "", tripHost2 = "", offerHost2 = "", reqRider = "";

async function signIn(email: string) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("sign-in failed " + JSON.stringify(j));
  return createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${j.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}
function as(name: string) {
  env.current.id = org.users[name]!.id;
  env.current.client = ctxs[name]!.client;
}
const offerStatus = async (id: string) => (await sql(`select status, seats_available from carpool_offers where id='${id}'`))[0];
const reqStatus = async (id: string) => (await sql(`select status from carpool_ride_requests where id='${id}'`))[0].status;

beforeAll(async () => {
  org = await provisionOrg("sec", [["host", "employee"], ["rider", "employee"], ["host2", "employee"], ["outsider", "employee"], ["mgr", "fleet_manager"]]);
  orgs.push(org);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
    values ('${org.orgId}', 1, 15, 15, 5, 10, 30)`);
  const dep = new Date(Date.now() + 10 * 86400000);
  const ret = new Date(dep.getTime() + 4 * 3600000);
  const mkTrip = async (userName: string, vehicleId: string, dest: string) => {
    const [t] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification)
      values ('${org.orgId}', '${org.users[userName]!.id}', '${dep.toISOString()}', '${ret.toISOString()}', 'Sede SEC', '${dest}', 30, 1, 'C6 security') returning id`);
    await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${org.orgId}', '${vehicleId}', '${t.id}', 'confirmed', '${dep.toISOString()}', '${ret.toISOString()}')`);
    return t.id as string;
  };
  tripHost = await mkTrip("host", org.vehicles[0]!.id, "Destino Host SEC");
  tripHost2 = await mkTrip("host2", org.vehicles[1]!.id, "Destino Host2 SEC");
  for (const name of Object.keys(org.users)) ctxs[name] = { client: await signIn(org.users[name]!.email) };
  await new Promise((r) => setTimeout(r, 1500)); // JWT clock-skew settle

  // Hosts publish their offers through the REAL RPC with their own JWT.
  const e1 = await (ctxs.host!.client as ReturnType<typeof createClient>).rpc("enable_carpool_offer", { p_trip_request_id: tripHost, p_seats: 2 });
  const e2 = await (ctxs.host2!.client as ReturnType<typeof createClient>).rpc("enable_carpool_offer", { p_trip_request_id: tripHost2, p_seats: 2 });
  if (e1.error || e2.error) throw new Error("enable failed " + JSON.stringify([e1.error, e2.error]));
  offerHost = e1.data as string;
  offerHost2 = e2.data as string;

  // The rider's pending request on host's offer (service-role function, like requestCarpoolRide).
  const svc = createClient(URL_, SVC, { auth: { persistSession: false } });
  const r = await svc.rpc("create_carpool_ride_request_as_rider", {
    p_rider_id: org.users.rider!.id, p_offer_id: offerHost, p_seats: 1,
    p_pickup: { coordinates: { lat: -23.55, lng: -46.63 }, source: "manual_lat_lng", label: "Pickup SEC" },
    p_dropoff: { coordinates: { lat: -23.56, lng: -46.64 }, source: "manual_lat_lng", label: "Dropoff SEC" },
    p_requested_departure_at: dep.toISOString(), p_client_request_id: randomUUID(),
    p_match_additional_distance_km: 1.5, p_match_additional_time_min: 3,
  });
  if (r.error) throw new Error("request create failed " + JSON.stringify(r.error));
  reqRider = r.data as string;
}, 180_000);

afterAll(async () => {
  await cleanupOrgs(orgs);
}, 120_000);

describe("chat/voice carpool path vs the live backend (real RLS + RPCs)", () => {
  it("a RIDER trying to ACCEPT through chat dispatch is refused; the request stays PENDING", async () => {
    as("rider");
    const r = await dispatchIntent("ACCEPT_CARPOOL_REQUEST", { requestId: reqRider });
    expect(r.success).toBe(false);
    expect(r.message).toBe("CARPOOL_REQUEST_NOT_FOUND");
    expect(await reqStatus(reqRider)).toBe("PENDING");
  });

  it("the rider's chat 'aceita a carona da <name>' resolves to NOTHING (a rider hosts no offers)", async () => {
    as("rider");
    const ctx = (await loadChatCarpoolCtx(env.current.client as never, org.users.rider!.id))!;
    const r = await prepareCarpoolIntent(ctx, "ACCEPT_CARPOOL_REQUEST", { riderName: "C5UI" });
    expect(r.kind).toBe("reply");
  });

  it("a NON-HOST cannot DISABLE someone else's offer via chat dispatch; the offer stays active", async () => {
    as("outsider");
    const r = await dispatchIntent("DISABLE_CARPOOL", { offerId: offerHost });
    expect(r).toMatchObject({ success: false, message: "CARPOOL_OFFER_NOT_FOUND" });
    expect((await offerStatus(offerHost)).status).toBe("active");
    // and the rider as well
    as("rider");
    expect(await dispatchIntent("DISABLE_CARPOOL", { offerId: offerHost })).toMatchObject({ success: false });
    expect((await offerStatus(offerHost)).status).toBe("active");
  });

  it("ANOTHER host cannot ACCEPT or REJECT a request that is not on one of THEIR OWN offers", async () => {
    as("host2");
    const acc = await dispatchIntent("ACCEPT_CARPOOL_REQUEST", { requestId: reqRider });
    expect(acc).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    const rej = await dispatchIntent("REJECT_CARPOOL_REQUEST", { requestId: reqRider, reason: "x" });
    expect(rej).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    expect(await reqStatus(reqRider)).toBe("PENDING");
    // chat reference resolution never sees host1's rider either
    const ctx = (await loadChatCarpoolCtx(env.current.client as never, org.users.host2!.id))!;
    const prep = await prepareCarpoolIntent(ctx, "ACCEPT_CARPOOL_REQUEST", { riderName: "rider" });
    expect(prep.kind).toBe("reply");
    expect(JSON.stringify(prep)).not.toContain(org.users.rider!.fullName);
  });

  it("another user cannot cancel the rider's request via chat; a forged (random) id is 'not found'", async () => {
    as("host2");
    expect(await dispatchIntent("CANCEL_CARPOOL_REQUEST", { requestId: reqRider })).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    as("host");
    expect(await dispatchIntent("CANCEL_CARPOOL_REQUEST", { requestId: reqRider })).toMatchObject({ success: false });
    expect(await dispatchIntent("ACCEPT_CARPOOL_REQUEST", { requestId: randomUUID() })).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    expect(await reqStatus(reqRider)).toBe("PENDING");
  });

  it("direct service calls that bypass the chat resolution are STILL refused by the RPCs (defence in depth)", async () => {
    as("rider");
    expect(await acceptCarpoolRequest(reqRider)).toMatchObject({ status: "error", error: "CARPOOL_NOT_AUTHORIZED" });
    expect(await rejectCarpoolRequest(reqRider, "x")).toMatchObject({ status: "error", error: "CARPOOL_NOT_AUTHORIZED" });
    as("outsider");
    expect(await disableCarpoolOffer(offerHost)).toMatchObject({ status: "error", error: "CARPOOL_NOT_AUTHORIZED" });
    as("host2");
    expect(await acceptCarpoolRequest(reqRider)).toMatchObject({ status: "error", error: "CARPOOL_NOT_AUTHORIZED" });
    expect(await reqStatus(reqRider)).toBe("PENDING");
    expect((await offerStatus(offerHost)).status).toBe("active");
  });

  it("the legitimate path works: host resolves 'Ana'-style reference among OWN requests -> accepts -> seats decrement", async () => {
    as("host");
    const ctx = (await loadChatCarpoolCtx(env.current.client as never, org.users.host!.id))!;
    const prep = await prepareCarpoolIntent(ctx, "ACCEPT_CARPOOL_REQUEST", { riderName: "rider" });
    expect(prep.kind).toBe("confirm");
    if (prep.kind !== "confirm") return;
    expect(prep.slots.requestId).toBe(reqRider);
    const done = await dispatchIntent("ACCEPT_CARPOOL_REQUEST", prep.slots);
    expect(done.success).toBe(true);
    expect(await reqStatus(reqRider)).toBe("ACCEPTED");
    expect((await offerStatus(offerHost)).seats_available).toBe(1);
  });

  it("the rider cancels their own (accepted) request via chat -> seat released; the host disables the offer via chat", async () => {
    as("rider");
    const ctx = (await loadChatCarpoolCtx(env.current.client as never, org.users.rider!.id))!;
    const prep = await prepareCarpoolIntent(ctx, "CANCEL_CARPOOL_REQUEST", {});
    expect(prep.kind).toBe("confirm");
    if (prep.kind !== "confirm") return;
    expect((await dispatchIntent("CANCEL_CARPOOL_REQUEST", prep.slots)).success).toBe(true);
    expect(await reqStatus(reqRider)).toBe("CANCELLED");
    expect((await offerStatus(offerHost)).seats_available).toBe(2);

    as("host");
    const hostCtx = (await loadChatCarpoolCtx(env.current.client as never, org.users.host!.id))!;
    const dis = await prepareCarpoolIntent(hostCtx, "DISABLE_CARPOOL", {});
    expect(dis.kind).toBe("confirm");
    if (dis.kind !== "confirm") return;
    expect((await dispatchIntent("DISABLE_CARPOOL", dis.slots)).success).toBe(true);
    expect((await offerStatus(offerHost)).status).toBe("disabled");
    // host2's offer was never touched
    expect((await offerStatus(offerHost2)).status).toBe("active");
  });
});
