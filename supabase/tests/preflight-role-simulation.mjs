#!/usr/bin/env node
// Preflight role simulation for PENDING (tightening) migrations. Reusable: takes one or more migration files.
//
//   node supabase/tests/preflight-role-simulation.mjs supabase/migrations-pending/0066_x.sql [more.sql ...] [--suite m1,m2,l5]
//
// For each run it sends ONE Management-API request that executes, inside a single transaction that is ALWAYS
// rolled back (nothing is left applied, no auth user / org survives):
//     begin; <disposable scenario: org + 9 users + trips/offers/requests/...>; [<migration files>];
//     for every check: set local role <anon|authenticated|service_role>; set_config('request.jwt.claims', ...);
//     run the check (errors captured per check); reset role; ... ; select the collected outcomes; rollback;
// The same suite is run BEFORE (baseline = what production does today) and WITH the migration, and the two
// outcomes are printed side by side with the expectation (the expectation describes the post-migration design).
// Suites: `core` (queries the deployed app AND the new app run, per role, incl. the 5 REAL profiles read-only)
// always runs; `m1`, `m2`, `l5` are selected from the file name (or --suite).
// Exit code 1 when any WITH-migration expectation fails.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from './lib/live.mjs';

const args = process.argv.slice(2);
const files = args.filter((a, i) => a.endsWith('.sql') && args[i - 1] !== '--rollback');
const suiteArg = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : null;
// --rollback a_rollback.sql,b_rollback.sql : also runs <migration + rollback> in the same rolled-back transaction and
// asserts every check returns EXACTLY the baseline result (the rollback file really restores today's behaviour).
const rollbackFiles = args.includes('--rollback') ? args[args.indexOf('--rollback') + 1].split(',') : [];
if (files.length === 0) { console.error('usage: preflight-role-simulation.mjs <migration.sql>... [--suite m1,m2,l5]'); process.exit(2); }

// ------------------------------------------------------------------------------------------------ scenario
const uid = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = uid(1), ORG2 = uid(2);
export const U = { host: uid(11), rA: uid(12), rP: uid(13), rL: uid(14), rX: uid(15), sec: uid(16), mgr: uid(17), adm: uid(18), mnt: uid(19), other: uid(20) };
const T = { host: uid(31), x: uid(32), other: uid(33) };
const R = { host: uid(41), x: uid(42), other: uid(43) };
const OFFER = uid(51), RR_A = uid(61), RR_P = uid(62), TP_A = uid(71), TP_L = uid(72), MSG = uid(81), CAT = uid(91), CAT2 = uid(92);
const V = { 1: uid(93), 2: uid(94), 3: uid(95), 4: uid(96), o: uid(97) };
export const IDS = { ORG, ORG2, T, R, OFFER, RR_A, RR_P, TP_A, TP_L, MSG, V, U };

