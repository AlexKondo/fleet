#!/usr/bin/env node
// Phase C5 STEP 0 live test (migration 0061): the three C4 follow-ups.
//   (1) reconcile sweep in expire_stale_carpool_requests: riders stranded by a FAILED revalidation
//       are INVALIDATED + notified when the sweep runs as service_role
//   (2) trip_participants forgery (INSERT status='accepted' / bogus count) is refused; the legacy
//       form path (create_carpool_participation -> respond_to_carpool_request) and the C4 accept RPC
//       still work
//   (4) 0062: carpool_ride_requests SELECT privacy (rider / host / manager only) + status_reason
//   (3) legacy RPC grants: no PUBLIC/anon EXECUTE (grants view + a real anon call = 401);
//       plus pg_proc overload counts (no duplicate overloads) for every carpool function
// Disposable data only (two throwaway orgs/users), removed in finally with a proof query.
//
// Usage: node supabase/tests/carpool-c5-step0-followups.mjs   (reads repo-root .env)
//   Run BEFORE applying 0061 to see the attack succeed (FAILs expected), AFTER to see it refused.

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
async function adminDeleteUser(id) {
  await fetch(URL_ + '/auth/v1/admin/users/' + id, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
}
async function signIn(email, password) {
  const res = await fetch(URL_ + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('sign-in failed ' + JSON.stringify(j));
  return j.access_token;
}
async function rpc(token, fn, args = {}, key = ANON) {
  const res = await fetch(URL_ + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + (token ?? key), 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  let body = null; try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body, ok: res.status < 300 };
}
async function insertRow(token, table, row) {
  const res = await fetch(URL_ + '/rest/v1/' + table, {
    method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  let body = null; try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body, ok: res.status < 300 };
}
const msg = (r) => (r.body && (r.body.message || r.body.hint || JSON.stringify(r.body))) || String(r.status);
const failsWith = (r, code) => !r.ok && String(msg(r)).includes(code);

const ctx = { users: {}, tok: {} };
const T = Date.now().toString(36);
const PASSWORD = 'C5s0!' + randomUUID().slice(0, 8);
const emailOf = (n) => 'c5s0-' + n + '-' + T + '@fleet-test.invalid';
const farFuture = new Date(Date.now() + 10 * 86400000);
const DEP = farFuture.toISOString();
const RET = new Date(farFuture.getTime() + 4 * 3600000).toISOString();
const loc = (lat, lng) => ({ coordinates: { lat, lng }, source: 'manual_lat_lng' });

async function createRequest(riderKey, offerId, key = randomUUID()) {
  return rpc(SVC, 'create_carpool_ride_request_as_rider', {
    p_rider_id: ctx.users[riderKey], p_offer_id: offerId, p_seats: 1, p_pickup: loc(-23.55, -46.63), p_dropoff: loc(-23.56, -46.64),
    p_requested_departure_at: DEP, p_client_request_id: key, p_match_additional_distance_km: 1.5, p_match_additional_time_min: 3,
  }, SVC);
}
const reqStatus = async (id) => (await sql(`select status, responded_by from carpool_ride_requests where id='${id}'`))[0];
const notifs = (uid, title) => sql(`select title, body, entity_id from notifications where user_id='${uid}' and title='${title}'`);

async function setup() {
  const [orgA] = await sql(`insert into organizations (name) values ('C5S0-ORG-A-${T}') returning id`);
  const [orgB] = await sql(`insert into organizations (name) values ('C5S0-ORG-B-${T}') returning id`);
  ctx.orgA = orgA.id; ctx.orgB = orgB.id;
  const defs = [['host', ctx.orgA, 'employee'], ['rider1', ctx.orgA, 'employee'], ['rider2', ctx.orgA, 'employee'],
    ['rider3', ctx.orgA, 'employee'], ['mgr', ctx.orgA, 'fleet_manager'], ['riderB', ctx.orgB, 'employee']];
  for (const [name, org, role] of defs) {
    const id = await adminCreateUser(emailOf(name), PASSWORD);
    ctx.users[name] = id;
    await sql(`insert into profiles (id, organization_id, full_name, role) values ('${id}', '${org}', 'C5S0 ${name}', '${role}')`);
  }
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
             values ('${ctx.orgA}', 1, 15, 15, 5, 10, 30)`);
  const [cat] = await sql(`insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('${ctx.orgA}', 'C5S0 cat', 5, 'ICE') returning id`);
  const [veh] = await sql(`insert into vehicles (organization_id, plate, category_id, status) values ('${ctx.orgA}', 'C5S${T.slice(-4).toUpperCase()}', '${cat.id}', 'reserved') returning id`);
  const [trip] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification)
     values ('${ctx.orgA}', '${ctx.users.host}', '${DEP}', '${RET}', 'Sede C5S0', 'Destino C5S0', 30, 1, 'C5S0 disposable') returning id`);
  ctx.tripId = trip.id;
  const [res] = await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at)
     values ('${ctx.orgA}', '${veh.id}', '${ctx.tripId}', 'confirmed', '${DEP}', '${RET}') returning id`);
  ctx.reservationId = res.id;
  for (const [name] of defs) ctx.tok[name] = await signIn(emailOf(name), PASSWORD);
  await new Promise((r) => setTimeout(r, 1500));
}

async function cleanup() {
  try {
    await sql('alter table carpool_events drop constraint if exists c5s0_block');
    for (const org of [ctx.orgA, ctx.orgB].filter(Boolean)) {
      await sql(`delete from reservations where organization_id='${org}'`);
      await sql(`delete from organizations where id='${org}'`);
    }
    for (const id of Object.values(ctx.users)) await adminDeleteUser(id);
    const ids = Object.values(ctx.users).map((u) => `'${u}'`).join(',') || "'00000000-0000-0000-0000-000000000000'";
    const left = await sql(`select
      (select count(*) from organizations where name like 'C5S0-ORG-%-${T}') orgs,
      (select count(*) from profiles where id in (${ids})) profiles,
      (select count(*) from trip_requests where organization_id in ('${ctx.orgA}','${ctx.orgB}')) trips,
      (select count(*) from trip_participants where organization_id in ('${ctx.orgA}','${ctx.orgB}')) participants,
      (select count(*) from carpool_offers where organization_id in ('${ctx.orgA}','${ctx.orgB}')) offers,
      (select count(*) from carpool_ride_requests where organization_id in ('${ctx.orgA}','${ctx.orgB}')) requests,
      (select count(*) from carpool_events where organization_id in ('${ctx.orgA}','${ctx.orgB}')) events,
      (select count(*) from notifications where organization_id in ('${ctx.orgA}','${ctx.orgB}')) notifications,
      (select count(*) from audit_log where organization_id in ('${ctx.orgA}','${ctx.orgB}')) audit`);
    record('Cleanup: no disposable rows left in the live DB', Object.values(left[0]).every((v) => Number(v) === 0), left[0]);
  } catch (e) { record('Cleanup', false, String(e)); }
}

async function main() {
  console.log('\n=== C5 STEP 0 follow-ups (live) - ' + new Date().toISOString() + ' ===\n');
  await setup();
  const U = ctx.users, tok = ctx.tok;

  // ------------------------------------------------ (2) trip_participants forgery
  console.log('--- (2) trip_participants forgery ---');
  const forge = await insertRow(tok.rider1, 'trip_participants', { organization_id: ctx.orgA, trip_request_id: ctx.tripId, passenger_id: U.rider1, passenger_count: 3, status: 'accepted' });
  const forgedRows = await sql(`select count(*) c, max(passenger_count) n from trip_participants where trip_request_id='${ctx.tripId}' and passenger_id='${U.rider1}'`);
  console.log('    ATTACK status=' + forge.status + ' body=' + JSON.stringify(forge.body) + ' rows-after=' + JSON.stringify(forgedRows[0]));
  record('Forgery: rider INSERT of own trip_participants row with status=accepted, passenger_count=3 is REFUSED (RLS 403)',
    forge.status === 403 && Number(forgedRows[0].c) === 0, { status: forge.status, rowsCreated: forgedRows[0].c });
  const forgeDefault = await insertRow(tok.rider1, 'trip_participants', { organization_id: ctx.orgA, trip_request_id: ctx.tripId, passenger_id: U.rider1, passenger_count: 2 });
  record('Forgery via omitted status (column default is accepted) is REFUSED too', forgeDefault.status === 403, { status: forgeDefault.status, body: forgeDefault.body });
  const forgeZero = await insertRow(tok.rider1, 'trip_participants', { organization_id: ctx.orgA, trip_request_id: ctx.tripId, passenger_id: U.rider1, passenger_count: 0, status: 'pending' });
  record('pending row with passenger_count 0 refused', !forgeZero.ok, { status: forgeZero.status });
  const forgeOther = await insertRow(tok.rider1, 'trip_participants', { organization_id: ctx.orgA, trip_request_id: ctx.tripId, passenger_id: U.rider2, passenger_count: 1, status: 'pending' });
  record('Inserting a row on behalf of ANOTHER user is refused', forgeOther.status === 403, { status: forgeOther.status });
  const forgeCross = await insertRow(tok.riderB, 'trip_participants', { organization_id: ctx.orgB, trip_request_id: ctx.tripId, passenger_id: U.riderB, passenger_count: 1, status: 'pending' });
  record('Cross-org user cannot attach a pending row to org A\'s trip (trip not visible in own org)', !forgeCross.ok, { status: forgeCross.status, body: forgeCross.body });
  const upg = await fetch(URL_ + '/rest/v1/trip_participants?trip_request_id=eq.' + ctx.tripId, {
    method: 'PATCH', headers: { apikey: ANON, Authorization: 'Bearer ' + tok.rider1, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ status: 'accepted' }),
  });
  record('Direct PATCH of status to accepted has no effect (no UPDATE policy)', Number((await sql(`select count(*) c from trip_participants where trip_request_id='${ctx.tripId}' and status='accepted'`))[0].c) === 0, { status: upg.status });

  // legacy form path (SECURITY INVOKER create_carpool_participation) must keep working
  const legacy = await rpc(tok.rider2, 'create_carpool_participation', {
    p_departure_at: DEP, p_expected_return_at: RET, p_origin: 'Sede C5S0', p_destination: 'Destino C5S0', p_distance_km: 30,
    p_passenger_count: 1, p_requires_cargo: false, p_justification: 'C5S0 legacy', p_existing_trip_request_id: ctx.tripId,
  });
  const legacyRow = (await sql(`select id, status, passenger_count from trip_participants where trip_request_id='${ctx.tripId}' and passenger_id='${U.rider2}'`))[0];
  record('Legacy create_carpool_participation (authenticated) still works: creates a PENDING participant', legacy.ok && legacyRow?.status === 'pending', { legacy: legacy.status, legacyRow });
  const legacyAccept = await rpc(tok.host, 'respond_to_carpool_request', { p_participant_id: legacyRow.id, p_accept: true });
  const legacyAfter = (await sql(`select status from trip_participants where id='${legacyRow.id}'`))[0];
  record('Legacy respond_to_carpool_request (host, security definer) still accepts it', legacyAccept.ok && legacyAfter.status === 'accepted', { legacyAccept: legacyAccept.status, status: legacyAfter.status });
  await sql(`delete from trip_participants where trip_request_id='${ctx.tripId}'`);

  // C4 accept RPC (security definer) must still write accepted rows
  const en = await rpc(tok.host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 3 });
  ctx.offerId = en.body;
  const r0 = await createRequest('rider3', ctx.offerId);
  const acc = await rpc(tok.host, 'accept_carpool_ride_request', { p_request_id: r0.body });
  const partC4 = (await sql(`select status from trip_participants where trip_request_id='${ctx.tripId}' and passenger_id='${U.rider3}'`))[0];
  record('C4 accept_carpool_ride_request (security definer) still writes an ACCEPTED participant under the tightened policy', acc.ok && partC4?.status === 'accepted', { acc: acc.status, partC4 });
  await rpc(tok.rider3, 'cancel_carpool_ride_request', { p_request_id: r0.body });

  // ------------------------------------------------ (3) grants
  console.log('--- (3) legacy RPC grants ---');
  const grants = await sql(`select routine_name, grantee from information_schema.role_routine_grants
     where routine_schema='public' and routine_name in ('create_carpool_participation','respond_to_carpool_request') order by 1,2`);
  console.log('    role_routine_grants: ' + JSON.stringify(grants));
  record('role_routine_grants: neither legacy RPC is granted to PUBLIC or anon; authenticated retained',
    !grants.some((g) => ['PUBLIC', 'anon'].includes(g.grantee)) && ['create_carpool_participation', 'respond_to_carpool_request'].every((n) => grants.some((g) => g.routine_name === n && g.grantee === 'authenticated')), grants);
  const aclPub = await sql(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec, has_function_privilege('public', p.oid, 'EXECUTE') public_exec
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_carpool_participation','respond_to_carpool_request')`);
  record('has_function_privilege(anon/public) is false for both', aclPub.every((r) => !r.anon_exec && !r.public_exec), aclPub);
  const anon1 = await rpc(null, 'create_carpool_participation', { p_departure_at: DEP, p_expected_return_at: RET, p_origin: 'x', p_destination: 'y', p_distance_km: 1, p_passenger_count: 1, p_requires_cargo: false, p_justification: 'x', p_existing_trip_request_id: ctx.tripId });
  const anon2 = await rpc(null, 'respond_to_carpool_request', { p_participant_id: randomUUID(), p_accept: true });
  record('Anon-key call to create_carpool_participation -> 401', anon1.status === 401, { status: anon1.status, body: anon1.body });
  record('Anon-key call to respond_to_carpool_request -> 401', anon2.status === 401, { status: anon2.status, body: anon2.body });

  const dup = await sql(`select proname, count(*) c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (proname like 'carpool\\_%' or proname like '%carpool%') group by proname order by proname`);
  console.log('    pg_proc overload counts: ' + dup.map((d) => d.proname + '=' + d.c).join(', '));
  record('pg_proc: every carpool-related function has exactly ONE overload', dup.every((d) => Number(d.c) === 1) && dup.some((d) => d.proname === 'expire_stale_carpool_requests'), dup.filter((d) => Number(d.c) !== 1));

  // ------------------------------------------------ (1) reconcile sweep
  console.log('--- (1) reconcile sweep ---');
  const offerId = ctx.offerId;
  const a1 = await createRequest('rider1', offerId); await rpc(tok.host, 'accept_carpool_ride_request', { p_request_id: a1.body });
  const a2 = await createRequest('rider2', offerId);
  const sweepHealthy = await rpc(SVC, 'expire_stale_carpool_requests', {}, SVC);
  record('Sweep on a HEALTHY offer leaves ACCEPTED/PENDING requests untouched', sweepHealthy.ok && (await reqStatus(a1.body)).status === 'ACCEPTED' && (await reqStatus(a2.body)).status === 'PENDING', { sweep: sweepHealthy.body });

  // Scenario A: revalidation FAILS on a host SCHEDULE change (events blocked), riders strand, sweep repairs
  await sql("alter table carpool_events add constraint c5s0_block check (event_type not in ('HostTripCancelled','RideInvalidated','HostTripChanged')) not valid");
  try {
    await sql(`update trip_requests set departure_at = '${new Date(farFuture.getTime() + 60 * 60000).toISOString()}' where id='${ctx.tripId}'`);
  } finally { await sql('alter table carpool_events drop constraint if exists c5s0_block'); }
  const strandedA = [await reqStatus(a1.body), await reqStatus(a2.body)];
  record('Reproduction A: trigger revalidation failed -> riders STRANDED (ACCEPTED/PENDING on a trip moved +60min, beyond the 15min window)', strandedA[0].status === 'ACCEPTED' && strandedA[1].status === 'PENDING', strandedA);
  await sql('delete from notifications where organization_id=\'' + ctx.orgA + '\'');
  const sweepA = await rpc(SVC, 'expire_stale_carpool_requests', {}, SVC);
  const fixedA = [await reqStatus(a1.body), await reqStatus(a2.body)];
  const reasonA = await sql(`select payload->>'reason' reason from carpool_events where carpool_ride_request_id in ('${a1.body}','${a2.body}') and event_type='RideInvalidated'`);
  const nA = await notifs(U.rider1, 'Carona invalidada');
  record('Sweep (service_role) reconciles A: both INVALIDATED (HOST_SCHEDULE_CHANGED), responded_by NULL (system), seats released, rider notified',
    sweepA.ok && fixedA.every((r) => r.status === 'INVALIDATED' && r.responded_by === null) && reasonA.length === 2 && reasonA.every((r) => r.reason === 'HOST_SCHEDULE_CHANGED')
      && nA.length === 1 && nA[0].entity_id === ctx.reservationId
      && (await sql(`select seats_available s from carpool_offers where id='${offerId}'`))[0].s === 3
      && Number((await sql(`select count(*) c from trip_participants where trip_request_id='${ctx.tripId}'`))[0].c) === 0,
    { sweep: sweepA.body, fixedA, reasonA, notif: nA.map((n) => n.body) });
  const sweepAgain = await rpc(SVC, 'expire_stale_carpool_requests', {}, SVC);
  record('Sweep is idempotent (second run changes nothing, no duplicate notification)', sweepAgain.ok && (await notifs(U.rider1, 'Carona invalidada')).length === 1);
  await sql(`update trip_requests set departure_at = '${DEP}' where id='${ctx.tripId}'`);

  // Scenario B: host RESERVATION cancelled while revalidation fails
  const b1 = await createRequest('rider1', offerId); await rpc(tok.host, 'accept_carpool_ride_request', { p_request_id: b1.body });
  const b2 = await createRequest('rider2', offerId);
  await sql("alter table carpool_events add constraint c5s0_block check (event_type not in ('HostTripCancelled','RideInvalidated','HostTripChanged')) not valid");
  try {
    await sql(`update reservations set status='cancelled' where id='${ctx.reservationId}'`);
  } finally { await sql('alter table carpool_events drop constraint if exists c5s0_block'); }
  const strandedB = [await reqStatus(b1.body), await reqStatus(b2.body)];
  const offB = (await sql(`select status, seats_available from carpool_offers where id='${offerId}'`))[0];
  record('Reproduction B: reservation cancelled but revalidation failed -> riders STILL ACCEPTED/PENDING and offer still active (the strand)', strandedB[0].status === 'ACCEPTED' && strandedB[1].status === 'PENDING' && offB.status === 'active', { strandedB, offB });
  await sql('delete from notifications where organization_id=\'' + ctx.orgA + '\'');
  const sweepB = await rpc(SVC, 'expire_stale_carpool_requests', {}, SVC);
  const fixedB = [await reqStatus(b1.body), await reqStatus(b2.body)];
  const offB2 = (await sql(`select status, seats_available, seats_offered from carpool_offers where id='${offerId}'`))[0];
  const nB1 = await notifs(U.rider1, 'Carona invalidada'); const nB2 = await notifs(U.rider2, 'Carona invalidada');
  record('Sweep reconciles B: ACCEPTED + PENDING rider both INVALIDATED (HOST_TRIP_CANCELLED), offer disabled, seats released, participant removed, BOTH riders notified ("cancelada")',
    sweepB.ok && fixedB.every((r) => r.status === 'INVALIDATED') && offB2.status === 'disabled' && offB2.seats_available === offB2.seats_offered
      && nB1.length === 1 && nB2.length === 1 && nB1[0].body.includes('cancelada')
      && Number((await sql(`select count(*) c from trip_participants where trip_request_id='${ctx.tripId}'`))[0].c) === 0,
    { sweep: sweepB.body, fixedB, offB2, notifs: [nB1[0]?.body, nB2[0]?.body] });
  const evB = await sql(`select count(*) c from carpool_events where carpool_offer_id='${offerId}' and event_type='HostTripCancelled'`);
  const auditB = await sql(`select count(*) c from audit_log where action='carpool_ride_invalidated' and entity_id in ('${b1.body}','${b2.body}') and actor_id is null`);
  record('HostTripCancelled event emitted and invalidation audit rows written with a NULL (system) actor', Number(evB[0].c) >= 1 && Number(auditB[0].c) === 2, { events: evB[0].c, audit: auditB[0].c });
  await sql(`update reservations set status='confirmed' where id='${ctx.reservationId}'`);

  // ------------------------------------------------ (4) 0062 privacy + status_reason
  console.log('--- (4) 0062: ride-request privacy and status_reason ---');
  const en2 = await rpc(tok.host, 'enable_carpool_offer', { p_trip_request_id: ctx.tripId, p_seats: 3 });
  const off2 = en2.body;
  const q1 = await createRequest('rider1', off2);
  const q2 = await createRequest('rider2', off2);
  const readReq = async (token, id) => {
    const res = await fetch(URL_ + '/rest/v1/carpool_ride_requests?id=eq.' + id + '&select=id,pickup_location,rider_id', { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
    return { status: res.status, rows: await res.json() };
  };
  const own = await readReq(tok.rider1, q1.body);
  record('Rider reads their OWN ride request', own.rows.length === 1, own.rows.length);
  const peer = await readReq(tok.rider2, q1.body);
  record("A coworker (another rider) CANNOT read someone else's ride request (pickup coordinates not exposed)", peer.rows.length === 0, peer);
  const outsider3 = await readReq(tok.rider3, q1.body);
  record('An unrelated employee cannot read it either', outsider3.rows.length === 0, outsider3);
  const hostRead = await readReq(tok.host, q1.body);
  record("The offer's HOST can read requests on their own offer", hostRead.rows.length === 1, hostRead.rows.length);
  const mgrRead = await readReq(tok.mgr, q1.body);
  record('A fleet manager of the org can read it', mgrRead.rows.length === 1, mgrRead.rows.length);
  const crossRead = await readReq(tok.riderB, q1.body);
  record('A user of another organization cannot read it', crossRead.rows.length === 0, crossRead.rows.length);
  const anonRead = await fetch(URL_ + '/rest/v1/carpool_ride_requests?select=id', { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } });
  const anonBody = await anonRead.json();
  record('Anon cannot read ride requests', anonRead.status === 401 || (Array.isArray(anonBody) && anonBody.length === 0), anonRead.status);
  const rej = await rpc(tok.host, 'reject_carpool_ride_request', { p_request_id: q1.body, p_reason: '  Sem espaco no porta-malas ' });
  const rejRow = (await sql(`select status, status_reason from carpool_ride_requests where id='${q1.body}'`))[0];
  record("reject stores the host's (trimmed) reason in status_reason", rej.ok && rejRow.status === 'REJECTED' && rejRow.status_reason === 'Sem espaco no porta-malas', rejRow);
  const rejBlank = await rpc(tok.host, 'reject_carpool_ride_request', { p_request_id: q2.body, p_reason: '   ' });
  const rejBlankRow = (await sql(`select status, status_reason from carpool_ride_requests where id='${q2.body}'`))[0];
  record('a blank rejection reason is stored as NULL', rejBlank.ok && rejBlankRow.status_reason === null, rejBlankRow);
  const q3 = await createRequest('rider3', off2);
  await rpc(tok.host, 'accept_carpool_ride_request', { p_request_id: q3.body });
  await rpc(tok.host, 'disable_carpool_offer', { p_offer_id: off2 });
  const invRow = (await sql(`select status, status_reason from carpool_ride_requests where id='${q3.body}'`))[0];
  record('invalidation stores its reason code in status_reason (OFFER_DISABLED)', invRow.status === 'INVALIDATED' && invRow.status_reason === 'OFFER_DISABLED', invRow);
}

main()
  .catch((e) => record('FATAL (unexpected exception)', false, String(e && e.stack ? e.stack : e)))
  .finally(async () => {
    await cleanup();
    const f = results.filter((r) => !r.pass);
    console.log('\n=== Summary ===');
    for (const r of f) console.log('FAIL - ' + r.name);
    console.log('\n' + (results.length - f.length) + '/' + results.length + ' checks passed.\n');
    process.exitCode = f.length ? 1 : 0;
  });
