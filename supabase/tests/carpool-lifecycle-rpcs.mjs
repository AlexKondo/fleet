#!/usr/bin/env node
// Phase C4 live integration test: carpool lifecycle RPCs (0057/0058/0059).
//
// Runs against the LIVE Supabase project (same target the migrations were applied to). Every
// row it creates is disposable: two throwaway organizations (A = the tenant under test, B =
// a foreign tenant for cross-org checks), throwaway auth users, vehicle, trip and reservation.
// Everything is deleted in `finally`, and a final query proves nothing is left behind.
//
// It exercises the REAL RPCs over PostgREST with REAL user JWTs (password grant), so RLS /
// security-definer / grants behave exactly as in production. Concurrency tests fire parallel
// HTTP calls (separate DB connections), they are not simulated.
//
// Usage:   node supabase/tests/carpool-lifecycle-rpcs.mjs
// Env:     SUPABASE_TOKEN (Management API, required; read from repo-root .env if unset),
//          SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (read from .env if unset)

import './lib/net-retry.mjs';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT_ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
function envFile(name) {
  try {
    const m = readFileSync(ROOT_ENV, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}
const SUPABASE_TOKEN = process.env.SUPABASE_TOKEN || envFile('SUPABASE_TOKEN');
const SUPABASE_URL = process.env.SUPABASE_URL || envFile('NEXT_PUBLIC_SUPABASE_URL');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || envFile('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envFile('SUPABASE_SERVICE_ROLE_KEY');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'rhbiwkxilelitugbwind';
if (!SUPABASE_TOKEN || !SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing SUPABASE_TOKEN / SUPABASE_URL / anon / service keys (see repo-root .env)');
  process.exit(1);
}

const results = [];
function record(name, pass, details) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  if (details !== undefined) console.log(`    ${typeof details === 'string' ? details : JSON.stringify(details)}`);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (res.status >= 400) throw new Error(`SQL failed (${res.status}): ${text}\n${query}`);
  return body;
}

async function adminCreateUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await res.json();
  if (!res.ok || !json.id) throw new Error(`create user failed: ${res.status} ${JSON.stringify(json)}`);
  return json.id;
}
async function adminDeleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(`sign-in failed ${email}: ${JSON.stringify(json)}`);
  return json.access_token;
}

// rpc(token, name, args): token null => anon key as bearer (no user session)
async function rpc(token, fn, args = {}, key = ANON_KEY) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body, ok: res.status < 300 };
}
const msg = (r) => (r.body && (r.body.message || r.body.hint || JSON.stringify(r.body))) || String(r.status);
const failsWith = (r, code) => !r.ok && typeof msg(r) === 'string' && msg(r).includes(code);

const ctx = {};
const T = Date.now().toString(36);
const PASSWORD = 'C4test!' + randomUUID().slice(0, 8);
const emailOf = (n) => `c4test-${n}-${T}@fleet-test.invalid`;
const farFuture = new Date(Date.now() + 10 * 86400000);
const HOST_DEPARTURE = farFuture.toISOString();
const loc = (lat, lng) => ({ coordinates: { lat, lng }, source: 'manual_lat_lng' });

// Request creation is service-role only (0060): the script plays the role of apps/web's
// server action, passing the authenticated rider's id explicitly.
function riderIdOfToken(token) {
  const name = Object.entries(ctx.tok).find(([, t]) => t === token)?.[0];
  if (!name) throw new Error('unknown rider token');
  return ctx.users[name];
}
async function createRequest(token, offerId, { seats = 1, key = randomUUID(), dist = 1.5, time = 3, dep = HOST_DEPARTURE } = {}) {
  return rpc(SERVICE_KEY, 'create_carpool_ride_request_as_rider', {
    p_rider_id: riderIdOfToken(token),
    p_offer_id: offerId,
    p_seats: seats,
    p_pickup: loc(-23.55, -46.63),
    p_dropoff: loc(-23.56, -46.64),
    p_requested_departure_at: dep,
    p_client_request_id: key,
    p_match_additional_distance_km: dist,
    p_match_additional_time_min: time,
  }, SERVICE_KEY);
}

async function offerRow(id) {
  return (await sql(`select status, seats_offered, seats_available from carpool_offers where id='${id}'`))[0];
}
async function requestRow(id) {
  return (await sql(`select status, responded_by, responded_at, requested_seats, policy_version, match_additional_distance_km, match_additional_time_min from carpool_ride_requests where id='${id}'`))[0];
}
async function participantCount(tripId, riderId) {
  const q = riderId ? ` and passenger_id='${riderId}'` : '';
  return Number((await sql(`select count(*) c from trip_participants where trip_request_id='${tripId}'${q}`))[0].c);
}
async function notifs(userId, title) {
  return sql(`select title, body, entity_type, entity_id, read_at from notifications where user_id='${userId}' and title='${title}' order by created_at desc`);
}

async function clearNotifs() {
  await sql(`delete from notifications where organization_id='${ctx.orgA}'`);
}

async function freshOffer(seats) {
  // Disable + re-enable resets the offer cleanly between scenarios.
  const o = await sql(`select id, status from carpool_offers where trip_request_id='${ctx.tripId}' order by created_at desc limit 1`);
  if (o[0] && o[0].status === 'active') {
    const d = await rpc(ctx.hostTok, 'disable_carpool_offer', { p_offer_id: o[0].id });
    if (!d.ok) throw new Error('freshOffer disable failed ' + msg(d));
  }
  const e = await rpc(ctx.hostTok, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: seats });
  if (!e.ok) throw new Error('freshOffer enable failed ' + msg(e));
  return e.body;
}

