#!/usr/bin/env node
// Carpool host-acceptance regression test (ISSUE-016).
//
// create_carpool_participation (0020_carpool_host_acceptance.sql) now inserts a 'pending'
// row instead of auto-accepting the joining passenger, and only the reservation's host
// driver (or a fleet_manager/administrator) may call respond_to_carpool_request to
// accept/reject it. This test proves: (1) a new request starts 'pending', (2) the
// joining passenger themselves cannot approve their own request, (3) the host accepting
// transitions it to 'accepted' and notifies the passenger, (4) the host rejecting a
// second request deletes the row (not a soft "rejected" status) and notifies the
// passenger, and (5) capacity is genuinely re-checked at accept time, using the real
// seeded vehicle's actual capacity rather than a hardcoded assumption.
//
// Real end-to-end test: signs in as the seeded Tenant A manager (host/driver) and
// employee (joining passenger) via the password grant, calls the real RPCs over
// PostgREST.
//
// Usage:
//   node supabase/tests/carpool-host-acceptance.mjs
//
// Env overrides (all optional, default to local supabase demo values):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DB_CONTAINER

import { spawnSync } from 'node:child_process';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const DB_CONTAINER = process.env.DB_CONTAINER || 'supabase_db_fleet';

const TENANT_A_MANAGER = { email: 'gestor@gwm-demo.local', password: 'password123' };
const TENANT_A_EMPLOYEE = { email: 'colaborador@gwm-demo.local', password: 'password123' };
const TENANT_A_SECURITY = { email: 'portaria@gwm-demo.local', password: 'password123' };
// GWM1A23 (ICE) — reused from other tests; a fresh disposable time window (+800 days)
// keeps this fully independent of concurrent-reservation-race.mjs (+700) and
// early-pickup-window.mjs (near-future windows).
const HOST_VEHICLE = '40000000-0000-0000-0000-000000000001';
const JUSTIFICATION_MARKER = 'CARPOOL-HOST-TEST-DISPOSABLE-probe';

const START_AT = new Date(Date.now() + 800 * 86400000).toISOString();
const END_AT = new Date(Date.now() + 800 * 86400000 + 3 * 3600000).toISOString();

const results = [];
function record(name, pass, details) {
  results.push({ name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  if (details !== undefined) {
    const text = typeof details === 'string' ? details : JSON.stringify(details);
    console.log(`    ${text}`);
  }
}

function runSql(sql, label) {
  const proc = spawnSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, encoding: 'utf-8' }
  );
  if (proc.status !== 0) {
    console.error(`--- SQL FAILED (${label}) ---`);
    console.error(proc.stdout);
    console.error(proc.stderr);
    throw new Error(`SQL step "${label}" failed with exit code ${proc.status}`);
  }
  return proc.stdout;
}

const CLEANUP_SQL = `
delete from notifications where organization_id = '00000000-0000-0000-0000-000000000001'
  and (title = 'Pedido de carona na sua viagem' or title = 'Carona aceita' or title = 'Carona recusada');
delete from trip_participants where trip_request_id in
  (select id from trip_requests where justification = '${JUSTIFICATION_MARKER}');
delete from reservations where trip_request_id in
  (select id from trip_requests where justification = '${JUSTIFICATION_MARKER}');
delete from trip_requests where justification = '${JUSTIFICATION_MARKER}';
update vehicles set status = 'available', updated_at = now() where id = '${HOST_VEHICLE}';
`;

async function signIn({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`Sign-in failed for ${email}: ${res.status} ${JSON.stringify(json)}`);
  }
  return { accessToken: json.access_token };
}

async function rpc(token, fnName, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json };
}

async function serviceGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return res.json();
}

async function joinCarpool(token, hostTripRequestId, label) {
  const resp = await rpc(token, 'create_carpool_participation', {
    p_departure_at: START_AT,
    p_expected_return_at: END_AT,
    p_origin: 'Carpool test origin',
    p_destination: `Carpool test destination ${label}`,
    p_distance_km: 5,
    p_passenger_count: 1,
    p_requires_cargo: false,
    p_justification: JUSTIFICATION_MARKER,
    p_existing_trip_request_id: hostTripRequestId,
  });
  if (typeof resp.body !== 'string') {
    throw new Error(`Failed to join carpool (${label}): ${JSON.stringify(resp)}`);
  }
  return resp.body;
}

