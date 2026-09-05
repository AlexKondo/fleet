#!/usr/bin/env node
// Early-pickup window regression test (ISSUE-014).
//
// record_pickup (0019_early_pickup_window.sql) must reject a pickup attempted more than
// `organization_settings.early_pickup_grace_minutes` before the reservation's own
// `start_at` — before this migration, only vehicle.status was checked, so a reservation
// scheduled for hours from now could be picked up immediately once approved.
//
// Real end-to-end test: signs in as the seeded Tenant A employee/manager via the password
// grant and calls the real RPCs over PostgREST — never manipulates vehicle/reservation
// status directly.
//
// Usage:
//   node supabase/tests/early-pickup-window.mjs
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

const TENANT_A_EMPLOYEE = { email: 'colaborador@gwm-demo.local', password: 'password123' };
const TENANT_A_MANAGER = { email: 'gestor@gwm-demo.local', password: 'password123' };
// GWM9J90 (BEV) — used for the "too early, blocked" scenario (left in 'reserved' after
// the test, reset in cleanup). GWM1A23 (ICE) — used for the "within grace, allowed"
// scenario (ends in 'in_use' after a real pickup, reset in cleanup).
const VEHICLE_BLOCKED = '40000000-0000-0000-0000-000000000009';
const VEHICLE_ALLOWED = '40000000-0000-0000-0000-000000000001';
const JUSTIFICATION_MARKER = 'EARLY-PICKUP-TEST-DISPOSABLE-probe';

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
delete from inspections where reservation_id in
  (select r.id from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where tr.justification = '${JUSTIFICATION_MARKER}');
delete from reservations where trip_request_id in
  (select id from trip_requests where justification = '${JUSTIFICATION_MARKER}');
delete from trip_requests where justification = '${JUSTIFICATION_MARKER}';
update vehicles set status = 'available', updated_at = now()
  where id in ('${VEHICLE_BLOCKED}', '${VEHICLE_ALLOWED}');
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

async function createAndApprove(token, managerToken, vehicleId, startAt, label) {
  const createResp = await rpc(token, 'create_vehicle_reservation', {
    p_departure_at: startAt,
    p_expected_return_at: new Date(new Date(startAt).getTime() + 3600000).toISOString(),
    p_origin: 'Early pickup test origin',
    p_destination: `Early pickup test destination ${label}`,
    p_distance_km: 5,
    p_passenger_count: 1,
    p_requires_cargo: false,
    p_justification: JUSTIFICATION_MARKER,
    p_vehicle_id: vehicleId,
  });
  const reservationId = createResp.body;
  if (typeof reservationId !== 'string') {
    throw new Error(`Failed to create ${label} reservation: ${JSON.stringify(createResp)}`);
  }
  const approveResp = await rpc(managerToken, 'approve_reservation', { p_reservation_id: reservationId });
  if (approveResp.status >= 400) {
    throw new Error(`Failed to approve ${label} reservation: ${JSON.stringify(approveResp)}`);
  }
  return reservationId;
}

function pickupArgs(reservationId) {
  return {
    p_reservation_id: reservationId,
    p_odometer_km: 1000,
    p_fuel_level_percent: 80,
    p_battery_level_percent: 80,
    p_has_damage: false,
    p_damage_notes: null,
    p_missing_safety_equipment: [],
    p_is_dirty_exterior: false,
    p_is_dirty_interior: false,
    p_role: 'traveler',
  };
}

async function main() {
  console.log(`\n=== Early-pickup window probe — ${new Date().toISOString()} ===\n`);

  runSql(CLEANUP_SQL, 'pre-cleanup');

  try {
    const employee = await signIn(TENANT_A_EMPLOYEE);
    const manager = await signIn(TENANT_A_MANAGER);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // JWT clock-skew settle, see concurrent-reservation-race.mjs

    console.log('--- Scenario 1: reservation starts in 2 hours (default grace is 15 min) — pickup must be BLOCKED ---');
    const blockedStart = new Date(Date.now() + 2 * 3600000).toISOString();
    const blockedReservationId = await createAndApprove(
      employee.accessToken,
      manager.accessToken,
      VEHICLE_BLOCKED,
      blockedStart,
      'blocked',
    );
    const blockedPickup = await rpc(employee.accessToken, 'record_pickup', pickupArgs(blockedReservationId));
    record(
      'Pickup attempted 2 hours before start_at is rejected',
      blockedPickup.status >= 400 && String(blockedPickup.body?.message ?? '').includes('EARLY_PICKUP_NOT_ALLOWED'),
      `status=${blockedPickup.status} body=${JSON.stringify(blockedPickup.body)}`
    );
    const [vehicleAfterBlocked] = await serviceGet(`vehicles?id=eq.${VEHICLE_BLOCKED}&select=status`);
    record(
      'Ground truth: blocked vehicle never transitioned to in_use',
      vehicleAfterBlocked?.status === 'reserved',
      `status=${vehicleAfterBlocked?.status}`
    );

    console.log('--- Scenario 2: reservation starts in 5 minutes (within default 15-min grace) — pickup must SUCCEED ---');
    const allowedStart = new Date(Date.now() + 5 * 60000).toISOString();
    const allowedReservationId = await createAndApprove(
      employee.accessToken,
      manager.accessToken,
      VEHICLE_ALLOWED,
      allowedStart,
      'allowed',
    );
    const allowedPickup = await rpc(employee.accessToken, 'record_pickup', pickupArgs(allowedReservationId));
    record(
      'Pickup attempted 5 minutes before start_at (within grace) succeeds',
      allowedPickup.status === 200 && typeof allowedPickup.body === 'string',
      `status=${allowedPickup.status} body=${JSON.stringify(allowedPickup.body)}`
    );
    const [vehicleAfterAllowed] = await serviceGet(`vehicles?id=eq.${VEHICLE_ALLOWED}&select=status`);
    record(
      'Ground truth: allowed vehicle transitioned to in_use',
      vehicleAfterAllowed?.status === 'in_use',
      `status=${vehicleAfterAllowed?.status}`
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
    console.log('Early-pickup window enforcement holds.');
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
