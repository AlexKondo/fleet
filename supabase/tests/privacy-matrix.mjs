#!/usr/bin/env node
// Phase C7 privacy regression: role x resource READ matrix + attack checks, over PostgREST with
// REAL user JWTs against the live project. Disposable orgs/users only (removed in finally).
//
//   node supabase/tests/privacy-matrix.mjs [--phase before|after]
//
// The expected visibility is the POST-migration (0063) design. Running it BEFORE 0063 captures the
// baseline (the leaks show up as FAIL rows, "extra" ids are the exposed coworker rows); AFTER it
// every row must PASS. Roles: employee A (host), employee B (accepted rider), employee C
// (unrelated coworker), employee D (REJECTED rider), security, fleet_manager, administrator,
// maintenance_operator, and one employee of a second organisation.
import {
  sql, rest, rpc, provisionOrg, signInAll, cleanupOrgs, record, summary, q, denied, msg, ANON, URL_, T,
} from './lib/live.mjs';

const PHASE = process.argv.includes('--phase') ? process.argv[process.argv.indexOf('--phase') + 1] : 'after';
const orgs = [];

async function seed(A, B) {
  const [empA, empB, empC, empD, sec, mgr, adm, mnt] = ['empA', 'empB', 'empC', 'empD', 'sec', 'mgr', 'adm', 'mnt'].map((n) => A.users[n].id);
  const when = (h) => `now() + interval '${h} hours'`;
  const mkTrip = async (org, requester, dest, h) => {
    const [t] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, allow_carpool)
      values ('${org}', '${requester}', ${when(h)}, ${when(h + 4)}, 'Rua Secreta 100, Sao Paulo', ${q(dest)}, 20, 1, false, 'JUSTIF-SECRETA-${dest}', true) returning id`);
    return t.id;
  };
  const mkRes = async (org, vehicle, trip, status, h) => {
    const [r] = await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${org}', '${vehicle}', '${trip}', '${status}', ${when(h)}, ${when(h + 4)}) returning id`);
    return r.id;
  };
  const ids = {};
  ids.tA = await mkTrip(A.orgId, empA, 'DestA', 24); ids.tB = await mkTrip(A.orgId, empB, 'DestB', 24); ids.tC = await mkTrip(A.orgId, empC, 'DestC', 24);
  ids.rA = await mkRes(A.orgId, A.vehicles[0].id, ids.tA, 'confirmed', 24);
  ids.rB = await mkRes(A.orgId, A.vehicles[1].id, ids.tB, 'pending_approval', 24);
  ids.rC = await mkRes(A.orgId, A.vehicles[2].id, ids.tC, 'pending_approval', 24);
  ids.tX = await mkTrip(B.orgId, B.users.empX.id, 'DestX', 24);
  ids.rX = await mkRes(B.orgId, B.vehicles[0].id, ids.tX, 'pending_approval', 24);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version) values ('${A.orgId}', 1) on conflict do nothing`).catch(() => {});
  const [oA] = await sql(`insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) values ('${A.orgId}', '${ids.tA}', '${empA}', 'active', 3, 2, 1) returning id`);
  ids.oA = oA.id;
  const [oX] = await sql(`insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) values ('${B.orgId}', '${ids.tX}', '${B.users.empX.id}', 'active', 2, 2, 1) returning id`);
  ids.oX = oX.id;
  const mkRr = async (rider, status) => {
    const [r] = await sql(`insert into carpool_ride_requests (organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location, requested_departure_at, status, policy_version, match_additional_distance_km, match_additional_time_min)
      values ('${A.orgId}', '${ids.oA}', '${rider}', 1, '{"label":"Rua do Rider 10, Sao Paulo","coordinates":{"lat":-23.55,"lng":-46.63}}', '{"label":"Av Destino 20, Sao Paulo","coordinates":{"lat":-23.56,"lng":-46.64}}', ${when(24)}, '${status}', 1, 1.2, 3) returning id`);
    return r.id;
  };
  ids.rrB = await mkRr(empB, 'ACCEPTED');
  ids.rrD = await mkRr(empD, 'REJECTED');
  const [tp] = await sql(`insert into trip_participants (organization_id, trip_request_id, passenger_id, passenger_count, status) values ('${A.orgId}', '${ids.tA}', '${empB}', 1, 'accepted') returning id`);
  ids.tpB = tp.id;
  const [mA] = await sql(`insert into reservation_messages (organization_id, reservation_id, sender_id, message_type, body) values ('${A.orgId}', '${ids.rA}', '${empA}', 'text', 'msg do host') returning id`);
  const [mM] = await sql(`insert into reservation_messages (organization_id, reservation_id, sender_id, message_type, body) values ('${A.orgId}', '${ids.rA}', '${mgr}', 'text', 'msg do gestor') returning id`);
  ids.mA = mA.id; ids.mM = mM.id;
  ids.n = {};
  for (const [name, u] of Object.entries(A.users)) {
    const [n] = await sql(`insert into notifications (organization_id, user_id, title, body) values ('${A.orgId}', '${u.id}', 'N-${name}', 'b') returning id`);
    ids.n[name] = n.id;
  }
  const [nX] = await sql(`insert into notifications (organization_id, user_id, title, body) values ('${B.orgId}', '${B.users.empX.id}', 'N-X', 'b') returning id`);
  ids.n.empX = nX.id;
  void [sec, adm, mnt];
  return ids;
}

const ROLE_ORDER = ['empA', 'empB', 'empC', 'empD', 'sec', 'mgr', 'adm', 'mnt', 'empX'];

async function main() {
  const A = await provisionOrg('A', [['empA', 'employee'], ['empB', 'employee'], ['empC', 'employee'], ['empD', 'employee'], ['sec', 'security'], ['mgr', 'fleet_manager'], ['adm', 'administrator'], ['mnt', 'maintenance_operator']], 3);
  orgs.push(A);
  const B = await provisionOrg('B', [['empX', 'employee']], 1);
  orgs.push(B);
  const U = { ...A.users, ...B.users };
  await signInAll(A); await signInAll(B);
  const ids = await seed(A, B);
  const label = new Map();
  const put = (id, l) => label.set(id, l);
  for (const k of ['tA', 'tB', 'tC', 'tX', 'rA', 'rB', 'rC', 'rX', 'oA', 'oX', 'rrB', 'rrD', 'tpB', 'mA', 'mM']) put(ids[k], k);
  for (const [n, u] of Object.entries(U)) put(u.id, 'P:' + n);
  for (const [n, id] of Object.entries(ids.n)) put(id, 'N:' + n);
  A.vehicles.forEach((v, i) => put(v.id, 'V' + (i + 1)));
  put(B.vehicles[0].id, 'VX');
  const lab = (id) => label.get(id) ?? id;

  const priv = ['sec', 'mgr', 'adm'];
  const mgrs = ['mgr', 'adm'];
  const allA = ['empA', 'empB', 'empC', 'empD', 'sec', 'mgr', 'adm', 'mnt'].map((n) => 'P:' + n);
  const exp = {
    trip_requests: { empA: ['tA'], empB: ['tA', 'tB'], empC: ['tC'], empD: [], mnt: [], empX: ['tX'], ...Object.fromEntries(priv.map((r) => [r, ['tA', 'tB', 'tC']])) },
    reservations: { empA: ['rA'], empB: ['rA', 'rB'], empC: ['rC'], empD: [], mnt: [], empX: ['rX'], ...Object.fromEntries(priv.map((r) => [r, ['rA', 'rB', 'rC']])) },
    trip_participants: { empA: ['tpB'], empB: ['tpB'], empC: [], empD: [], mnt: [], empX: [], ...Object.fromEntries(priv.map((r) => [r, ['tpB']])) },
    carpool_offers: { empA: ['oA'], empB: ['oA'], empC: [], empD: ['oA'], sec: [], mnt: [], empX: ['oX'], mgr: ['oA'], adm: ['oA'] },
    carpool_ride_requests: { empA: ['rrB', 'rrD'], empB: ['rrB'], empC: [], empD: ['rrD'], sec: [], mnt: [], empX: [], mgr: ['rrB', 'rrD'], adm: ['rrB', 'rrD'] },
    reservation_messages: { empA: ['mA', 'mM'], empB: [], empC: [], empD: [], mnt: [], empX: [], ...Object.fromEntries(priv.map((r) => [r, ['mA', 'mM']])) },
    profiles: {
      empA: ['P:empA', 'P:empB', 'P:empD', 'P:mgr', 'P:adm'], empB: ['P:empB', 'P:empA', 'P:mgr', 'P:adm'], empC: ['P:empC', 'P:mgr', 'P:adm'], empD: ['P:empD', 'P:mgr', 'P:adm'],
      sec: allA, mgr: allA, adm: allA, mnt: allA, empX: ['P:empX'],
    },
    notifications: Object.fromEntries(ROLE_ORDER.map((r) => [r, ['N:' + r]])),
    vehicles: { ...Object.fromEntries(['empA', 'empB', 'empC', 'empD', 'sec', 'mgr', 'adm', 'mnt'].map((r) => [r, ['V1', 'V2', 'V3']])), empX: ['VX'] },
  };
  const cols = { trip_requests: 'id', reservations: 'id', trip_participants: 'id', carpool_offers: 'id', carpool_ride_requests: 'id', reservation_messages: 'id', profiles: 'id', notifications: 'id', vehicles: 'id' };

  console.log(`\n##### READ MATRIX (phase=${PHASE}) - observed ids per role; "+" = leaked extra, "-" = missing #####`);
  const matrix = [];
  for (const table of Object.keys(exp)) {
    for (const role of ROLE_ORDER) {
      const r = await rest(U[role].token, 'GET', `${table}?select=${cols[table]}`);
      const got = Array.isArray(r.body) ? r.body.map((x) => lab(x.id)) : [`ERR${r.status}`];
      const want = exp[table][role];
      const extra = got.filter((g) => !want.includes(g));
      const missing = want.filter((w) => !got.includes(w));
      const pass = extra.length === 0 && missing.length === 0;
      matrix.push({ table, role, got, want, extra, missing, pass });
      record(`${table} as ${role}: sees exactly ${JSON.stringify(want)}`, pass, pass ? `${got.length} row(s)` : { extra, missing });
    }
  }
  const anonRead = [];
  for (const table of Object.keys(exp)) {
    const r = await rest(null, 'GET', `${table}?select=id`);
    const rows = Array.isArray(r.body) ? r.body.length : 0;
    anonRead.push([table, r.status, rows]);
    record(`anon key (no session) reads ${table}: 0 rows`, rows === 0, `status=${r.status}`);
  }

  // ---- compact table print
  console.log('\nRole x resource matrix (cell = rows observed / rows expected, "!" when different):');
  const header = ['table'].concat(ROLE_ORDER);
  console.log(header.join('\t'));
  for (const table of Object.keys(exp)) {
    const cells = ROLE_ORDER.map((role) => {
      const m = matrix.find((x) => x.table === table && x.role === role);
      return `${m.got.length}/${m.want.length}${m.pass ? '' : '!'}`;
    });
    console.log([table, ...cells].join('\t'));
  }

  // ---- license / PII columns
  console.log('\n##### profiles PII columns #####');
  for (const role of ROLE_ORDER) {
    const r = await rest(U[role].token, 'GET', 'profiles?select=id,drivers_license_number,drivers_license_category,drivers_license_expiration,license_reminder_6mo_sent_at,driver_authorized');
    const leaked = Array.isArray(r.body) ? r.body.filter((x) => x.drivers_license_number).length : 0;
    const wholeLeak = Array.isArray(r.body) && r.body.some((x) => x.id !== U[role].id && x.drivers_license_number);
    record(`license columns via direct select as ${role}: none readable`, !Array.isArray(r.body) && denied(r) || leaked === 0, `status=${r.status} rowsWithLicenseNumber=${leaked}${wholeLeak ? ' (INCLUDES OTHER USERS)' : ''}`);
    const star = await rest(U[role].token, 'GET', 'profiles?select=*&limit=1');
    if (PHASE === 'after') record(`profiles select=* as ${role} no longer returns license data`, !Array.isArray(star.body) || !star.body.some((x) => 'drivers_license_number' in x), `status=${star.status}`);
  }

  // ---- new definer functions (only meaningful after 0063)
  if (PHASE === 'after') {
    console.log('\n##### definer functions #####');
    for (const role of ROLE_ORDER) {
      const r = await rpc(U[role].token, 'get_my_license');
      const row = Array.isArray(r.body) ? r.body[0] : null;
      record(`get_my_license as ${role}: returns ONLY the caller's own license`, r.ok && Array.isArray(r.body) && r.body.length === 1 && String(row.drivers_license_number).includes(`-${role}-`), `rows=${Array.isArray(r.body) ? r.body.length : msg(r)}`);
    }
    for (const role of ROLE_ORDER) {
      const r = await rpc(U[role].token, 'list_member_licenses');
      const allowed = role === 'mgr' || role === 'adm';
      if (allowed) record(`list_member_licenses as ${role}: org members only (8 rows, no other org)`, r.ok && r.body.length === 8, `rows=${Array.isArray(r.body) ? r.body.length : msg(r)}`);
      else record(`list_member_licenses as ${role}: denied`, !r.ok, `status=${r.status}`);
    }
    const an = await rpc(null, 'list_member_licenses');
    record('list_member_licenses as anon: denied', !an.ok, `status=${an.status}`);
    const an2 = await rpc(null, 'get_my_license');
    record('get_my_license as anon: denied', !an2.ok, `status=${an2.status}`);
    for (const role of ROLE_ORDER) {
      const r = await rpc(U[role].token, 'get_vehicle_busy_windows', {});
      const want = role === 'empX' ? 1 : 3;
      const keys = Array.isArray(r.body) && r.body[0] ? Object.keys(r.body[0]).sort().join(',') : '';
      record(`get_vehicle_busy_windows as ${role}: ${want} org windows with ONLY (end_at,start_at,status,vehicle_id)`, r.ok && r.body.length === want && keys === 'end_at,start_at,status,vehicle_id', { rows: Array.isArray(r.body) ? r.body.length : msg(r), keys });
    }
    const an3 = await rpc(null, 'get_vehicle_busy_windows', {});
    record('get_vehicle_busy_windows as anon: denied', !an3.ok, `status=${an3.status}`);
  }

  // ---- attacks: forged ids, enumeration, direct writes
  console.log('\n##### attacks (forged ids / enumeration / direct write) #####');
  const C = U.empC.token;
  for (const [what, p] of [
    ['trip_requests by forged id', `trip_requests?id=eq.${ids.tA}&select=id,destination,origin`],
    ['reservations by forged id', `reservations?id=eq.${ids.rA}&select=id`],
    ['reservations embedding the host trip', `reservations?id=eq.${ids.rA}&select=id,trip_request:trip_requests(destination,origin)`],
    ['trip_participants enumeration by host trip id', `trip_participants?trip_request_id=eq.${ids.tA}&select=id,passenger_id`],
    ['carpool_offers by id', `carpool_offers?id=eq.${ids.oA}&select=id,host_id`],
    ['carpool_ride_requests by offer id', `carpool_ride_requests?carpool_offer_id=eq.${ids.oA}&select=id,rider_id`],
    ['coworker profile by id', `profiles?id=eq.${U.empA.id}&select=id,full_name`],
    ['coworker trips by destination search (DestA/DestB)', `trip_requests?destination=in.(DestA,DestB)&select=id,destination`],
    ['org-wide trips by requester id', `trip_requests?requester_id=eq.${U.empA.id}&select=id`],
    ['reservation_messages of a coworker thread', `reservation_messages?reservation_id=eq.${ids.rA}&select=id,body`],
  ]) {
    const r = await rest(C, 'GET', p);
    const rows = Array.isArray(r.body) ? r.body.length : -1;
    record(`unrelated employee C: ${what} -> 0 rows`, rows === 0, `status=${r.status} rows=${rows}`);
  }
  const X = U.empX.token;
  for (const [what, p] of [['trip', `trip_requests?id=eq.${ids.tA}&select=id`], ['reservation', `reservations?id=eq.${ids.rA}&select=id`], ['profile', `profiles?id=eq.${U.empA.id}&select=id`], ['offer', `carpool_offers?id=eq.${ids.oA}&select=id`]]) {
    const r = await rest(X, 'GET', p);
    record(`other-org user: ${what} of org A -> 0 rows`, Array.isArray(r.body) && r.body.length === 0, `status=${r.status}`);
  }
  // direct writes by the unrelated employee
  const before = (await sql(`select (select destination from trip_requests where id='${ids.tA}') d, (select count(*) from reservations where id='${ids.rA}') r, (select count(*) from trip_participants where trip_request_id='${ids.tA}') tp`))[0];
  await rest(C, 'PATCH', `trip_requests?id=eq.${ids.tA}`, { destination: 'HACKED' });
  await rest(C, 'DELETE', `reservations?id=eq.${ids.rA}`);
  const ins = await rest(C, 'POST', 'trip_participants', { organization_id: A.orgId, trip_request_id: ids.tA, passenger_id: U.empC.id, passenger_count: 1, status: 'accepted' });
  const insPending = await rest(C, 'POST', 'trip_participants', { organization_id: A.orgId, trip_request_id: ids.tA, passenger_id: U.empC.id, passenger_count: 1, status: 'pending' });
  const after = (await sql(`select (select destination from trip_requests where id='${ids.tA}') d, (select count(*) from reservations where id='${ids.rA}') r, (select count(*) from trip_participants where trip_request_id='${ids.tA}') tp`))[0];
  record('unrelated employee C: PATCH trip / DELETE reservation / forged accepted participant leave ground truth unchanged', before.d === after.d && before.r === after.r && String(after.tp) === String(before.tp), { before, after, insertAccepted: ins.status, insertPending: insPending.status });
  // privilege escalation attempts
  const upd = await rest(C, 'PATCH', `profiles?id=eq.${U.empC.id}`, { role: 'administrator' });
  const role = (await sql(`select role from profiles where id='${U.empC.id}'`))[0].role;
  record('employee cannot self-promote via PATCH profiles', role === 'employee', `patchStatus=${upd.status} roleNow=${role}`);
  const licUpd = await rest(C, 'PATCH', `profiles?id=eq.${U.empC.id}`, { drivers_license_number: 'FORGED' });
  const lic = (await sql(`select drivers_license_number from profiles where id='${U.empC.id}'`))[0].drivers_license_number;
  record('employee cannot overwrite own license via PATCH profiles (writes are server-side only)', lic !== 'FORGED', `patchStatus=${licUpd.status}`);

  // ---- legitimate flows still working for an employee (positives)
  console.log('\n##### positives #####');
  const hostView = await rest(U.empA.token, 'GET', `trip_participants?trip_request_id=eq.${ids.tA}&select=id,passenger:profiles(full_name)`);
  record('host A reads riders on own trip WITH their names', Array.isArray(hostView.body) && hostView.body.length === 1 && hostView.body[0].passenger?.full_name === U.empB.fullName, JSON.stringify(hostView.body));
  const riderView = await rest(U.empB.token, 'GET', `reservations?trip_request_id=eq.${ids.tA}&select=id,trip_request:trip_requests(origin,destination)`);
  record('rider B (accepted) reads host trip + reservation joined', Array.isArray(riderView.body) && riderView.body.length === 1 && riderView.body[0].trip_request?.destination === 'DestA', JSON.stringify(riderView.body).slice(0, 160));
  const msgView = await rest(U.empA.token, 'GET', `reservation_messages?reservation_id=eq.${ids.rA}&select=id,body,sender:profiles(full_name)`);
  record('requester A reads the thread incl. the manager sender NAME', Array.isArray(msgView.body) && msgView.body.length === 2 && msgView.body.every((m) => m.sender?.full_name), JSON.stringify(msgView.body).slice(0, 200));
  const gate = await rest(U.sec.token, 'GET', `reservations?status=eq.confirmed&select=id,trip_request:trip_requests(origin,destination,requester:profiles(full_name)),vehicle:vehicles(plate)`);
  record('security gate query works (route + requester name)', Array.isArray(gate.body) && gate.body.length === 1 && gate.body[0].trip_request?.requester?.full_name === U.empA.fullName, JSON.stringify(gate.body).slice(0, 200));
  const mgrDash = await rest(U.mgr.token, 'GET', `reservations?status=eq.pending_approval&select=id,trip_request:trip_requests(destination,requester:profiles(full_name)),vehicle:vehicles(plate)`);
  record('manager dashboard pending-approval query works', Array.isArray(mgrDash.body) && mgrDash.body.length === 2 && mgrDash.body.every((r) => r.trip_request?.requester?.full_name), JSON.stringify(mgrDash.body).slice(0, 160));
  const wt = await sql(`insert into workflow_tasks (organization_id, vehicle_id, type, notes, assigned_to) values ('${A.orgId}','${A.vehicles[0].id}','safety','t','${U.mnt.id}') returning id`);
  const mntTasks = await rest(U.mnt.token, 'GET', `workflow_tasks?select=id,assignee:profiles!workflow_tasks_assigned_to_fkey(full_name)`);
  record('maintenance operator reads tasks WITH assignee name', Array.isArray(mntTasks.body) && mntTasks.body.length === 1 && mntTasks.body[0].assignee?.full_name === U.mnt.fullName, JSON.stringify(mntTasks.body).slice(0, 160));
  void wt;
  // employee creates a trip through the real RPC, as before (invoker function; notifies managers)
  const dep = new Date(Date.now() + 72 * 3600e3).toISOString(); const ret = new Date(Date.now() + 76 * 3600e3).toISOString();
  const cr = await rpc(U.empC.token, 'create_vehicle_reservation', { p_departure_at: dep, p_expected_return_at: ret, p_origin: 'O', p_destination: 'D', p_distance_km: 5, p_passenger_count: 1, p_requires_cargo: false, p_justification: 'j', p_vehicle_id: A.vehicles[2].id, p_allow_carpool: true });
  const notif = await sql(`select count(*) c from notifications where organization_id='${A.orgId}' and title like 'Nova reserva%'`);
  record('employee create_vehicle_reservation still works AND managers get the notification (invoker function reads manager profiles)', cr.ok && Number(notif[0].c) === 2, { status: cr.status, managersNotified: notif[0].c, err: cr.ok ? undefined : msg(cr) });
  const own = await rest(U.empC.token, 'GET', `reservations?select=id,trip_request:trip_requests(destination)&trip_request.destination=eq.D`);
  record('employee sees the reservation they just created', Array.isArray(own.body) && own.body.length >= 1, `rows=${Array.isArray(own.body) ? own.body.length : msg(own)}`);

  return { matrix };
}

main()
  .catch((err) => record('FATAL (unexpected exception)', false, String(err && err.stack ? err.stack : err)))
  .finally(async () => {
    await cleanupOrgs(orgs);
    const fails = summary('privacy-matrix ' + PHASE);
    process.exitCode = fails > 0 ? 1 : 0;
  });