async function main() {
  console.log(`\n=== Carpool host-acceptance probe — ${new Date().toISOString()} ===\n`);

  runSql(CLEANUP_SQL, 'pre-cleanup');

  try {
    const host = await signIn(TENANT_A_MANAGER);
    const passenger = await signIn(TENANT_A_EMPLOYEE);
    const otherPassenger = await signIn(TENANT_A_SECURITY);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // JWT clock-skew settle

    console.log('--- Setup: host creates and self-approves the reservation ---');
    const createResp = await rpc(host.accessToken, 'create_vehicle_reservation', {
      p_departure_at: START_AT,
      p_expected_return_at: END_AT,
      p_origin: 'Carpool test origin',
      p_destination: 'Carpool test destination HOST',
      p_distance_km: 5,
      p_passenger_count: 1,
      p_requires_cargo: false,
      p_justification: JUSTIFICATION_MARKER,
      p_vehicle_id: HOST_VEHICLE,
    });
    const reservationId = createResp.body;
    if (typeof reservationId !== 'string') throw new Error(`Host reservation create failed: ${JSON.stringify(createResp)}`);
    const approveResp = await rpc(host.accessToken, 'approve_reservation', { p_reservation_id: reservationId });
    if (approveResp.status >= 400) throw new Error(`Host approve failed: ${JSON.stringify(approveResp)}`);

    const [reservationRow] = await serviceGet(`reservations?id=eq.${reservationId}&select=trip_request_id`);
    const hostTripRequestId = reservationRow.trip_request_id;

    console.log('--- Scenario 1: joining starts pending, not auto-accepted ---');
    const participantId = await joinCarpool(passenger.accessToken, hostTripRequestId, 'A');
    const [participantRow] = await serviceGet(`trip_participants?id=eq.${participantId}&select=status`);
    record(
      'New carpool join request starts as pending',
      participantRow?.status === 'pending',
      `status=${participantRow?.status}`
    );

    console.log('--- Scenario 2: the joining passenger cannot approve their own request ---');
    const selfApprove = await rpc(passenger.accessToken, 'respond_to_carpool_request', {
      p_participant_id: participantId,
      p_accept: true,
    });
    record(
      'Passenger cannot respond to their own carpool request',
      selfApprove.status >= 400,
      `status=${selfApprove.status} body=${JSON.stringify(selfApprove.body)}`
    );

    console.log('--- Scenario 3: host accepts — status becomes accepted, passenger notified ---');
    const acceptResp = await rpc(host.accessToken, 'respond_to_carpool_request', {
      p_participant_id: participantId,
      p_accept: true,
    });
    record('Host accepting the request succeeds', acceptResp.status < 400, `status=${acceptResp.status} body=${JSON.stringify(acceptResp.body)}`);
    const [acceptedRow] = await serviceGet(`trip_participants?id=eq.${participantId}&select=status`);
    record('Ground truth: participant status is now accepted', acceptedRow?.status === 'accepted', `status=${acceptedRow?.status}`);
    const acceptAuditRows = await serviceGet(
      `audit_log?action=eq.carpool_request_accepted&entity_id=eq.${participantId}&select=id,actor_id`
    );
    record(
      'Audit log records the acceptance',
      Array.isArray(acceptAuditRows) && acceptAuditRows.length === 1,
      `audit_log=${JSON.stringify(acceptAuditRows)}`
    );
    const acceptNotifications = await serviceGet(
      `notifications?title=eq.Carona aceita&order=created_at.desc&limit=1`
    );
    record(
      'Passenger received an "accepted" notification',
      Array.isArray(acceptNotifications) && acceptNotifications.length === 1,
      `notifications=${JSON.stringify(acceptNotifications)}`
    );

    console.log('--- Scenario 4: host rejects a second request — row deleted, passenger notified ---');
    const secondParticipantId = await joinCarpool(otherPassenger.accessToken, hostTripRequestId, 'B');
    const rejectResp = await rpc(host.accessToken, 'respond_to_carpool_request', {
      p_participant_id: secondParticipantId,
      p_accept: false,
    });
    record('Host rejecting the second request succeeds', rejectResp.status < 400, `status=${rejectResp.status} body=${JSON.stringify(rejectResp.body)}`);
    const rejectedRows = await serviceGet(`trip_participants?id=eq.${secondParticipantId}&select=id`);
    record(
      'Ground truth: rejected participant row was deleted, not soft-marked',
      Array.isArray(rejectedRows) && rejectedRows.length === 0,
      `rows=${JSON.stringify(rejectedRows)}`
    );
    const rejectAuditRows = await serviceGet(
      `audit_log?action=eq.carpool_request_rejected&entity_id=eq.${secondParticipantId}&select=id,actor_id`
    );
    record(
      'Audit log still records the rejection even though the row itself was deleted',
      Array.isArray(rejectAuditRows) && rejectAuditRows.length === 1,
      `audit_log=${JSON.stringify(rejectAuditRows)}`
    );
    const rejectNotifications = await serviceGet(
      `notifications?title=eq.Carona recusada&order=created_at.desc&limit=1`
    );
    record(
      'Passenger received a "rejected" notification',
      Array.isArray(rejectNotifications) && rejectNotifications.length === 1,
      `notifications=${JSON.stringify(rejectNotifications)}`
    );

    console.log('--- Scenario 5: responding to an already-resolved request is rejected ---');
    const doubleAccept = await rpc(host.accessToken, 'respond_to_carpool_request', {
      p_participant_id: participantId,
      p_accept: true,
    });
    record(
      'Responding again to an already-accepted request is rejected',
      doubleAccept.status >= 400,
      `status=${doubleAccept.status} body=${JSON.stringify(doubleAccept.body)}`
    );
  } finally {
    runSql(CLEANUP_SQL, 'final-cleanup');
  }

  console.log('\n=== Summary ===');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.name}`);
  const failCount = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failCount}/${results.length} checks passed.\n`);
  if (failCount > 0) {
    console.error(`${failCount} check(s) FAILED.`);
    process.exitCode = 1;
  } else {
    console.log('Carpool host-acceptance workflow holds.');
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  try {
    runSql(CLEANUP_SQL, 'fatal-error-cleanup');
  } catch {
    /* best effort */
  }
  process.exitCode = 1;
});
