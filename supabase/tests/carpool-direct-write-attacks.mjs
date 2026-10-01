#!/usr/bin/env node
// Phase C4 audit blocker test (0060): direct table writes must NOT bypass the RPC invariants.
//
// Against the LIVE project, with real employee / manager JWTs and the anon key, this tries to
// INSERT / PATCH / DELETE rows of carpool_offers, carpool_ride_requests, carpool_events,
// carpool_policy_settings, geo_provider_quota_counters and corporate_mobility_points straight
// through PostgREST, and proves (a) the requests are refused and (b) ground truth read back via
// SQL is unchanged. It then proves the RPC paths (enable -> service-role create -> accept ->
// cancel) still work. All data is disposable (two throwaway orgs, users) and removed in finally.
//
// Usage: node supabase/tests/carpool-direct-write-attacks.mjs   (reads repo-root .env)

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT_ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
const envFile = (n) => readFileSync(ROOT_ENV, 'utf8').match(new RegExp('^' + n + '=(.*)$', 'm'))?.[1].trim();
const MGMT = process.env.SUPABASE_TOKEN || envFile('SUPABASE_TOKEN');
const URL_ = process.env.SUPABASE_URL || envFile('NEXT_PUBLIC_SUPABASE_URL');
const ANON = process.env.SUPABASE_ANON_KEY || envFile('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || envFile('SUPABASE_SERVICE_ROLE_KEY');
const REF = 'rhbiwkxilelitugbwind';

const results = [];
function record(name, pass, details) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name);
  if (details !== undefined) console.log('    ' + (typeof details === 'string' ? details : JSON.stringify(details)));
}
async function sql(query) {
  const res = await fetch('https://api.supabase.com/v1/projects/' + REF + '/database/query', {
    method: 'POST', headers: { Authorization: 'Bearer ' + MGMT, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const t = await res.text();
  if (res.status >= 400) throw new Error('SQL failed: ' + t + '\n' + query);
  return JSON.parse(t);
}
async function adminCreateUser(email, password) {
  const res = await fetch(URL_ + '/auth/v1/admin/users', {
    method: 'POST', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const j = await res.json();
  if (!j.id) throw new Error('create user failed ' + JSON.stringify(j));
  return j.id;
}
async function signIn(email, password) {
  const res = await fetch(URL_ + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('sign-in failed ' + JSON.stringify(j));
  return j.access_token;
}
// rest(token|null, METHOD, 'table?filter', body) -> {status, body}; null token = anon key only.
async function rest(token, method, pathAndQuery, body) {
  const res = await fetch(URL_ + '/rest/v1/' + pathAndQuery, {
    method,
    headers: { apikey: ANON, Authorization: 'Bearer ' + (token ?? ANON), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let b = null;
  try { b = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: b };
}
async function rpc(token, fn, args, key = ANON) {
  const res = await fetch(URL_ + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + (token ?? key), 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  let b = null;
  try { b = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: b, ok: res.status < 300 };
}
const denied = (r) => r.status === 401 || r.status === 403;
const msg = (r) => (r.body && (r.body.message || JSON.stringify(r.body))) || String(r.status);

const T = Date.now().toString(36);
const PW = 'C4atk!' + randomUUID().slice(0, 8);
const email = (n) => 'c4atk-' + n + '-' + T + '@fleet-test.invalid';
const ctx = { users: {}, tok: {} };
const DEP = new Date(Date.now() + 10 * 86400000);
const DEP_ISO = DEP.toISOString();

async function setup() {
  const [a] = await sql("insert into organizations (name) values ('C4TEST-ORG-A-" + T + "') returning id");
  const [b] = await sql("insert into organizations (name) values ('C4TEST-ORG-B-" + T + "') returning id");
  ctx.orgA = a.id; ctx.orgB = b.id;
  for (const [n, org, role] of [['host', a.id, 'employee'], ['rider', a.id, 'employee'], ['mgr', a.id, 'fleet_manager'], ['other', b.id, 'employee']]) {
    ctx.users[n] = await adminCreateUser(email(n), PW);
    await sql("insert into profiles (id, organization_id, full_name, role) values ('" + ctx.users[n] + "','" + org + "','C4TEST " + n + "','" + role + "')");
  }
  await sql("insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('" + ctx.orgA + "',1,15,15,5,10,30)");
  const [cat] = await sql("insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('" + ctx.orgA + "','C4TEST cat',5,'ICE') returning id");
  const [veh] = await sql("insert into vehicles (organization_id, plate, category_id, status) values ('" + ctx.orgA + "','C4A" + T.slice(-4).toUpperCase() + "','" + cat.id + "','reserved') returning id");
  const end = new Date(DEP.getTime() + 4 * 3600000).toISOString();
  const [trip] = await sql("insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('" + ctx.orgA + "','" + ctx.users.host + "','" + DEP_ISO + "','" + end + "','Sede','Destino',30,1,'C4TEST') returning id");
  ctx.tripId = trip.id;
  const [res] = await sql("insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('" + ctx.orgA + "','" + veh.id + "','" + trip.id + "','confirmed','" + DEP_ISO + "','" + end + "') returning id");
  ctx.resId = res.id;
  for (const n of Object.keys(ctx.users)) ctx.tok[n] = await signIn(email(n), PW);
  await new Promise((r) => setTimeout(r, 1500));
}

async function cleanup() {
  try {
    for (const org of [ctx.orgA, ctx.orgB].filter(Boolean)) {
      await sql("delete from reservations where organization_id='" + org + "'");
      await sql("delete from organizations where id='" + org + "'");
    }
    for (const id of Object.values(ctx.users)) {
      await fetch(URL_ + '/auth/v1/admin/users/' + id, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
    }
    const ids = Object.values(ctx.users).map((u) => "'" + u + "'").join(',') || "'00000000-0000-0000-0000-000000000000'";
    const left = await sql("select (select count(*) from organizations where name like 'C4TEST-ORG-%-" + T + "') orgs, (select count(*) from profiles where id in (" + ids + ")) profiles, (select count(*) from carpool_offers where organization_id in ('" + ctx.orgA + "','" + ctx.orgB + "')) offers, (select count(*) from carpool_ride_requests where organization_id in ('" + ctx.orgA + "','" + ctx.orgB + "')) requests, (select count(*) from carpool_policy_settings where organization_id in ('" + ctx.orgA + "','" + ctx.orgB + "')) policies, (select count(*) from corporate_mobility_points where organization_id in ('" + ctx.orgA + "','" + ctx.orgB + "')) points");
    record('Cleanup: no disposable rows left in the live DB', Object.values(left[0]).every((v) => Number(v) === 0), left[0]);
  } catch (e) {
    record('Cleanup', false, String(e));
  }
}

async function main() {
  console.log('\n=== Carpool direct-write attack test (live) — ' + new Date().toISOString() + ' ===\n');
  await setup();
  const U = ctx.users;
  const actors = { rider: ctx.tok.rider, host: ctx.tok.host, manager: ctx.tok.mgr, anon: null };

  // Legit setup through the RPC paths (also proves they still work after the lockdown).
  console.log('--- RPC paths still work ---');
  const en = await rpc(actors.host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 2 });
  ctx.offerId = en.body;
  record('enable_carpool_offer (host) works', en.ok && typeof en.body === 'string', msg(en));
  const mk = (key) => rpc(SVC, 'create_carpool_ride_request_as_rider', {
    p_rider_id: U.rider, p_offer_id: ctx.offerId, p_seats: 1,
    p_pickup: { coordinates: { lat: -23.5, lng: -46.6 }, source: 'manual_lat_lng' }, p_dropoff: { coordinates: { lat: -23.6, lng: -46.7 }, source: 'manual_lat_lng' },
    p_requested_departure_at: DEP_ISO, p_client_request_id: key, p_match_additional_distance_km: 1, p_match_additional_time_min: 2,
  }, SVC);
  const cr = await mk(randomUUID());
  ctx.reqId = cr.body;
  record('service-role create (server-action path) works', cr.ok && typeof cr.body === 'string', msg(cr));
  const state = async () => ({
    offer: (await sql("select status, seats_offered, seats_available, host_id from carpool_offers where id='" + ctx.offerId + "'"))[0],
    req: (await sql("select status, requested_seats, rider_id from carpool_ride_requests where id='" + ctx.reqId + "'"))[0],
    counts: (await sql("select (select count(*) from carpool_offers where organization_id='" + ctx.orgA + "') o, (select count(*) from carpool_ride_requests where organization_id='" + ctx.orgA + "') r"))[0],
  });
  const before = await state();
  record('Baseline: request PENDING, offer 2/2', before.req.status === 'PENDING' && before.offer.seats_available === 2, before);

  // ------------------------------------------------------------------ attacks
  console.log('--- Direct INSERT / PATCH / DELETE attacks (all must be refused) ---');
  for (const [who, tok] of Object.entries(actors)) {
    const label = who;
    const org = ctx.orgA;
    // carpool_ride_requests
    const insReq = await rest(tok, 'POST', 'carpool_ride_requests', {
      organization_id: org, carpool_offer_id: ctx.offerId, rider_id: U.rider, requested_seats: 3, status: 'ACCEPTED',
      requested_departure_at: DEP_ISO, policy_version: 1,
    });
    record('[' + label + '] INSERT carpool_ride_requests (status=ACCEPTED, seats=3) refused', denied(insReq), 'status=' + insReq.status + ' ' + msg(insReq));
    const patchReq = await rest(tok, 'PATCH', 'carpool_ride_requests?id=eq.' + ctx.reqId, { status: 'ACCEPTED' });
    record('[' + label + '] PATCH carpool_ride_requests -> ACCEPTED refused', denied(patchReq), 'status=' + patchReq.status + ' ' + msg(patchReq));
    const patchSeats = await rest(tok, 'PATCH', 'carpool_ride_requests?id=eq.' + ctx.reqId, { requested_seats: 9 });
    record('[' + label + '] PATCH carpool_ride_requests requested_seats refused', denied(patchSeats), 'status=' + patchSeats.status);
    const delReq = await rest(tok, 'DELETE', 'carpool_ride_requests?id=eq.' + ctx.reqId);
    record('[' + label + '] DELETE carpool_ride_requests refused', denied(delReq), 'status=' + delReq.status);
    // carpool_offers
    const insOffer = await rest(tok, 'POST', 'carpool_offers', {
      organization_id: org, trip_request_id: ctx.tripId, host_id: U.host, status: 'active', seats_offered: 99, seats_available: 99, policy_version: 1,
    });
    record('[' + label + '] INSERT carpool_offers (99 seats) refused', denied(insOffer), 'status=' + insOffer.status);
    const patchOffer = await rest(tok, 'PATCH', 'carpool_offers?id=eq.' + ctx.offerId, { seats_available: 99, seats_offered: 99 });
    record('[' + label + '] PATCH carpool_offers seats 99/99 refused', denied(patchOffer), 'status=' + patchOffer.status + ' ' + msg(patchOffer));
    const delOffer = await rest(tok, 'DELETE', 'carpool_offers?id=eq.' + ctx.offerId);
    record('[' + label + '] DELETE carpool_offers refused', denied(delOffer), 'status=' + delOffer.status);
    // append-only / server-only tables
    const insEv = await rest(tok, 'POST', 'carpool_events', { organization_id: org, event_type: 'RideAccepted', trip_request_id: ctx.tripId });
    record('[' + label + '] INSERT carpool_events (forged event) refused', denied(insEv), 'status=' + insEv.status);
    const insQuota = await rest(tok, 'POST', 'geo_provider_quota_counters', { organization_id: org, provider_call_kind: 'routes', day: '2030-01-01', call_count: 0 });
    record('[' + label + '] INSERT geo_provider_quota_counters refused', denied(insQuota), 'status=' + insQuota.status);
    const patchQuota = await rest(tok, 'PATCH', 'geo_provider_quota_counters?organization_id=eq.' + org, { call_count: 0 });
    record('[' + label + '] PATCH geo_provider_quota_counters refused', denied(patchQuota), 'status=' + patchQuota.status);
    const patchPolicy = await rest(tok, 'PATCH', 'carpool_policy_settings?organization_id=eq.' + org, { departure_window_minutes: 99999 });
    record('[' + label + '] PATCH carpool_policy_settings (versioned, insert-only) refused', denied(patchPolicy), 'status=' + patchPolicy.status);
    const delPolicy = await rest(tok, 'DELETE', 'carpool_policy_settings?organization_id=eq.' + org);
    record('[' + label + '] DELETE carpool_policy_settings refused', denied(delPolicy), 'status=' + delPolicy.status);
  }
  const after = await state();
  record('Ground truth unchanged after every attack (request PENDING/1 seat, offer 2/2, row counts same)',
    JSON.stringify(after) === JSON.stringify(before), { before, after });
  const ev = await sql("select count(*) c from carpool_events where organization_id='" + ctx.orgA + "' and event_type='RideAccepted'");
  const pol = await sql("select departure_window_minutes w, count(*) over () n from carpool_policy_settings where organization_id='" + ctx.orgA + "'");
  record('No forged event rows; policy row untouched', Number(ev[0].c) === 0 && pol.length === 1 && pol[0].w === 15, { events: ev[0].c, policy: pol[0] });

  // Tables where manager/employee writes are intentionally governed by RLS.
  console.log('--- Intentional write paths are unchanged ---');
  const polIns = await rest(ctx.tok.mgr, 'POST', 'carpool_policy_settings', { organization_id: ctx.orgA, policy_version: 2, departure_window_minutes: 20, return_window_minutes: 20, max_additional_distance_km: 5, max_additional_time_minutes: 10 });
  record('Manager can still INSERT a new carpool_policy_settings version (insert-only by design)', polIns.status === 201, 'status=' + polIns.status + ' ' + msg(polIns));
  const polInsEmp = await rest(ctx.tok.rider, 'POST', 'carpool_policy_settings', { organization_id: ctx.orgA, policy_version: 3, departure_window_minutes: 20, return_window_minutes: 20, max_additional_distance_km: 5, max_additional_time_minutes: 10 });
  record('Employee cannot INSERT a carpool_policy_settings version (RLS)', denied(polInsEmp) || polInsEmp.status === 401 || polInsEmp.status === 403, 'status=' + polInsEmp.status);
  const cmp = { organization_id: ctx.orgA, name: 'C4TEST point', address_label: 'Rua X', latitude: -23.5, longitude: -46.6 };
  const cmpMgr = await rest(ctx.tok.mgr, 'POST', 'corporate_mobility_points', cmp);
  record('Manager can still INSERT corporate_mobility_points (admin UI path, by design)', cmpMgr.status === 201, 'status=' + cmpMgr.status);
  const cmpEmp = await rest(ctx.tok.rider, 'POST', 'corporate_mobility_points', cmp);
  record('Employee cannot INSERT corporate_mobility_points (RLS)', denied(cmpEmp), 'status=' + cmpEmp.status);
  const cmpAnon = await rest(null, 'POST', 'corporate_mobility_points', cmp);
  record('Anon cannot INSERT corporate_mobility_points', denied(cmpAnon), 'status=' + cmpAnon.status);
  const selReq = await rest(ctx.tok.rider, 'GET', 'carpool_ride_requests?id=eq.' + ctx.reqId + '&select=id,status');
  record('SELECT (RLS-scoped) on carpool_ride_requests still works for an org member', selReq.status === 200 && selReq.body.length === 1, 'status=' + selReq.status);
  const selOther = await rest(ctx.tok.other, 'GET', 'carpool_ride_requests?id=eq.' + ctx.reqId + '&select=id');
  record('SELECT from another org returns nothing (tenant isolation intact)', selOther.status === 200 && selOther.body.length === 0, 'status=' + selOther.status);
  const selAnon = await rest(null, 'GET', 'carpool_offers?select=id');
  record('Anon cannot SELECT carpool_offers', denied(selAnon), 'status=' + selAnon.status);

  // RPC lifecycle after the attacks
  const acc = await rpc(actors.host, 'accept_carpool_ride_request', { p_request_id: ctx.reqId });
  const afterAcc = await state();
  const part = await sql("select count(*) c from trip_participants where trip_request_id='" + ctx.tripId + "' and passenger_id='" + U.rider + "'");
  const evAcc = await sql("select count(*) c from carpool_events where carpool_ride_request_id='" + ctx.reqId + "' and event_type='RideAccepted'");
  record('accept_carpool_ride_request (host RPC) still works: ACCEPTED, seat 2->1, participant + event written',
    acc.ok && afterAcc.req.status === 'ACCEPTED' && afterAcc.offer.seats_available === 1 && Number(part[0].c) === 1 && Number(evAcc[0].c) === 1, { afterAcc, participants: part[0].c, events: evAcc[0].c });
  const canc = await rpc(actors.rider, 'cancel_carpool_ride_request', { p_request_id: ctx.reqId });
  const afterCanc = await state();
  record('cancel_carpool_ride_request (rider RPC) still works: CANCELLED, seat released', canc.ok && afterCanc.req.status === 'CANCELLED' && afterCanc.offer.seats_available === 2, afterCanc);
  const dis = await rpc(actors.host, 'disable_carpool_offer', { p_offer_id: ctx.offerId });
  record('disable_carpool_offer (host RPC) still works', dis.ok, msg(dis));
}

main()
  .catch((e) => record('FATAL', false, String(e && e.stack ? e.stack : e)))
  .finally(async () => {
    await cleanup();
    console.log('\n=== Summary ===');
    const failed = results.filter((r) => !r.pass);
    for (const r of failed) console.log('FAIL - ' + r.name);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed.\n');
    process.exitCode = failed.length ? 1 : 0;
  });