async function setup() {
  const [orgA] = await sql(`insert into organizations (name) values ('C4TEST-ORG-A-${T}') returning id`);
  const [orgB] = await sql(`insert into organizations (name) values ('C4TEST-ORG-B-${T}') returning id`);
  ctx.orgA = orgA.id; ctx.orgB = orgB.id;
  const defs = [
    ['host', ctx.orgA, 'employee'], ['rider1', ctx.orgA, 'employee'], ['rider2', ctx.orgA, 'employee'],
    ['rider3', ctx.orgA, 'employee'], ['outsider', ctx.orgA, 'employee'], ['mgr', ctx.orgA, 'fleet_manager'],
    ['riderB', ctx.orgB, 'employee'],
  ];
  ctx.users = {};
  for (const [name, org, role] of defs) {
    const id = await adminCreateUser(emailOf(name), PASSWORD);
    ctx.users[name] = id;
    await sql(`insert into profiles (id, organization_id, full_name, role) values ('${id}', '${org}', 'C4TEST ${name}', '${role}')`);
  }
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
             values ('${ctx.orgA}', 1, 15, 15, 5, 10, 30)`);
  const [cat] = await sql(`insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('${ctx.orgA}', 'C4TEST cat', 5, 'ICE') returning id`);
  const [veh] = await sql(`insert into vehicles (organization_id, plate, category_id, status) values ('${ctx.orgA}', 'C4T${T.slice(-4).toUpperCase()}', '${cat.id}', 'reserved') returning id`);
  const [trip] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification)
     values ('${ctx.orgA}', '${ctx.users.host}', '${HOST_DEPARTURE}', '${new Date(farFuture.getTime() + 4 * 3600000).toISOString()}', 'Sede C4TEST', 'Destino C4TEST', 30, 1, 'C4TEST disposable') returning id`);
  ctx.tripId = trip.id;
  const [res] = await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at)
     values ('${ctx.orgA}', '${veh.id}', '${ctx.tripId}', 'confirmed', '${HOST_DEPARTURE}', '${new Date(farFuture.getTime() + 4 * 3600000).toISOString()}') returning id`);
  ctx.reservationId = res.id;
  ctx.tok = {};
  for (const [name] of defs) ctx.tok[name] = await signIn(emailOf(name), PASSWORD);
  ctx.hostTok = ctx.tok.host;
  await new Promise((r) => setTimeout(r, 1500)); // JWT clock-skew settle
}

async function cleanup() {
  const out = [];
  try {
    await sql('alter table carpool_events drop constraint if exists c4test_block');
    for (const org of [ctx.orgA, ctx.orgB].filter(Boolean)) {
      await sql(`delete from reservations where organization_id='${org}'`);
      await sql(`delete from organizations where id='${org}'`); // cascades everything else
    }
    for (const id of Object.values(ctx.users ?? {})) await adminDeleteUser(id);
    const left = await sql(`select
      (select count(*) from organizations where name like 'C4TEST-ORG-%-${T}') orgs,
      (select count(*) from profiles where full_name like 'C4TEST %' and id in (${Object.values(ctx.users ?? {}).map((u) => `'${u}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"})) profiles,
      (select count(*) from carpool_offers where organization_id in ('${ctx.orgA}','${ctx.orgB}')) offers,
      (select count(*) from carpool_ride_requests where organization_id in ('${ctx.orgA}','${ctx.orgB}')) requests,
      (select count(*) from carpool_events where organization_id in ('${ctx.orgA}','${ctx.orgB}')) events,
      (select count(*) from notifications where organization_id in ('${ctx.orgA}','${ctx.orgB}')) notifications,
      (select count(*) from audit_log where organization_id in ('${ctx.orgA}','${ctx.orgB}')) audit`);
    out.push(left[0]);
    const allZero = Object.values(left[0]).every((v) => Number(v) === 0);
    record('Cleanup: no disposable rows left in the live DB', allZero, left[0]);
  } catch (e) {
    record('Cleanup', false, String(e));
  }
}

async function main() {
  console.log(`\n=== Carpool lifecycle RPCs (live) — ${new Date().toISOString()} ===\n`);
  await setup();
  const { host, rider1, rider2, rider3, outsider, mgr, riderB } = ctx.tok;
  const U = ctx.users;

  // ---------------------------------------------------------------- RBAC: offer management
  console.log('--- RBAC: enabling / managing offers ---');
  const anonEnable = await rpc(null, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 1 });
  record('Anon (no session) cannot call enable_carpool_offer', !anonEnable.ok && [401, 403].includes(anonEnable.status), `status=${anonEnable.status} ${msg(anonEnable)}`);
  const otherEnable = await rpc(outsider, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 1 });
  record('Non-host employee cannot enable an offer on someone else\'s trip', failsWith(otherEnable, 'CARPOOL_NOT_AUTHORIZED'), msg(otherEnable));
  const crossEnable = await rpc(riderB, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 1 });
  record('Cross-org user cannot enable (trip invisible: TRIP_NOT_FOUND)', failsWith(crossEnable, 'CARPOOL_TRIP_NOT_FOUND'), msg(crossEnable));
  const forgedEnable = await rpc(host, 'enable_carpool_offer', { p_trip_request_id: randomUUID(), p_seats: 1 });
  record('Forged trip id -> TRIP_NOT_FOUND', failsWith(forgedEnable, 'CARPOOL_TRIP_NOT_FOUND'), msg(forgedEnable));
  const zeroSeats = await rpc(host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 0 });
  record('enable with 0 seats rejected (CARPOOL_INVALID_SEATS)', failsWith(zeroSeats, 'CARPOOL_INVALID_SEATS'), msg(zeroSeats));
  const negSeats = await rpc(host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: -2 });
  record('enable with negative seats rejected', failsWith(negSeats, 'CARPOOL_INVALID_SEATS'), msg(negSeats));
  const overCap = await rpc(host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 5 });
  record('enable with seats > vehicle free capacity (cap 5 - host party 1 = 4) rejected', failsWith(overCap, 'CARPOOL_SEATS_EXCEED_CAPACITY'), msg(overCap));

  const enable = await rpc(host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 1 });
  ctx.offerId = enable.body;
  record('Host enables a 1-seat offer', enable.ok && typeof enable.body === 'string', msg(enable));
  const dupEnable = await rpc(host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 1 });
  record('Enabling an already-active offer rejected (ALREADY_ACTIVE)', failsWith(dupEnable, 'CARPOOL_OFFER_ALREADY_ACTIVE'), msg(dupEnable));
  const evEnabled = await sql(`select count(*) c from carpool_events where carpool_offer_id='${ctx.offerId}' and event_type='CarpoolOfferEnabled'`);
  record('CarpoolOfferEnabled event emitted (and no notification for it)', Number(evEnabled[0].c) === 1);
  const otherUpdate = await rpc(outsider, 'update_carpool_offer', { p_offer_id: ctx.offerId, p_seats: 2 });
  record('Non-host cannot update someone else\'s offer', failsWith(otherUpdate, 'CARPOOL_NOT_AUTHORIZED'), msg(otherUpdate));
  const otherDisable = await rpc(rider1, 'disable_carpool_offer', { p_offer_id: ctx.offerId });
  record('Non-host (rider) cannot disable someone else\'s offer', failsWith(otherDisable, 'CARPOOL_NOT_AUTHORIZED'), msg(otherDisable));
  const crossDisable = await rpc(riderB, 'disable_carpool_offer', { p_offer_id: ctx.offerId });
  record('Cross-org user cannot disable (OFFER_NOT_FOUND)', failsWith(crossDisable, 'CARPOOL_OFFER_NOT_FOUND'), msg(crossDisable));
  const offerStill = await offerRow(ctx.offerId);
  record('Offer unchanged after all forbidden attempts', offerStill.status === 'active' && offerStill.seats_offered === 1 && offerStill.seats_available === 1, offerStill);

  // ---------------------------------------------------------------- server-only create
  console.log('--- Server-only create (0060) ---');
  const forged = {
    p_rider_id: U.rider1, p_offer_id: ctx.offerId, p_seats: 1, p_pickup: loc(0, 0), p_dropoff: loc(0, 0),
    p_requested_departure_at: HOST_DEPARTURE, p_client_request_id: randomUUID(),
    p_match_additional_distance_km: 0, p_match_additional_time_min: 0,
  };
  const directAuth = await rpc(rider1, 'create_carpool_ride_request_as_rider', forged);
  record('Authenticated user calling create_carpool_ride_request_as_rider with forged 0/0 numbers is DENIED (403)', directAuth.status === 403, 'status=' + directAuth.status + ' ' + msg(directAuth));
  const { p_rider_id: _omit, ...oldArgs } = forged;
  const directOld = await rpc(rider1, 'create_carpool_ride_request', oldArgs);
  record('The old user-callable create_carpool_ride_request no longer exists (404)', directOld.status === 404, 'status=' + directOld.status + ' ' + msg(directOld));
  const directAnon = await rpc(null, 'create_carpool_ride_request_as_rider', forged);
  record('Anon calling the new create function is denied (401)', directAnon.status === 401, 'status=' + directAnon.status);
  const forgedRows = await sql("select count(*) c from carpool_ride_requests where client_request_id='" + forged.p_client_request_id + "'");
  record('No row was created by any forged direct call', Number(forgedRows[0].c) === 0);
  const wrongOrg = await rpc(SERVICE_KEY, 'create_carpool_ride_request_as_rider', { ...forged, p_rider_id: U.riderB, p_client_request_id: randomUUID(), p_match_additional_distance_km: 1, p_match_additional_time_min: 1 }, SERVICE_KEY);
  record('Service function verifies rider/offer org match (org-B rider on org-A offer -> OFFER_NOT_FOUND)', failsWith(wrongOrg, 'CARPOOL_OFFER_NOT_FOUND'), msg(wrongOrg));
  const ghostRider = await rpc(SERVICE_KEY, 'create_carpool_ride_request_as_rider', { ...forged, p_rider_id: randomUUID(), p_client_request_id: randomUUID(), p_match_additional_distance_km: 1, p_match_additional_time_min: 1 }, SERVICE_KEY);
  record('Unknown rider id rejected (NOT_AUTHENTICATED)', failsWith(ghostRider, 'CARPOOL_NOT_AUTHENTICATED'), msg(ghostRider));

  // ---------------------------------------------------------------- input validation
  console.log('--- Input validation on create_carpool_ride_request ---');
  const v0 = await createRequest(rider1, ctx.offerId, { seats: 0 });
  record('requested seats 0 rejected', failsWith(v0, 'CARPOOL_INVALID_SEATS'), msg(v0));
  const vNeg = await createRequest(rider1, ctx.offerId, { seats: -1 });
  record('requested seats -1 rejected', failsWith(vNeg, 'CARPOOL_INVALID_SEATS'), msg(vNeg));
  const vFrac = await createRequest(rider1, ctx.offerId, { seats: 0.5 });
  record('requested seats 0.5 rejected (not an integer)', !vFrac.ok, msg(vFrac));
  const vLoc = await rpc(SERVICE_KEY, 'create_carpool_ride_request_as_rider', {
    p_rider_id: U.rider1, p_offer_id: ctx.offerId, p_seats: 1, p_pickup: loc(999, 0), p_dropoff: loc(0, 0),
    p_requested_departure_at: HOST_DEPARTURE, p_client_request_id: randomUUID(),
    p_match_additional_distance_km: 1, p_match_additional_time_min: 1,
  }, SERVICE_KEY);
  record('pickup latitude 999 rejected (CARPOOL_INVALID_LOCATION)', failsWith(vLoc, 'CARPOOL_INVALID_LOCATION'), msg(vLoc));
  const vNegDetour = await createRequest(rider1, ctx.offerId, { dist: -1 });
  record('negative detour numbers rejected', failsWith(vNegDetour, 'CARPOOL_ROUTE_EVALUATION_REQUIRED'), msg(vNegDetour));
  const vBigDetour = await createRequest(rider1, ctx.offerId, { dist: 50 });
  record('detour above policy (5km) rejected by DB defense in depth', failsWith(vBigDetour, 'CARPOOL_DETOUR_EXCEEDS_POLICY'), msg(vBigDetour));
  const vWindow = await createRequest(rider1, ctx.offerId, { dep: new Date(farFuture.getTime() + 3600000).toISOString() });
  record('departure outside the policy window rejected', failsWith(vWindow, 'CARPOOL_OUTSIDE_DEPARTURE_WINDOW'), msg(vWindow));
  const vOwn = await createRequest(host, ctx.offerId);
  record('host cannot request a ride on their own offer', failsWith(vOwn, 'CARPOOL_CANNOT_REQUEST_OWN_OFFER'), msg(vOwn));
  const vCross = await createRequest(riderB, ctx.offerId);
  record('cross-org rider cannot request (OFFER_NOT_FOUND)', failsWith(vCross, 'CARPOOL_OFFER_NOT_FOUND'), msg(vCross));
  const vNoKey = await rpc(SERVICE_KEY, 'create_carpool_ride_request_as_rider', {
    p_rider_id: U.rider1, p_offer_id: ctx.offerId, p_seats: 1, p_pickup: null, p_dropoff: null, p_requested_departure_at: HOST_DEPARTURE,
    p_client_request_id: null, p_match_additional_distance_km: 1, p_match_additional_time_min: 1,
  }, SERVICE_KEY);
  record('missing client_request_id rejected', failsWith(vNoKey, 'CARPOOL_CLIENT_REQUEST_ID_REQUIRED'), msg(vNoKey));
  const none = await sql(`select count(*) c from carpool_ride_requests where carpool_offer_id='${ctx.offerId}'`);
  record('None of the invalid requests created a row', Number(none[0].c) === 0, none[0]);

  // ---------------------------------------------------------------- idempotency
  console.log('--- Idempotency: same client_request_id ---');
  const key = randomUUID();
  const [d1, d2, d3] = await Promise.all([
    createRequest(rider1, ctx.offerId, { key }),
    createRequest(rider1, ctx.offerId, { key }),
    createRequest(rider1, ctx.offerId, { key }),
  ]);
  const rows = await sql(`select id from carpool_ride_requests where client_request_id='${key}'`);
  record('Triple parallel double-tap with the SAME key -> exactly ONE row', rows.length === 1, { rows: rows.length, statuses: [d1.status, d2.status, d3.status] });
  record('All three calls succeeded and returned the same request id', d1.ok && d2.ok && d3.ok && d1.body === d2.body && d2.body === d3.body, [d1.body, d2.body, d3.body]);
  const d4 = await createRequest(rider1, ctx.offerId, { key });
  const keyCount = Number((await sql(`select count(*) c from carpool_ride_requests where client_request_id='${key}'`))[0].c);
  record('A later sequential retry with the same key returns the same id, still one row', d4.ok && d4.body === d1.body && keyCount === 1, { id: d4.body, keyCount });
  const evReq = await sql(`select count(*) c from carpool_events where carpool_ride_request_id='${d1.body}' and event_type='RideRequested'`);
  record('Exactly one RideRequested event for the idempotent request', Number(evReq[0].c) === 1, evReq[0]);
  const auditReq = await sql(`select count(*) c, max(after->>'policy_version') pv, max(after->>'match_additional_distance_km') dist from audit_log where entity_id='${d1.body}' and action='carpool_ride_requested'`);
  record('Audit row on creation carries policy_version and route-evaluation numbers', Number(auditReq[0].c) === 1 && auditReq[0].pv === '1' && Number(auditReq[0].dist) === 1.5, auditReq[0]);
  const hijack = await createRequest(rider2, ctx.offerId, { key });
  record('Another rider re-using the key is rejected (no hijack / no leak)', failsWith(hijack, 'CARPOOL_CLIENT_REQUEST_ID_CONFLICT'), msg(hijack));
  const second = await createRequest(rider1, ctx.offerId, { key: randomUUID() });
  record('Same rider, NEW key, while a live request exists -> blocked by one-live-request index', !second.ok, msg(second));
  ctx.req1 = d1.body;
  const hostN = await notifs(U.host, 'Pedido de carona na sua viagem');
  record('Host got exactly one "new ride request" notification with entity link to the reservation',
    hostN.length === 1 && hostN[0].entity_type === 'reservation' && hostN[0].entity_id === ctx.reservationId, hostN);

  // ---------------------------------------------------------------- RBAC on decisions
  console.log('--- RBAC: accept / reject / cancel ---');
  const riderAccept = await rpc(rider1, 'accept_carpool_ride_request', { p_request_id: ctx.req1 });
  record('Rider cannot accept their own request', failsWith(riderAccept, 'CARPOOL_NOT_AUTHORIZED'), msg(riderAccept));
  const riderReject = await rpc(rider1, 'reject_carpool_ride_request', { p_request_id: ctx.req1, p_reason: null });
  record('Rider cannot reject their own request', failsWith(riderReject, 'CARPOOL_NOT_AUTHORIZED'), msg(riderReject));
  const outAccept = await rpc(outsider, 'accept_carpool_ride_request', { p_request_id: ctx.req1 });
  record('Unrelated employee cannot accept', failsWith(outAccept, 'CARPOOL_NOT_AUTHORIZED'), msg(outAccept));
  const crossAccept = await rpc(riderB, 'accept_carpool_ride_request', { p_request_id: ctx.req1 });
  record('Cross-org user cannot accept (REQUEST_NOT_FOUND)', failsWith(crossAccept, 'CARPOOL_REQUEST_NOT_FOUND'), msg(crossAccept));
  const forgedAccept = await rpc(host, 'accept_carpool_ride_request', { p_request_id: randomUUID() });
  record('Forged request id -> REQUEST_NOT_FOUND', failsWith(forgedAccept, 'CARPOOL_REQUEST_NOT_FOUND'), msg(forgedAccept));
  const otherCancel = await rpc(rider2, 'cancel_carpool_ride_request', { p_request_id: ctx.req1 });
  record('Another rider cannot cancel someone else\'s request', failsWith(otherCancel, 'CARPOOL_NOT_AUTHORIZED'), msg(otherCancel));
  const crossCancel = await rpc(riderB, 'cancel_carpool_ride_request', { p_request_id: ctx.req1 });
  record('Cross-org user cannot cancel', failsWith(crossCancel, 'CARPOOL_REQUEST_NOT_FOUND'), msg(crossCancel));
  const anonAccept = await rpc(null, 'accept_carpool_ride_request', { p_request_id: ctx.req1 });
  record('Anon cannot call accept', !anonAccept.ok && [401, 403].includes(anonAccept.status), `status=${anonAccept.status}`);
  const stillPending = await requestRow(ctx.req1);
  record('Request still PENDING after all forbidden attempts', stillPending.status === 'PENDING', stillPending);

  // ---------------------------------------------------------------- reject persists
  console.log('--- Reject persists status REJECTED (never deletes) ---');
  const rej = await rpc(host, 'reject_carpool_ride_request', { p_request_id: ctx.req1, p_reason: 'sem espaco' });
  const rejRow = await requestRow(ctx.req1);
  record('Host rejects: row SURVIVES with status REJECTED, responded_by = host', rej.ok && rejRow && rejRow.status === 'REJECTED' && rejRow.responded_by === U.host && rejRow.responded_at, rejRow);
  const rejAudit = await sql(`select count(*) c, max(after->>'policy_version') pv from audit_log where entity_id='${ctx.req1}' and action='carpool_ride_rejected'`);
  record('Audit row written for the rejection (with policy_version)', Number(rejAudit[0].c) === 1 && rejAudit[0].pv === '1', rejAudit[0]);
  const rejN = await notifs(U.rider1, 'Carona recusada');
  record('Rider notified of rejection, linked to the reservation', rejN.length === 1 && rejN[0].entity_type === 'reservation' && rejN[0].entity_id === ctx.reservationId, rejN);
  const rej2 = await rpc(host, 'reject_carpool_ride_request', { p_request_id: ctx.req1, p_reason: null });
  record('Rejecting again rejected (NOT_PENDING)', failsWith(rej2, 'CARPOOL_REQUEST_NOT_PENDING'), msg(rej2));
  const accRej = await rpc(host, 'accept_carpool_ride_request', { p_request_id: ctx.req1 });
  record('Accepting a REJECTED request rejected (NOT_PENDING)', failsWith(accRej, 'CARPOOL_REQUEST_NOT_PENDING'), msg(accRej));
  const offerAfterRej = await offerRow(ctx.offerId);
  record('Rejecting never consumed a seat', offerAfterRej.seats_available === 1, offerAfterRej);

  // ---------------------------------------------------------------- last-seat race
  console.log('--- CONCURRENCY: riders race for the LAST seat via accept ---');
  for (let round = 1; round <= 3; round++) {
    const racers = round < 3 ? [['rider1', rider1], ['rider2', rider2]] : [['rider1', rider1], ['rider2', rider2], ['rider3', rider3]];
    const created = await Promise.all(racers.map(([, tok]) => createRequest(tok, ctx.offerId)));
    if (!created.every((c) => c.ok)) throw new Error(`race setup failed: ${created.map(msg)}`);
    const ids = created.map((c) => c.body);
    const accepts = await Promise.all(ids.map((id) => rpc(host, 'accept_carpool_ride_request', { p_request_id: id })));
    const winners = accepts.filter((a) => a.ok);
    const losers = accepts.filter((a) => !a.ok);
    const offer = await offerRow(ctx.offerId);
    const accepted = Number((await sql(`select count(*) c from carpool_ride_requests where carpool_offer_id='${ctx.offerId}' and status='ACCEPTED'`))[0].c);
    const parts = await participantCount(ctx.tripId);
    record(`Round ${round} (${racers.length} riders, 1 seat): exactly ONE accept succeeded`, winners.length === 1 && losers.length === racers.length - 1 && losers.every((l) => failsWith(l, 'CARPOOL_NO_SEATS_AVAILABLE')),
      { winners: winners.length, losers: losers.map(msg) });
    record(`Round ${round}: seats_available is 0 (never negative), exactly 1 ACCEPTED row, exactly 1 participant`, offer.seats_available === 0 && accepted === 1 && parts === 1, { offer, accepted, parts });
    // reset for next round: winner cancels (seat released), losers rejected (terminal)
    const winnerIdx = accepts.findIndex((a) => a.ok);
    const cancel = await rpc(racers[winnerIdx][1], 'cancel_carpool_ride_request', { p_request_id: ids[winnerIdx] });
    if (!cancel.ok) throw new Error('round reset cancel failed ' + msg(cancel));
    for (let i = 0; i < ids.length; i++) if (i !== winnerIdx) await rpc(host, 'reject_carpool_ride_request', { p_request_id: ids[i], p_reason: 'race loser' });
    const afterReset = await offerRow(ctx.offerId);
    record(`Round ${round}: cancelling the winner released the seat (seats_available back to 1) and removed the participant`, afterReset.seats_available === 1 && (await participantCount(ctx.tripId)) === 0, afterReset);
  }

  // ---------------------------------------------------------------- double accept
  console.log('--- CONCURRENCY: simultaneous double accept of the SAME request ---');
  const upd = await rpc(host, 'update_carpool_offer', { p_offer_id: ctx.offerId, p_seats: 3 });
  record('Host raises the offer to 3 seats via update_carpool_offer', upd.ok && (await offerRow(ctx.offerId)).seats_available === 3, msg(upd));
  await clearNotifs();
  const dReq = await createRequest(rider1, ctx.offerId, { seats: 1 });
  const dbl = await Promise.all([1, 2, 3, 4].map(() => rpc(host, 'accept_carpool_ride_request', { p_request_id: dReq.body })));
  const dblOk = dbl.filter((r) => r.ok).length;
  const offerDbl = await offerRow(ctx.offerId);
  const auditAcc = await sql(`select count(*) c from audit_log where entity_id='${dReq.body}' and action='carpool_ride_accepted'`);
  const evAcc = await sql(`select count(*) c from carpool_events where carpool_ride_request_id='${dReq.body}' and event_type='RideAccepted'`);
  record('4 simultaneous accepts of one request: exactly ONE succeeds, the rest NOT_PENDING', dblOk === 1 && dbl.filter((r) => !r.ok).every((r) => failsWith(r, 'CARPOOL_REQUEST_NOT_PENDING')), dbl.map((r) => (r.ok ? 'ok' : msg(r))));
  record('Seat decremented exactly once (3 -> 2), one participant, one audit row, one event',
    offerDbl.seats_available === 2 && (await participantCount(ctx.tripId, U.rider1)) === 1 && Number(auditAcc[0].c) === 1 && Number(evAcc[0].c) === 1, { offerDbl, audit: auditAcc[0].c, events: evAcc[0].c });
  const accAudit = await sql(`select after from audit_log where entity_id='${dReq.body}' and action='carpool_ride_accepted'`);
  record('Accept audit includes policy_version + route-evaluation numbers', accAudit[0].after.policy_version === 1 && Number(accAudit[0].after.match_additional_time_min) === 3, accAudit[0].after);
  const accN = await notifs(U.rider1, 'Carona aceita');
  record('Rider notified of acceptance, linked to the reservation', accN.length === 1 && accN[0].entity_type === 'reservation' && accN[0].entity_id === ctx.reservationId, accN);
  const reduce = await rpc(host, 'update_carpool_offer', { p_offer_id: ctx.offerId, p_seats: 0 });
  record('update to 0 seats rejected', failsWith(reduce, 'CARPOOL_INVALID_SEATS'), msg(reduce));
  const r2req = await createRequest(rider2, ctx.offerId, { seats: 2 });
  await rpc(host, 'accept_carpool_ride_request', { p_request_id: r2req.body });
  const reduce2 = await rpc(host, 'update_carpool_offer', { p_offer_id: ctx.offerId, p_seats: 2 });
  record('Reducing seats below the seats already taken (3 taken -> 2 offered) rejected', failsWith(reduce2, 'CARPOOL_CANNOT_REDUCE_BELOW_SEATS_TAKEN'), msg(reduce2));
  const offerFull = await offerRow(ctx.offerId);
  record('Offer now full (3 taken, 0 available)', offerFull.seats_available === 0, offerFull);
  const overbook = await createRequest(rider3, ctx.offerId, { seats: 1 });
  record('A request against a full offer is rejected (NO_SEATS_AVAILABLE)', failsWith(overbook, 'CARPOOL_NO_SEATS_AVAILABLE'), msg(overbook));

  // ---------------------------------------------------------------- cancel
  console.log('--- Rider cancels an ACCEPTED ride ---');
  await clearNotifs();
  const canc = await rpc(rider2, 'cancel_carpool_ride_request', { p_request_id: r2req.body });
  const cRow = await requestRow(r2req.body);
  record('Rider cancels own ACCEPTED request: status CANCELLED, 2 seats released, participant removed',
    canc.ok && cRow.status === 'CANCELLED' && (await offerRow(ctx.offerId)).seats_available === 2 && (await participantCount(ctx.tripId, U.rider2)) === 0, cRow);
  const cN = await notifs(U.host, 'Carona cancelada');
  record('Host notified that an accepted rider cancelled (linked to reservation)', cN.length === 1 && cN[0].entity_id === ctx.reservationId, cN);
  const canc2 = await rpc(rider2, 'cancel_carpool_ride_request', { p_request_id: r2req.body });
  record('Cancelling twice rejected', failsWith(canc2, 'CARPOOL_REQUEST_NOT_CANCELLABLE'), msg(canc2));

  // ---------------------------------------------------------------- revalidation
  console.log('--- REVALIDATION: host changes the trip ---');
  // State: rider1 ACCEPTED (1 seat). Add rider3 ACCEPTED too and rider2 PENDING.
  const r3req = await createRequest(rider3, ctx.offerId, { seats: 1 });
  await rpc(host, 'accept_carpool_ride_request', { p_request_id: r3req.body });
  const r2pend = await createRequest(rider2, ctx.offerId, { seats: 1 });
  const before = await offerRow(ctx.offerId);
  record('Pre-state: rider1+rider3 ACCEPTED, rider2 PENDING, 1 seat left', before.seats_available === 1, before);

  await clearNotifs();
  // (a) within-window time shift by a fleet manager (real actor, trigger path): survivors kept + notified
  const shift = await fetch(`${SUPABASE_URL}/rest/v1/trip_requests?id=eq.${ctx.tripId}`, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${mgr}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ departure_at: new Date(farFuture.getTime() + 10 * 60000).toISOString() }),
  });
  const stillAcc = await sql(`select count(*) c from carpool_ride_requests where carpool_offer_id='${ctx.offerId}' and status in ('ACCEPTED','PENDING')`);
  const evChanged = await sql(`select payload from carpool_events where carpool_offer_id='${ctx.offerId}' and event_type='HostTripChanged'`);
  record('+10min shift (inside the 15min window): manager PATCH ok, all live requests SURVIVE', shift.status < 300 && Number(stillAcc[0].c) === 3, { patchStatus: shift.status, live: stillAcc[0].c });
  record('HostTripChanged event emitted with the 3 surviving riders', evChanged.length === 1 && evChanged[0].payload.surviving_rider_ids.length === 3, evChanged[0]?.payload);
  const survN = await notifs(U.rider1, 'Viagem do motorista alterada');
  const hostChangedN = await notifs(U.host, 'Viagem do motorista alterada');
  record('Surviving rider notified of the material change; host notified because a manager (not the host) changed it',
    survN.length === 1 && survN[0].entity_id === ctx.reservationId && hostChangedN.length === 1, { rider: survN.length, host: hostChangedN.length });

  // (b) manual RPC: authz + detects a route change recorded in a snapshot
  const rivalReval = await rpc(rider1, 'revalidate_carpool_matches', { p_trip_request_id: ctx.tripId });
  record('Rider cannot call revalidate_carpool_matches', failsWith(rivalReval, 'CARPOOL_NOT_AUTHORIZED'), msg(rivalReval));
  const crossReval = await rpc(riderB, 'revalidate_carpool_matches', { p_trip_request_id: ctx.tripId });
  record('Cross-org user cannot call revalidate_carpool_matches', failsWith(crossReval, 'CARPOOL_TRIP_NOT_FOUND'), msg(crossReval));
  const noopReval = await rpc(host, 'revalidate_carpool_matches', { p_trip_request_id: ctx.tripId });
  record('Manual revalidation with nothing changed invalidates nothing', noopReval.ok && noopReval.body.invalidated === 0, noopReval.body);

  // (c) destination change (host's trip): ACCEPTED + PENDING requests invalidated with reason
  await clearNotifs();
  const evBefore = Number((await sql(`select count(*) c from carpool_events where carpool_offer_id='${ctx.offerId}' and event_type='RideInvalidated'`))[0].c);
  await sql(`update trip_requests set destination = 'Aeroporto C4TEST (destino alterado)' where id='${ctx.tripId}'`);
  const rows3 = await sql(`select id, status, rider_id from carpool_ride_requests where id in ('${dReq.body}','${r3req.body}','${r2pend.body}')`);
  const allInvalid = rows3.length === 3 && rows3.every((r) => r.status === 'INVALIDATED');
  record('Host changes DESTINATION: both ACCEPTED and the PENDING request become INVALIDATED', allInvalid, rows3.map((r) => r.status));
  const invEvents = await sql(`select payload->>'reason' reason, payload->>'previous_status' prev from carpool_events where carpool_offer_id='${ctx.offerId}' and event_type='RideInvalidated'`);
  record('RideInvalidated events carry the reason HOST_ROUTE_CHANGED (3 new events)', invEvents.length - evBefore === 3 && invEvents.filter((e) => e.reason === 'HOST_ROUTE_CHANGED').length === 3, invEvents);
  const offerAfterInv = await offerRow(ctx.offerId);
  record('Seats released: seats_available back to seats_offered (3) and all participants removed', offerAfterInv.seats_available === 3 && (await participantCount(ctx.tripId)) === 0, offerAfterInv);
  const invN = await notifs(U.rider1, 'Carona invalidada');
  record('Rider notified "match invalidated" (linked to reservation, route-change wording)', invN.length === 1 && invN[0].entity_id === ctx.reservationId && invN[0].body.includes('alterada'), invN);
  const invAudit = await sql(`select count(*) c from audit_log where action='carpool_ride_invalidated' and entity_id in ('${dReq.body}','${r3req.body}','${r2pend.body}') and after->>'reason'='HOST_ROUTE_CHANGED'`);
  record('Audit rows record the invalidation reason', Number(invAudit[0].c) === 3, invAudit[0]);
  const reAcc = await rpc(host, 'accept_carpool_ride_request', { p_request_id: dReq.body });
  record('An INVALIDATED request cannot be accepted afterwards', failsWith(reAcc, 'CARPOOL_REQUEST_NOT_PENDING'), msg(reAcc));
  // restore destination so the next scenarios have a clean trip
  await sql(`update trip_requests set destination = 'Destino C4TEST' where id='${ctx.tripId}'`);

  // (d) manual RPC detects a snapshot mismatch (route change recorded at request time)
  const m1 = await createRequest(rider1, ctx.offerId, { seats: 1 });
  await rpc(host, 'accept_carpool_ride_request', { p_request_id: m1.body });
  await sql(`update carpool_ride_requests set host_destination_snapshot = 'Outro lugar qualquer' where id='${m1.body}'`);
  const manual = await rpc(host, 'revalidate_carpool_matches', { p_trip_request_id: ctx.tripId });
  const m1row = await requestRow(m1.body);
  record('Manual revalidate_carpool_matches invalidates an ACCEPTED request whose route snapshot no longer matches', manual.ok && manual.body.invalidated === 1 && m1row.status === 'INVALIDATED', { manual: manual.body, status: m1row.status });

  // (e) host reservation cancelled -> trigger -> everything live invalidated, offer disabled
  await clearNotifs();
  const c1 = await createRequest(rider1, ctx.offerId, { seats: 1 });
  await rpc(host, 'accept_carpool_ride_request', { p_request_id: c1.body });
  const c2 = await createRequest(rider2, ctx.offerId, { seats: 1 });
  await sql(`update reservations set status = 'cancelled' where id='${ctx.reservationId}'`);
  const cRows = await sql(`select status from carpool_ride_requests where id in ('${c1.body}','${c2.body}') order by id`);
  const offerCancelled = await offerRow(ctx.offerId);
  const evCancel = await sql(`select count(*) c from carpool_events where carpool_offer_id='${ctx.offerId}' and event_type='HostTripCancelled'`);
  const cancelReasons = await sql(`select count(*) c from carpool_events where carpool_offer_id='${ctx.offerId}' and event_type='RideInvalidated' and payload->>'reason'='HOST_TRIP_CANCELLED'`);
  record('Host trip (reservation) cancelled: ACCEPTED + PENDING requests INVALIDATED, offer disabled, seats released',
    cRows.every((r) => r.status === 'INVALIDATED') && offerCancelled.status === 'disabled' && offerCancelled.seats_available === offerCancelled.seats_offered, { cRows, offerCancelled });
  record('HostTripCancelled event + 2 RideInvalidated(HOST_TRIP_CANCELLED) events emitted', Number(evCancel[0].c) === 1 && Number(cancelReasons[0].c) === 2, { cancelled: evCancel[0].c, invalidated: cancelReasons[0].c });
  const cancelN = await notifs(U.rider2, 'Carona invalidada');
  record('Rider notified with the "trip cancelled" wording', cancelN.some((n) => n.body.includes('cancelada')), cancelN.map((n) => n.body));
  const afterCancelEnable = await rpc(host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 1 });
  record('Cannot (re)enable an offer on a cancelled host trip', failsWith(afterCancelEnable, 'CARPOOL_HOST_TRIP_INACTIVE'), msg(afterCancelEnable));
  await sql(`update reservations set status = 'confirmed' where id='${ctx.reservationId}'`);

  // ---------------------------------------------------------------- disable
  console.log('--- disable_carpool_offer invalidates live requests ---');
  await freshOffer(2);
  const o2 = (await sql(`select id from carpool_offers where trip_request_id='${ctx.tripId}' and status='active'`))[0].id;
  const x1 = await createRequest(rider1, o2); await rpc(host, 'accept_carpool_ride_request', { p_request_id: x1.body });
  const x2 = await createRequest(rider2, o2);
  const dis = await rpc(host, 'disable_carpool_offer', { p_offer_id: o2 });
  const xr = await sql(`select status from carpool_ride_requests where id in ('${x1.body}','${x2.body}')`);
  const disOffer = await offerRow(o2);
  record('Disabling an offer invalidates its live requests (reason OFFER_DISABLED) and frees seats', dis.ok && xr.every((r) => r.status === 'INVALIDATED') && disOffer.status === 'disabled' && disOffer.seats_available === 2, { xr, disOffer });
  const dis2 = await rpc(host, 'disable_carpool_offer', { p_offer_id: o2 });
  record('Disabling twice rejected (ALREADY_DISABLED)', failsWith(dis2, 'CARPOOL_OFFER_ALREADY_DISABLED'), msg(dis2));
  const reqOnDisabled = await createRequest(rider3, o2);
  record('Cannot request a ride on a disabled offer', failsWith(reqOnDisabled, 'CARPOOL_OFFER_NOT_ACTIVE'), msg(reqOnDisabled));

  // ---------------------------------------------------------------- notification grouping
  console.log('--- Notification grouping (anti-spam) ---');
  const o3 = await freshOffer(3);
  await sql(`delete from notifications where user_id='${U.host}'`);
  const g1 = await createRequest(rider1, o3); const g2 = await createRequest(rider2, o3);
  const gN = await notifs(U.host, 'Pedido de carona na sua viagem');
  record('Two ride requests -> host has ONE unread grouped notification mentioning 2 people', gN.length === 1 && gN[0].body.startsWith('2 pessoas'), gN);

  // ---------------------------------------------------------------- expiry
  console.log('--- Expiry sweep ---');
  await clearNotifs();
  await sql(`update carpool_ride_requests set created_at = now() - interval '31 minutes' where id='${g1.body}'`);
  const staleAccept = await rpc(host, 'accept_carpool_ride_request', { p_request_id: g1.body });
  record('Accepting a request past its expiry window is refused (REQUEST_EXPIRED)', failsWith(staleAccept, 'CARPOOL_REQUEST_EXPIRED'), msg(staleAccept));
  const userExpire = await rpc(host, 'expire_stale_carpool_requests', {});
  record('Authenticated users cannot call expire_stale_carpool_requests', !userExpire.ok && [401, 403].includes(userExpire.status), `status=${userExpire.status} ${msg(userExpire)}`);
  const anonExpire = await rpc(null, 'expire_stale_carpool_requests', {});
  record('Anon cannot call expire_stale_carpool_requests', !anonExpire.ok && [401, 403].includes(anonExpire.status), `status=${anonExpire.status}`);
  const svcExpire = await rpc(SERVICE_KEY, 'expire_stale_carpool_requests', {}, SERVICE_KEY);
  const g1row = await requestRow(g1.body); const g2row = await requestRow(g2.body);
  record('Service role sweep expires only the stale PENDING request (fresh one untouched)', svcExpire.ok && Number(svcExpire.body) >= 1 && g1row.status === 'EXPIRED' && g2row.status === 'PENDING', { returned: svcExpire.body, g1: g1row.status, g2: g2row.status });
  const expN = await notifs(U.rider1, 'Solicitação de carona expirada');
  record('Rider got the expiry notification (linked to reservation)', expN.length === 1 && expN[0].entity_id === ctx.reservationId, expN);
  const expAudit = await sql(`select count(*) c from audit_log where entity_id='${g1.body}' and action='carpool_ride_expired'`);
  record('Expiry audited', Number(expAudit[0].c) === 1);

  // ---------------------------------------------------------------- grants / internal helpers
  console.log('--- Internal helpers are not callable by users ---');
  for (const [fn, args] of [
    ['carpool_apply_accept', { p_request_id: g2.body, p_actor_id: U.host, p_auto: true }],
    ['carpool_invalidate_request', { p_request_id: g2.body, p_reason: 'X', p_actor_id: U.host }],
    ['carpool_emit_event', { p_organization_id: ctx.orgA, p_event_type: 'RideExpired', p_offer_id: o3, p_request_id: g2.body, p_trip_request_id: ctx.tripId, p_actor_id: null, p_payload: {} }],
    ['carpool_notify_user', { p_org: ctx.orgA, p_user: U.rider1, p_title: 'x', p_body: 'x', p_entity_id: null, p_group: false }],
  ]) {
    const asUser = await rpc(host, fn, args);
    const asAnon = await rpc(null, fn, args);
    record(`${fn}: denied to authenticated AND anon`, !asUser.ok && !asAnon.ok && [401, 403].includes(asUser.status) && [401, 403].includes(asAnon.status), `auth=${asUser.status} anon=${asAnon.status}`);
  }
  const anonRpcs = [
    ['update_carpool_offer', { p_offer_id: o3, p_seats: 1 }], ['disable_carpool_offer', { p_offer_id: o3 }],
    ['reject_carpool_ride_request', { p_request_id: g2.body, p_reason: null }], ['cancel_carpool_ride_request', { p_request_id: g2.body }],
    ['revalidate_carpool_matches', { p_trip_request_id: ctx.tripId }],
    ['create_carpool_ride_request_as_rider', { p_rider_id: U.rider1, p_offer_id: o3, p_seats: 1, p_pickup: null, p_dropoff: null, p_requested_departure_at: HOST_DEPARTURE, p_client_request_id: randomUUID(), p_match_additional_distance_km: 1, p_match_additional_time_min: 1 }],
  ];
  for (const [fn, args] of anonRpcs) {
    const a = await rpc(null, fn, args);
    record(`Real anon-key call to ${fn} is denied`, !a.ok && [401, 403].includes(a.status), `status=${a.status}`);
  }

  // ---------------------------------------------------------------- stale pending re-request
  console.log('--- Re-request over a stale PENDING request (no cron needed) ---');
  const st1 = await createRequest(rider3, o3);
  await sql("update carpool_ride_requests set created_at = now() - interval '31 minutes' where id='" + st1.body + "'");
  const st2 = await createRequest(rider3, o3, { key: randomUUID() });
  const st1row = await requestRow(st1.body);
  const stEv = await sql("select count(*) c from carpool_events where carpool_ride_request_id='" + st1.body + "' and event_type='RideExpired'");
  record('Stale PENDING is expired at re-request time, new request created, rider not blocked by the unique index',
    st1.ok && st2.ok && st2.body !== st1.body && st1row.status === 'EXPIRED' && Number(stEv[0].c) === 1, { first: st1row.status, second: st2.ok ? (await requestRow(st2.body)).status : msg(st2), events: stEv[0].c });
  const fresh = await createRequest(rider3, o3, { key: randomUUID() });
  record('A NON-stale live request still blocks a duplicate (unique index intact)', !fresh.ok, msg(fresh));
  await rpc(rider3, 'cancel_carpool_ride_request', { p_request_id: st2.body });

  // ---------------------------------------------------------------- trigger resilience
  console.log('--- Triggers cannot abort the underlying statement ---');
  const pend = await requestRow(g2.body);
  await sql("alter table carpool_events add constraint c4test_block check (event_type not in ('HostTripCancelled','RideInvalidated')) not valid");
  let blockedOk = false;
  try {
    await sql("update reservations set status = 'cancelled' where id='" + ctx.reservationId + "'");
    blockedOk = true;
  } catch (e) {
    blockedOk = String(e);
  } finally {
    await sql('alter table carpool_events drop constraint if exists c4test_block');
  }
  const resAfter = await sql("select status from reservations where id='" + ctx.reservationId + "'");
  const g2After = await requestRow(g2.body);
  record('Revalidation failure inside the reservations trigger does NOT abort the cancellation (cancel succeeds; the failed revalidation rolled back as a unit)',
    blockedOk === true && resAfter[0].status === 'cancelled' && pend.status === 'PENDING' && g2After.status === 'PENDING', { blockedOk, reservation: resAfter[0].status, requestBefore: pend.status, requestAfter: g2After.status });
  await sql("update reservations set status = 'confirmed' where id='" + ctx.reservationId + "'");

  // ---------------------------------------------------------------- auto-accept policy (last: inserts policy v2)
  console.log('--- Policy: host approval NOT required -> auto-accept ---');
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, host_approval_required, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
             values ('${ctx.orgA}', 2, false, 15, 15, 5, 10, 30)`);
  await rpc(host, 'reject_carpool_ride_request', { p_request_id: g2.body, p_reason: 'cleanup' });
  const auto = await createRequest(rider3, o3);
  const autoRow = await requestRow(auto.body);
  record('With host_approval_required=false the request is auto-ACCEPTED (policy v2 recorded), seat consumed', auto.ok && autoRow.status === 'ACCEPTED' && autoRow.policy_version === 2 && (await offerRow(o3)).seats_available === 2, { autoRow });
}

main()
  .catch((err) => {
    record('FATAL (unexpected exception)', false, String(err && err.stack ? err.stack : err));
  })
  .finally(async () => {
    await cleanup();
    console.log('\n=== Summary ===');
    const failCount = results.filter((r) => !r.pass).length;
    for (const r of results.filter((x) => !x.pass)) console.log(`FAIL - ${r.name}`);
    console.log(`\n${results.length - failCount}/${results.length} checks passed.\n`);
    process.exitCode = failCount > 0 ? 1 : 0;
  });