function scenarioSql() {
  const roles = { host: 'employee', rA: 'employee', rP: 'employee', rL: 'employee', rX: 'employee', sec: 'security', mgr: 'fleet_manager', adm: 'administrator', mnt: 'maintenance_operator' };
  const out = [];
  out.push(`insert into organizations (id, name) values ('${ORG}', 'SIM-ORG'), ('${ORG2}', 'SIM-ORG-OTHER');`);
  out.push(`insert into organization_settings (organization_id) values ('${ORG}'), ('${ORG2}') on conflict do nothing;`);
  for (const [k, role] of Object.entries(roles)) {
    out.push(`insert into auth.users (id, aud, role, email) values ('${U[k]}', 'authenticated', 'authenticated', 'sim-${k}@fleet-test.invalid');`);
    out.push(`insert into profiles (id, organization_id, full_name, role, drivers_license_number, drivers_license_category, drivers_license_expiration, driver_authorized) values ('${U[k]}', '${ORG}', 'SIM ${k}', '${role}', 'LIC-${k}', 'B', '2031-01-01', true);`);
  }
  out.push(`insert into auth.users (id, aud, role, email) values ('${U.other}', 'authenticated', 'authenticated', 'sim-other@fleet-test.invalid');`);
  out.push(`insert into profiles (id, organization_id, full_name, role, drivers_license_number, drivers_license_category, drivers_license_expiration, driver_authorized) values ('${U.other}', '${ORG2}', 'SIM other', 'employee', 'LIC-o', 'B', '2031-01-01', true);`);
  out.push(`insert into vehicle_categories (id, organization_id, name, passenger_capacity, energy_type) values ('${CAT}', '${ORG}', 'SIM SUV', 5, 'ICE'), ('${CAT2}', '${ORG2}', 'SIM SUV2', 5, 'ICE');`);
  for (const n of [1, 2, 3, 4]) out.push(`insert into vehicles (id, organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km) values ('${V[n]}', '${ORG}', 'SIM${n}', '${CAT}', 'available', 1000, 80, 600, 20000);`);
  out.push(`insert into vehicles (id, organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km) values ('${V.o}', '${ORG2}', 'SIMO', '${CAT2}', 'available', 1000, 80, 600, 20000);`);
  const trip = (id, org, who, dest, h) => `insert into trip_requests (id, organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, allow_carpool) values ('${id}', '${org}', '${who}', now() + interval '${h} hours', now() + interval '${h + 4} hours', 'ORIGEM-SECRETA-${dest}', 'DEST-${dest}', 20, 1, false, 'JUSTIF-SECRETA-${dest}', true);`;
  out.push(trip(T.host, ORG, U.host, 'host', 24), trip(T.x, ORG, U.rX, 'x', 24), trip(T.other, ORG2, U.other, 'other', 24));
  const res = (id, org, veh, t, st, h) => `insert into reservations (id, organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${id}', '${org}', '${veh}', '${t}', '${st}', now() + interval '${h} hours', now() + interval '${h + 4} hours');`;
  out.push(res(R.host, ORG, V[1], T.host, 'confirmed', 24), res(R.x, ORG, V[2], T.x, 'pending_approval', 24), res(R.other, ORG2, V.o, T.other, 'pending_approval', 24));
  out.push(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${ORG}', 1, 15, 15, 5, 15, 30);`);
  out.push(`insert into carpool_offers (id, organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) values ('${OFFER}', '${ORG}', '${T.host}', '${U.host}', 'active', 3, 2, 1);`);
  const rr = (id, rider, st) => `insert into carpool_ride_requests (id, organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location, requested_departure_at, status, policy_version, match_additional_distance_km, match_additional_time_min) values ('${id}', '${ORG}', '${OFFER}', '${rider}', 1, '{"label":"Rua do Rider 10, Sao Paulo"}', '{"label":"Av Destino 20, Sao Paulo"}', now() + interval '24 hours', '${st}', 1, 1.2, 3);`;
  out.push(rr(RR_A, U.rA, 'ACCEPTED'), rr(RR_P, U.rP, 'PENDING'));
  out.push(`insert into trip_participants (id, organization_id, trip_request_id, passenger_id, passenger_count, status) values ('${TP_A}', '${ORG}', '${T.host}', '${U.rA}', 1, 'accepted'), ('${TP_L}', '${ORG}', '${T.host}', '${U.rL}', 1, 'pending');`);
  out.push(`insert into reservation_messages (id, organization_id, reservation_id, sender_id, message_type, body) values ('${MSG}', '${ORG}', '${R.host}', '${U.host}', 'text', 'msg do host');`);
  for (const k of Object.keys(roles)) out.push(`insert into notifications (organization_id, user_id, title, body) values ('${ORG}', '${U[k]}', 'N-${k}', 'b');`);
  return out.join('\n');
}

// ------------------------------------------------------------------------------------------------ checks
// check = { id, role: <U key | 'anon' | 'service_role' | 'real:<n>'>, label, sql, kind?: 'select'|'dml', expect }
// expect: { rows: n } | { rowsMin: n } | { error: true|'42501' } | { ok: true } | { same: true } (WITH == baseline)
export function checksFor(suites, real) {
  const c = [];
  const add = (suite, id, role, label, sqlText, expect, kind = 'select') => c.push({ suite, id, role, label, sql: sqlText, expect, kind });
  const own = (k) => `'${U[k]}'`;

  // ---- core: what the deployed app (86dc094) and the new app read/write, per role -------------
  for (const k of ['host', 'rA', 'rP', 'rX', 'sec', 'mgr', 'adm', 'mnt']) {
    add('core', `core.${k}.profile`, k, 'own profile (id, name, role, org, zoom, avatar)', `select id, full_name, role, organization_id, gantt_zoom_preference, avatar_url from profiles where id = ${own(k)}`, { rows: 1 });
    add('core', `core.${k}.my_license`, k, 'get_my_license()', 'select * from get_my_license()', { rows: 1 });
    add('core', `core.${k}.notif_read`, k, 'own notifications', `select id from notifications where user_id = ${own(k)}`, { rowsMin: 1 });
    add('core', `core.${k}.notif_self`, k, 'insert notification addressed to self', `insert into notifications (organization_id, user_id, title, body) values ('${ORG}', ${own(k)}, 'self', 'b')`, { ok: true }, 'dml');
    add('core', `core.${k}.busy`, k, 'get_vehicle_busy_windows()', 'select * from get_vehicle_busy_windows()', { rowsMin: 1 });
    add('core', `core.${k}.vehicles`, k, 'vehicles of the org', 'select id, plate, status from vehicles', { rowsMin: 4 });
  }
  for (const k of ['mgr', 'adm']) add('core', `core.${k}.lic_list`, k, 'list_member_licenses()', 'select * from list_member_licenses()', { rowsMin: 9 });
  for (const k of ['host', 'rX', 'sec', 'mnt']) add('core', `core.${k}.lic_list`, k, 'list_member_licenses() refused', 'select * from list_member_licenses()', { error: '42501' });
  add('core', 'core.host.trips', 'host', 'own trips + reservation join (trips page)', `select r.id, tr.destination from reservations r join trip_requests tr on tr.id = r.trip_request_id where tr.requester_id = ${own('host')}`, { rows: 1 });
  add('core', 'core.host.riders', 'host', 'riders/passengers names visible (My Trip carpool section)', `select id, full_name from profiles where id in ('${U.rA}', '${U.rP}', '${U.rL}')`, { rows: 3 });
  add('core', 'core.host.requests', 'host', 'ride requests on own offer', `select id, status from carpool_ride_requests where carpool_offer_id = '${OFFER}'`, { rows: 2 });
  add('core', 'core.host.places', 'host', 'host_ride_request_places(own trip)', `select request_id, status, pickup_label, is_exact from host_ride_request_places('${T.host}')`, { rowsMin: 1 });
  add('core', 'core.host.msgs', 'host', 'reservation messages of own reservation', `select id from reservation_messages where reservation_id = '${R.host}'`, { rows: 1 });
  add('core', 'core.rP.own_requests', 'rP', 'own ride requests (trips page)', `select id, status, carpool_offer_id from carpool_ride_requests where rider_id = ${own('rP')}`, { rows: 1 });
  add('core', 'core.rA.own_requests', 'rA', 'own ride requests (trips page)', `select id, status from carpool_ride_requests where rider_id = ${own('rA')}`, { rows: 1 });
  add('core', 'core.rA.joined_trip', 'rA', 'accepted rider: joined trip row + reservation (trips page Gantt)', `select r.id, tr.destination from reservations r join trip_requests tr on tr.id = r.trip_request_id where r.trip_request_id = '${T.host}'`, { rows: 1 });
  add('core', 'core.rX.own_trip', 'rX', 'own trip + reservation', `select r.id from reservations r join trip_requests tr on tr.id = r.trip_request_id where tr.requester_id = ${own('rX')}`, { rows: 1 });
  add('core', 'core.rX.nodir', 'rX', 'unrelated employee: no coworker trips / reservations / offers', `select id from trip_requests where requester_id <> ${own('rX')} union all select id from reservations where trip_request_id <> '${T.x}' union all select id from carpool_offers`, { rows: 0 });
  add('core', 'core.mgr.trips', 'mgr', 'manager sees all org trips', 'select id from trip_requests', { rows: 2 });
  add('core', 'core.sec.trips', 'sec', 'security sees all org trips (gate worklist)', 'select id from trip_requests', { rows: 2 });
  add('core', 'core.mnt.trips', 'mnt', 'maintenance operator sees no trips', 'select id from trip_requests', { rows: 0 });
  add('core', 'core.other.org', 'other', 'other-org user sees nothing of the org', `select id from trip_requests where organization_id = '${ORG}' union all select id from profiles where organization_id = '${ORG}' union all select id from notifications where organization_id = '${ORG}'`, { rows: 0 });
  // real profiles: read-only counts (no PII printed), baseline must equal WITH-migration
  (real ?? []).forEach((p, i) => {
    const r = `real:${i}`;
    add('core', `real${i}.${p.role}.own`, r, `REAL ${p.role}: own profile + license RPC`, `select (select count(*) from profiles where id = '${p.id}') own, (select count(*) from get_my_license()) lic`, { same: true });
    add('core', `real${i}.${p.role}.counts`, r, `REAL ${p.role}: trips / reservations / notifications / offers / participants / requests counts`, `select (select count(*) from trip_requests) trips, (select count(*) from reservations) reservations, (select count(*) from notifications) notifs, (select count(*) from carpool_offers) offers, (select count(*) from trip_participants) participants, (select count(*) from carpool_ride_requests) requests, (select count(*) from profiles) profiles, (select count(*) from vehicles) vehicles`, { same: true });
    add('core', `real${i}.${p.role}.notif_self`, r, `REAL ${p.role}: insert notification to self (rolled back)`, `insert into notifications (organization_id, user_id, title, body) select organization_id, id, 'sim', 'sim' from profiles where id = '${p.id}'`, { ok: true }, 'dml');
    if (p.role === 'administrator') add('core', `real${i}.${p.role}.lic_list`, r, 'REAL administrator: list_member_licenses() row count', 'select count(*) n from list_member_licenses()', { same: true });
  });

  // ---- m1: PENDING rider must not read the host's trip --------------------------------------------
  const hostTripCols = `id, origin, destination, justification, departure_at`;
  add('m1', 'm1.rP.trip', 'rP', 'PENDING rider reads host trip_requests row (origin/destination/justification)', `select ${hostTripCols} from trip_requests where id = '${T.host}'`, { rows: 0 });
  add('m1', 'm1.rP.reservation', 'rP', 'PENDING rider reads host reservation rows', `select id, vehicle_id, status from reservations where trip_request_id = '${T.host}'`, { rows: 0 });
  add('m1', 'm1.rP.hostname', 'rP', 'PENDING rider reads the host profile (name)', `select id, full_name from profiles where id = '${U.host}'`, { rows: 0 });
  add('m1', 'm1.rP.offer', 'rP', 'PENDING rider reads the host offer row (host_id, seats)', `select id, host_id, seats_available from carpool_offers where id = '${OFFER}'`, { rows: 0 });
  add('m1', 'm1.rP.msgs', 'rP', 'PENDING rider reads the host reservation messages', `select id from reservation_messages where reservation_id = '${R.host}'`, { rows: 0 });
  add('m1', 'm1.rP.participants', 'rP', 'PENDING rider reads trip_participants of the host trip', `select id from trip_participants where trip_request_id = '${T.host}'`, { rows: 0 });
  add('m1', 'm1.rP.own', 'rP', 'PENDING rider still reads OWN ride request + places label is not exposed to rider', `select id, status from carpool_ride_requests where rider_id = ${own('rP')}`, { rows: 1 });
  add('m1', 'm1.rL.trip', 'rL', 'legacy PENDING participant reads host trip', `select ${hostTripCols} from trip_requests where id = '${T.host}'`, { rows: 0 });
  add('m1', 'm1.rL.hostname', 'rL', 'legacy PENDING participant reads host profile', `select id, full_name from profiles where id = '${U.host}'`, { rows: 0 });
  add('m1', 'm1.rA.trip', 'rA', 'ACCEPTED rider reads host trip (kept: needed for the trip they joined)', `select ${hostTripCols} from trip_requests where id = '${T.host}'`, { rows: 1 });
  add('m1', 'm1.rA.reservation', 'rA', 'ACCEPTED rider reads host reservation (Gantt bar)', `select id, status from reservations where trip_request_id = '${T.host}'`, { rows: 1 });
  add('m1', 'm1.rA.hostname', 'rA', 'ACCEPTED rider reads host name', `select id, full_name from profiles where id = '${U.host}'`, { rows: 1 });
  add('m1', 'm1.rA.offer', 'rA', 'ACCEPTED rider reads the offer (trips page embed)', `select id from carpool_offers where id = '${OFFER}'`, { rows: 1 });
  add('m1', 'm1.rA.justification', 'rA', 'ACCEPTED rider can still read host justification (documented, accepted residual)', `select justification from trip_requests where id = '${T.host}'`, { rows: 1 });
  add('m1', 'm1.host.all', 'host', 'host still reads own trip / riders / participants / offer', `select (select count(*) from trip_requests where id = '${T.host}') t, (select count(*) from profiles where id in ('${U.rA}','${U.rP}','${U.rL}')) riders, (select count(*) from trip_participants where trip_request_id = '${T.host}') p, (select count(*) from carpool_offers) o`, { same: true });
  add('m1', 'm1.rX.none', 'rX', 'unrelated employee reads nothing of the host', `select id from trip_requests where id = '${T.host}' union all select id from profiles where id = '${U.host}'`, { rows: 0 });
  for (const k of ['sec', 'mgr', 'adm']) add('m1', `m1.${k}.trip`, k, `${k} still reads the host trip`, `select id from trip_requests where id = '${T.host}'`, { rows: 1 });

  // ---- m2: notifications INSERT policy ------------------------------------------------------------
  const q1 = (t) => `'${String(t).replace(/'/g, "''")}'`;
  const ins = (to, title, extra = '', body = 'corpo') => `insert into notifications (organization_id, user_id, title, body${extra ? ', entity_type, entity_id' : ''}) values ('${ORG}', '${to}', ${q1(title)}, ${q1(body)}${extra})`;
  const TPL_RES = (d) => `Uma nova viagem para ${d} aguarda aprovação.`;
  const TPL_JOIN = (d) => `Alguém pediu para participar da sua viagem para ${d}. Acesse os detalhes da reserva para aceitar ou recusar.`;
  add('m2', 'm2.rX.spoof_coworker', 'rX', 'employee -> coworker employee, arbitrary title (SPOOF)', ins(U.rA, 'Sua conta foi bloqueada - clique aqui'), { error: true }, 'dml');
  add('m2', 'm2.rX.spoof_host_arbitrary', 'rX', 'employee -> unrelated employee host, arbitrary title', ins(U.host, 'Aviso do RH'), { error: true }, 'dml');
  add('m2', 'm2.rX.spoof_admin', 'rX', 'employee -> administrator, arbitrary title (residual vector, must be constrained)', ins(U.adm, 'URGENTE: aprove tudo'), { error: true }, 'dml');
  add('m2', 'm2.rX.spoof_admin_link', 'rX', 'employee -> administrator with fixed title but forged entity link', ins(U.adm, 'Nova reserva aguardando aprovação', `, 'reservation', '${R.x}'`), { error: true }, 'dml');
  add('m2', 'm2.rX.notify_admin_fixed', 'rX', 'employee -> administrator with the fixed system title (residual, allowed)', ins(U.adm, 'Nova reserva aguardando aprovação', '', TPL_RES('Destino X')), { ok: true }, 'dml');
  add('m2', 'm2.rX.fixed_title_free_body', 'rX', 'employee -> administrator, fixed title but FREE-TEXT body (spoof, closed by the exact-template guard)', ins(U.adm, 'Nova reserva aguardando aprovação', '', 'Clique aqui e confirme sua senha'), { error: true }, 'dml');
  add('m2', 'm2.rX.long_dest_template', 'rX', 'employee -> administrator, template with a ~900-char destination (deployed code does not clamp: must still pass)', ins(U.adm, 'Nova reserva aguardando aprovação', '', TPL_RES('D'.repeat(900))), { ok: true }, 'dml');
  add('m2', 'm2.rX.too_long_body', 'rX', 'employee -> administrator, body over 1000 chars refused', ins(U.adm, 'Nova reserva aguardando aprovação', '', TPL_RES('D'.repeat(1100))), { error: true }, 'dml');
  add('m2', 'm2.rA.join_template_to_host', 'rA', 'participant -> host with the exact carpool-join template (create_carpool_participation text)', ins(U.host, 'Pedido de carona na sua viagem', '', TPL_JOIN('Destino Y')), { ok: true }, 'dml');
  add('m2', 'm2.rA.join_free_body', 'rA', 'participant -> host, join title with a free-text body refused', ins(U.host, 'Pedido de carona na sua viagem', '', 'Pague agora'), { error: true }, 'dml');
  add('m2', 'm2.rX.cross_org', 'rX', 'employee -> user of another org', `insert into notifications (organization_id, user_id, title, body) values ('${ORG2}', '${U.other}', 'x', 'y')`, { error: true }, 'dml');
  add('m2', 'm2.rP.notify_host_arbitrary', 'rP', 'rider with a PENDING request -> host, arbitrary title', ins(U.host, 'Mensagem falsa'), { error: true }, 'dml');
  add('m2', 'm2.mgr.notify_anyone', 'mgr', 'fleet_manager -> employee (approve/cancel flows)', ins(U.rX, 'Reserva aprovada'), { ok: true }, 'dml');
  add('m2', 'm2.adm.notify_anyone', 'adm', 'administrator -> employee', ins(U.rX, 'Qualquer'), { ok: true }, 'dml');
  add('m2', 'm2.sec.notify_anyone', 'sec', 'security -> employee', ins(U.rX, 'Qualquer'), { ok: true }, 'dml');
  add('m2', 'm2.mnt.notify_anyone', 'mnt', 'maintenance_operator is staff for notification inserts (like security)', ins(U.rX, 'Qualquer'), { ok: true }, 'dml');
  add('m2', 'm2.anon', 'anon', 'anon insert', ins(U.rX, 'x'), { error: true }, 'dml');
  add('m2', 'm2.service.admin_client', 'service_role', 'admin client (autoReassignment, license reminders) -> employee', ins(U.rX, 'Veículo reatribuído automaticamente'), { ok: true }, 'dml');
  // real flows under the new policy
  add('m2', 'm2.flow.create_reservation', 'rA', 'create_vehicle_reservation (employee JWT) notifies managers', `select create_vehicle_reservation(now() + interval '72 hours', now() + interval '76 hours', 'Origem F', 'Destino F', 20, 1, false, 'justificativa', '${V[3]}', false)`, { ok: true });
  add('m2', 'm2.flow.mgr_got_notified', 'mgr', 'manager received the new-reservation notification', `select id from notifications where user_id = ${own('mgr')} and title = 'Nova reserva aguardando aprovação'`, { rowsMin: 1 });
  add('m2', 'm2.flow.approve', 'mgr', 'approve_reservation notifies the requester', `select approve_reservation('${R.x}')`, { ok: true });
  add('m2', 'm2.flow.requester_notified', 'rX', 'requester received "Reserva aprovada"', `select id from notifications where user_id = ${own('rX')} and title = 'Reserva aprovada'`, { rowsMin: 1 });
  add('m2', 'm2.flow.block_vehicle', 'mgr', 'block_vehicle notifies managers', `select block_vehicle('${V[4]}', 'sim')`, { ok: true });
  add('m2', 'm2.flow.block_by_maintenance', 'mnt', 'block_vehicle by a maintenance_operator notifies the managers (was refused by the first guard draft)', `select block_vehicle('${V[3]}', 'sim mnt')`, { ok: true });
  add('m2', 'm2.flow.cancel_by_manager', 'mgr', 'cancel_reservation by a manager (definer) notifies the requester', `select cancel_reservation('${R.x}', 'sim')`, { ok: true });
  add('m2', 'm2.flow.message', 'host', 'post_reservation_message (definer) notifies', `select post_reservation_message('${R.host}', 'text', 'ola', null)`, { ok: true });
  add('m2', 'm2.flow.carpool_accept', 'host', 'accept_carpool_ride_request (definer + event notifier) notifies the rider', `select accept_carpool_ride_request('${RR_P}')`, { ok: true });
  add('m2', 'm2.flow.carpool_notified', 'rP', 'rider received the carpool notification', `select id from notifications where user_id = ${own('rP')} and title <> 'N-rP'`, { rowsMin: 1 });
  add('m2', 'm2.flow.carpool_reject', 'rA', 'cancel_carpool_ride_request by the rider (definer) notifies the host', `select cancel_carpool_ride_request('${RR_A}')`, { ok: true });
  add('m2', 'm2.flow.host_notified', 'host', 'host received the carpool notification', `select id from notifications where user_id = ${own('host')} and title <> 'N-host'`, { rowsMin: 1 });
  add('m2', 'm2.flow.host_changes_trip', 'host', 'host edits the trip destination: revalidation trigger (definer) notifies', `update trip_requests set destination = 'NOVO-DESTINO' where id = '${T.host}'`, { ok: true }, 'dml');
  add('m2', 'm2.flow.legacy_join', 'rX', 'legacy create_carpool_participation on a coworker trip (documented L3: refused)', `select create_carpool_participation(now() + interval '24 hours', now() + interval '28 hours', 'a', 'b', 10, 1, false, 'j', '${T.host}')`, { error: true });

  // ---- l5: anon privileges ---------------------------------------------------------------------------
  for (const t of ['vehicles', 'organizations', 'workflow_tasks', 'vehicle_categories', 'vehicle_locations', 'organization_settings', 'safety_equipment_items', 'inspection_photos', 'audit_log', 'chat_conversations', 'chat_messages']) {
    add('l5', `l5.anon.${t}`, 'anon', `anon select ${t} (must be a permission error after the revoke)`, `select count(*) from ${t}`, { error: '42501' });
  }
  add('l5', 'l5.auth.truncate', 'rX', 'authenticated no longer holds TRUNCATE on notifications (the verb ignores RLS)', "select 1 where has_table_privilege('authenticated', 'public.notifications', 'TRUNCATE')", { rows: 0 });
  add('l5', 'l5.anon.truncate', 'anon', 'anon no longer holds TRUNCATE on vehicles', "select 1 where has_table_privilege('anon', 'public.vehicles', 'TRUNCATE')", { rows: 0 });
  add('l5', 'l5.auth.vehicles', 'rX', 'authenticated still reads vehicles', 'select id from vehicles', { rowsMin: 4 });
  add('l5', 'l5.auth.organizations', 'rX', 'authenticated still reads own organization', `select id, name from organizations where id = '${ORG}'`, { rows: 1 });
  add('l5', 'l5.auth.categories', 'rX', 'authenticated still reads vehicle categories', 'select id from vehicle_categories', { rowsMin: 1 });
  add('l5', 'l5.service.vehicles', 'service_role', 'service role (admin client: signup, cron, reassignment) unaffected', 'select count(*) n from vehicles', { ok: true });
  add('l5', 'l5.service.org', 'service_role', 'service role can create an organization (signup)', `insert into organizations (name) values ('SIM-SIGNUP')`, { ok: true }, 'dml');
  // ---- l5 (ACL based): after 0069 anon holds NOTHING on public relations and authenticated holds no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
  const relAcl = (who, privs) => `select c.relname, a.privilege_type from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault(case c.relkind when 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S') and a.grantee = (select oid from pg_roles where rolname = '${who}')${privs ? ` and a.privilege_type in (${privs})` : ''}`;
  add('l5', 'l5.acl.anon_nothing', 'rX', 'ACL: anon holds NO privilege (incl. MAINTAIN) on any public table / view / sequence', relAcl('anon'), { rows: 0 });
  add('l5', 'l5.acl.auth_no_dangerous', 'rX', 'ACL: authenticated holds no TRUNCATE / REFERENCES / TRIGGER / MAINTAIN on any public relation', relAcl('authenticated', "'TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'"), { rows: 0 });
  add('l5', 'l5.acl.auth_keeps_crud', 'rX', 'ACL: authenticated still has SELECT on vehicles and notifications', "select 1 from pg_class c cross join lateral aclexplode(c.relacl) a where c.relname = 'notifications' and c.relnamespace = 'public'::regnamespace and a.privilege_type = 'SELECT' and a.grantee = (select oid from pg_roles where rolname = 'authenticated')", { rowsMin: 1 });
  // ---- f5 (0070): objects created AFTER the migration are not exposed to anon / authenticated until granted explicitly
  for (const [role, who] of [['anon', 'anon'], ['rX', 'authenticated']]) {
    add('f5', `f5.${who}.new_table`, role, `throwaway table created after the migration is NOT readable by ${who}`, 'select * from public.zz_probe_t', { error: '42501' });
    add('f5', `f5.${who}.new_function`, role, `throwaway function created after the migration is NOT callable by ${who}`, 'select public.zz_probe_fn()', { error: '42501' });
    add('f5', `f5.${who}.new_sequence`, role, `throwaway sequence created after the migration is NOT usable by ${who}`, "select nextval('public.zz_probe_seq')", { error: '42501' });
  }
  add('f5', 'f5.service.new_table', 'service_role', 'service role (admin client) still reaches new tables', 'select * from public.zz_probe_t', { ok: true });
  add('f5', 'f5.service.new_function', 'service_role', 'service role still calls new functions', 'select public.zz_probe_fn()', { ok: true });
  add('f5', 'f5.grant_works', 'rX', 'an explicit GRANT after the migration works (workflow for new objects): table granted to authenticated is readable', "select 1 from public.zz_probe_granted", { ok: true });
  // ---- s1: internal SECURITY DEFINER RPCs must not be callable by anon / employees ----------------------
  add('s1', 's1.rX.promote_self', 'rX', 'EMPLOYEE calls update_member_role(own org, self, administrator) (privilege escalation)', `select update_member_role('${ORG}', ${own('rX')}, 'administrator')`, { error: '42501' });
  add('s1', 's1.rX.promote_check', 'rX', 'employee role after the attempt (must still be employee)', `select role from profiles where id = ${own('rX')} and role = 'employee'`, { rows: 1 });
  add('s1', 's1.anon.promote', 'anon', 'ANON calls update_member_role', `select update_member_role('${ORG}', '${U.rX}', 'administrator')`, { error: '42501' });
  add('s1', 's1.anon.demote_admin', 'anon', 'ANON demotes the administrator', `select update_member_role('${ORG}', '${U.adm}', 'employee')`, { error: '42501' });
  add('s1', 's1.rX.lock_admins', 'rX', 'employee calls lock_and_require_multiple_administrators (row locks on administrators)', `select lock_and_require_multiple_administrators('${ORG}')`, { error: '42501' });
  add('s1', 's1.rX.auto_reassign', 'rX', 'employee calls auto_reassign_reservation_vehicle on a coworker reservation', `select auto_reassign_reservation_vehicle('${ORG}', '${R.host}', '${V[3]}')`, { error: '42501' });
  add('s1', 's1.anon.auto_reassign', 'anon', 'anon calls auto_reassign_reservation_vehicle', `select auto_reassign_reservation_vehicle('${ORG}', '${R.host}', '${V[3]}')`, { error: '42501' });
  add('s1', 's1.anon.forge_audit', 'anon', 'ANON writes a forged audit_log row (log_audit_event has no uid => guard skipped)', `select log_audit_event('${ORG}', '${U.adm}', 'forged_by_anon', 'x', null, null, null)`, { error: '42501' });
  add('s1', 's1.rX.audit_mismatch', 'rX', 'employee forging an audit row for another actor (guard: stays refused)', `select log_audit_event('${ORG}', '${U.adm}', 'forged', 'x', null, null, null)`, { error: true });
  add('s1', 's1.adm.audit_own', 'adm', 'administrator logs an audit event as itself (settings/actions.ts user-client path)', `select log_audit_event('${ORG}', ${own('adm')}, 'settings_changed', 'organization_settings', null, null, null)`, { ok: true });
  add('s1', 's1.svc.update_role', 'service_role', 'service role (admin client) can still change a role (users/actions.ts)', `select update_member_role('${ORG}', '${U.mnt}', 'employee')`, { ok: true });
  add('s1', 's1.svc.lock_admins', 'service_role', 'service role can still lock/count administrators', `select lock_and_require_multiple_administrators('${ORG}')`, { error: true });
  add('s1', 's1.svc.audit', 'service_role', 'service role can still log audit events', `select log_audit_event('${ORG}', '${U.adm}', 'role_changed', 'profile', null, null, null)`, { ok: true });
  add('s1', 's1.svc.reassign', 'service_role', 'service role can still auto-reassign (autoReassignment.ts admin client)', `select auto_reassign_reservation_vehicle('${ORG}', '${R.x}', '${V[3]}')`, { notDenied: true });
  add('s1', 's1.rX.create_reservation', 'rX', 'normal employee RPC still works (create_vehicle_reservation)', `select create_vehicle_reservation(now() + interval '90 hours', now() + interval '94 hours', 'O', 'D', 10, 1, false, 'j', '${V[3]}', false)`, { ok: true });
  add('s1', 's1.anon.create_reservation', 'anon', 'anon create_vehicle_reservation (refused)', `select create_vehicle_reservation(now() + interval '90 hours', now() + interval '94 hours', 'O', 'D', 10, 1, false, 'j', '${V[3]}', false)`, { error: true });
  return c.filter((x) => suites.includes(x.suite));
}

// ------------------------------------------------------------------------------------------------ runner
const claimsFor = (role, real) => {
  if (role === 'anon') return { jwtRole: 'anon', claims: '{"role":"anon"}' };
  if (role === 'service_role') return { jwtRole: 'service_role', claims: '{"role":"service_role"}' };
  if (role.startsWith('real:')) { const p = real[Number(role.slice(5))]; return { jwtRole: 'authenticated', claims: JSON.stringify({ sub: p.id, role: 'authenticated' }) }; }
  return { jwtRole: 'authenticated', claims: JSON.stringify({ sub: U[role], role: 'authenticated' }) };
};
const F5_SETUP = `create table public.zz_probe_t (id int); insert into public.zz_probe_t values (1);
create function public.zz_probe_fn() returns int language sql as 'select 1';
create sequence public.zz_probe_seq;
create table public.zz_probe_granted (id int); insert into public.zz_probe_granted values (1);
grant select on public.zz_probe_granted to authenticated;`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ACL snapshot (text, sorted): every function ACL, every relation ACL (tables, views, sequences), every column ACL and every
// default ACL, as stored in pg_proc.proacl / pg_class.relacl / pg_attribute.attacl / pg_default_acl. NULL = built-in default.
const aclSql = (id) => `insert into pg_temp.sim_out(id, result) select '${id}', coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (
  select 'F ' || p.oid::regprocedure::text || ' = ' || coalesce((select string_agg(i::text, ',' order by i::text) from unnest(p.proacl) i), 'NULL') as x from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all select 'R ' || c.oid::regclass::text || ' (' || c.relkind::text || ') = ' || coalesce((select string_agg(i::text, ',' order by i::text) from unnest(c.relacl) i), 'NULL') from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S')
  union all select 'C ' || c.oid::regclass::text || '.' || a.attname || ' = ' || (select string_agg(i::text, ',' order by i::text) from unnest(a.attacl) i) from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null
  union all select 'D ' || d.defaclrole::regrole::text || ' / ' || coalesce(d.defaclnamespace::regnamespace::text, '*') || ' / ' || d.defaclobjtype::text || ' = ' || (select string_agg(i::text, ',' order by i::text) from unnest(d.defaclacl) i) from pg_default_acl d
) t(x);`;

function buildTransaction(checks, real, migrationSql, setupSql) {
  const parts = ['begin;', 'create temp table sim_out(seq serial, id text, result jsonb);', 'grant all on pg_temp.sim_out to public;', 'grant usage, select on all sequences in schema pg_temp to public;', scenarioSql()];
  parts.push(aclSql('__acl0'));
  if (migrationSql) parts.push(migrationSql);
  parts.push(aclSql('__acl1'));
  if (setupSql) parts.push(setupSql);
  for (const ch of checks) {
    const { jwtRole, claims } = claimsFor(ch.role, real);
    const body = ch.kind === 'dml'
      ? `execute $q$ ${ch.sql} $q$; get diagnostics n = row_count; insert into pg_temp.sim_out(id, result) values (${lit(ch.id)}, jsonb_build_object('ok', true, 'rowcount', n));`
      : `execute $q$ select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (${ch.sql}) s $q$ into r; insert into pg_temp.sim_out(id, result) values (${lit(ch.id)}, jsonb_build_object('ok', true, 'rows', r));`;
    parts.push(`set local role ${jwtRole};`, `select set_config('request.jwt.claims', ${lit(claims)}, true);`,
      `do $do$ declare r jsonb; n int; begin begin ${body} exception when others then insert into pg_temp.sim_out(id, result) values (${lit(ch.id)}, jsonb_build_object('ok', false, 'error', sqlerrm, 'code', sqlstate)); end; end $do$;`, 'reset role;');
  }
  parts.push('select id, result from pg_temp.sim_out order by seq;', 'rollback;');
  return parts.join('\n');
}

const summarize = (res) => {
  if (!res) return '(missing)';
  if (res.ok === false) return `ERROR ${res.code}: ${String(res.error).slice(0, 70)}`;
  if (res.rows) {
    if (res.rows.length === 1 && Object.values(res.rows[0]).every((v) => typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v))) return `1 row ${JSON.stringify(res.rows[0])}`;
    return `${res.rows.length} row(s)`;
  }
  return `ok (${res.rowcount ?? 0} row)`;
};
const rowsOf = (res) => (res && res.ok !== false && res.rows ? res.rows.length : null);
function meets(expect, res, base) {
  if (expect.error) return res.ok === false && (expect.error === true || res.code === expect.error);
  if (expect.ok) return res.ok !== false;
  if (expect.notDenied) return res.ok !== false || res.code !== '42501'; // executed (a business-rule error is fine), i.e. NOT a permission error
  if (expect.rows !== undefined) return res.ok !== false && rowsOf(res) === expect.rows;
  if (expect.rowsMin !== undefined) return res.ok !== false && rowsOf(res) >= expect.rowsMin;
  if (expect.same) return JSON.stringify(res) === JSON.stringify(base);
  return false;
}
const expectText = (e) => (e.notDenied ? 'not 42501' : e.error ? `error${e.error === true ? '' : ' ' + e.error}` : e.ok ? 'ok' : e.rows !== undefined ? `${e.rows} rows` : e.rowsMin !== undefined ? `>= ${e.rowsMin} rows` : 'same as baseline');

async function main() {
  const inferred = new Set(['core']);
  for (const f of files) { const b = path.basename(f).toLowerCase(); for (const s of ['m1', 'm2', 'l5', 's1', 'f5']) if (b.includes(`_${s}_`)) inferred.add(s); }
  const suites = suiteArg ? ['core', ...suiteArg.split(',')] : [...inferred];
  const real = await sql(`select id, role from profiles order by role, id`); // read-only: ids/roles only
  const checks = checksFor(suites, real);
  const migrationSql = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  console.log(`preflight: ${files.map((f) => path.basename(f)).join(' + ')}  suites=${suites.join(',')}  checks=${checks.length}  real profiles=${real.length} (${real.map((r) => r.role).join(',')})`);
  console.log('Every run is wrapped in begin ... rollback (single Management-API request); nothing stays applied.\n');

  const setupSql = suites.includes('f5') ? F5_SETUP : null;
  const run = async (m) => {
    const rows = await sql(buildTransaction(checks, real, m, setupSql));
    return new Map(rows.map((r) => [r.id, r.result]));
  };
  const base = await run(null);
  const withM = await run(migrationSql);

  let fail = 0, fixed = 0;
  console.log(`${'check'.padEnd(34)} ${'role'.padEnd(9)} ${'BEFORE (baseline)'.padEnd(34)} ${'WITH migration'.padEnd(34)} ${'expected'.padEnd(18)} verdict`);
  for (const ch of checks) {
    const b = base.get(ch.id), w = withM.get(ch.id);
    const ok = w && meets(ch.expect, w, b);
    const bOk = b && meets(ch.expect, b, b);
    if (!ok) fail++;
    if (ok && !bOk) fixed++;
    const role = ch.role.startsWith('real:') ? 'real' : ch.role;
    console.log(`${ch.id.padEnd(34)} ${role.padEnd(9)} ${summarize(b).slice(0, 33).padEnd(34)} ${summarize(w).slice(0, 33).padEnd(34)} ${expectText(ch.expect).padEnd(18)} ${ok ? (bOk ? 'PASS' : 'PASS (changed by migration)') : 'FAIL'}`);
    if (!ok) console.log(`    ${ch.label}\n    with-migration raw: ${JSON.stringify(w)?.slice(0, 300)}`);
  }
  console.log(`\n${checks.length - fail}/${checks.length} expectations met WITH the migration; ${fixed} are changed by it (fail before, pass after).`);
  { const d = (withM.get('__acl0') ?? []).length ? ((a, b) => { const A = new Set(a), B = new Set(b); return [...A].filter((x) => !B.has(x)).length + [...B].filter((x) => !A.has(x)).length; })(withM.get('__acl0'), withM.get('__acl1')) : 0; console.log(`ACL snapshot: the migration changes ${d} ACL lines (functions/relations/columns/default ACLs).`); }
  if (rollbackFiles.length) {
    // migration + rollback in the same (rolled-back) transaction: every check must return EXACTLY the baseline result
    const rb = await run(migrationSql + '\n' + rollbackFiles.map((rf) => readFileSync(rf, 'utf8')).join('\n'));
    const aclDiff = (a, b) => { const A = new Set(a ?? []), B = new Set(b ?? []); return [...A].filter((x) => !B.has(x)).map((x) => '- ' + x).concat([...B].filter((x) => !A.has(x)).map((x) => '+ ' + x)); };
    const aclRollbackDiff = aclDiff(rb.get('__acl0'), rb.get('__acl1'));
    console.log(`ROLLBACK ACL proof: ${(rb.get('__acl0') ?? []).length} ACL entries (functions, relations, columns, default ACLs) before the migration; after migration + rollback ${aclRollbackDiff.length === 0 ? 'the snapshot is IDENTICAL (diff = 0)' : 'DIFFERENT (' + aclRollbackDiff.length + ' lines):'}`);
    for (const l of aclRollbackDiff.slice(0, 40)) console.log('    ' + l);
    if (aclRollbackDiff.length) fail += 1;
    const diff = checks.filter((ch) => summarize(rb.get(ch.id)) !== summarize(base.get(ch.id)));
    console.log(`ROLLBACK proof: after migration + ${rollbackFiles.map((rf) => path.basename(rf)).join(' + ')}, ${checks.length - diff.length}/${checks.length} checks return exactly the baseline result` + (diff.length ? `; differing: ${diff.map((d) => d.id).join(', ')}` : ''));
    if (diff.length) fail += diff.length;
  }
  const left = await sql(`select (select count(*) from organizations where name like 'SIM-%') orgs, (select count(*) from auth.users where email like 'sim-%@fleet-test.invalid') users`);
  console.log('rollback proof (must be zeros):', JSON.stringify(left[0]));
  process.exit(fail || Number(left[0].orgs) || Number(left[0].users) ? 1 : 0);
}
main().catch((e) => { console.error(String(e).slice(0, 2000)); process.exit(1); });
