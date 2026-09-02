#!/usr/bin/env node
// Cross-tenant RLS isolation probe.
//
// This is a REAL end-to-end test: it creates a second, throwaway organization
// ("Test Tenant B") with its own auth user, signs in as real users via the
// password grant (/auth/v1/token), and then makes real HTTP calls against
// PostgREST (/rest/v1/*) with those users' access tokens — never the service
// role key — to try to breach tenant isolation between Tenant A (the seeded
// "GWM — Planta Iracemápolis" org) and Tenant B.
//
// It also probes the role boundary: a plain `employee` attempting a
// fleet-manager-only action (approving a reservation, or mutating a vehicle
// directly), with a positive control (the fleet_manager doing the same thing
// successfully) so a "PASS" here can't be a false negative caused by the
// mechanism being broken for everyone.
//
// Bootstrap and teardown of Tenant B's fixtures (including the auth.users row,
// which PostgREST cannot write to since `auth` isn't an exposed schema) run as
// raw SQL against the local Postgres container via `docker exec ... psql`,
// mirroring the pattern in supabase/seed.sql — including its gotcha that the
// GoTrue token columns must be '' rather than NULL. Every actual isolation
// check below goes through the real HTTP API with real user JWTs.
//
// Usage:
//   node supabase/tests/cross-tenant-rls.mjs
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

// --- Fixed identifiers ------------------------------------------------------

// Tenant A: the real seeded org (supabase/seed.sql).
const ORG_A = '00000000-0000-0000-0000-000000000001';
const TENANT_A_EMPLOYEE = { email: 'colaborador@gwm-demo.local', password: 'password123' };
const TENANT_A_MANAGER = { email: 'gestor@gwm-demo.local', password: 'password123' };
// GWM9J90 (BEV, 'available') — used as the vehicle for the approve_reservation probe.
const VEHICLE_A_FOR_RPC = '40000000-0000-0000-0000-000000000009';
// GWM1A23 (ICE, 'available') — used as the direct UPDATE probe target.
const VEHICLE_A_PROBE = '40000000-0000-0000-0000-000000000001';
const RESERVATION_A_KNOWN = '50000000-0000-0000-0000-000000000001'; // seeded confirmed reservation
const PROFILE_A_EMPLOYEE = '10000000-0000-0000-0000-000000000002';
const TRIP_REQUEST_JUSTIFICATION_MARKER = 'RLS-TEST-DISPOSABLE-crosstenant-probe';

// Tenant B: fake, disposable, created and destroyed by this script.
const ORG_B = 'b0000000-0000-0000-0000-000000000001';
const AUTH_UID_B_EMPLOYEE = 'b0000000-0000-0000-0000-0000000000a1';
const LOCATION_B = 'b0000000-0000-0000-0000-000000000002';
const CATEGORY_B = 'b0000000-0000-0000-0000-000000000003';
const VEHICLE_B = 'b0000000-0000-0000-0000-000000000004';
const TENANT_B_EMPLOYEE = { email: 'tenant-b-employee@fleet-rls-test.local', password: 'TestTenantB123!' };

// --- Result tracking ---------------------------------------------------------

const results = [];
function record(name, pass, details) {
  results.push({ name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  if (details !== undefined) {
    const text = typeof details === 'string' ? details : JSON.stringify(details);
    console.log(`    ${text}`);
  }
}

// --- SQL bootstrap/teardown helper (raw psql via docker, superuser only) ----

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
delete from reservations where trip_request_id in
  (select id from trip_requests where justification = '${TRIP_REQUEST_JUSTIFICATION_MARKER}');
delete from trip_requests where justification = '${TRIP_REQUEST_JUSTIFICATION_MARKER}';
delete from organizations where id = '${ORG_B}';
delete from auth.users where id = '${AUTH_UID_B_EMPLOYEE}';
`;

const BOOTSTRAP_SQL = `
insert into organizations (id, name) values
  ('${ORG_B}', 'Test Tenant B (disposable — cross-tenant RLS probe, safe to delete)');

insert into organization_settings (organization_id) values
  ('${ORG_B}');

-- Mirrors supabase/seed.sql: the token columns must be '' rather than NULL,
-- because GoTrue's Go SQL scanner errors on NULL for these varchar columns
-- even though Postgres itself allows it.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '${AUTH_UID_B_EMPLOYEE}', 'authenticated', 'authenticated',
  '${TENANT_B_EMPLOYEE.email}', crypt('${TENANT_B_EMPLOYEE.password}', gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''
);

insert into profiles (id, organization_id, full_name, role) values
  ('${AUTH_UID_B_EMPLOYEE}', '${ORG_B}', 'Tenant B Test Employee', 'employee');

insert into vehicle_locations (id, organization_id, name) values
  ('${LOCATION_B}', '${ORG_B}', 'Tenant B HQ');

insert into vehicle_categories (id, organization_id, name, passenger_capacity, supports_cargo) values
  ('${CATEGORY_B}', '${ORG_B}', 'Tenant B Sedan', 5, false);

insert into vehicles (
  id, organization_id, plate, category_id, energy_type, status, home_location_id, current_location_id
) values (
  '${VEHICLE_B}', '${ORG_B}', 'TSTB01', '${CATEGORY_B}', 'ICE', 'available', '${LOCATION_B}', '${LOCATION_B}'
);
`;

// --- HTTP helpers -------------------------------------------------------------

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
  return { accessToken: json.access_token, userId: json.user?.id };
}

async function restGet(token, pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function restPost(token, path, payload, { prefer } = {}) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body, e.g. 204/401 */
  }
  return { status: res.status, body: json };
}

async function restPatch(token, pathAndQuery, payload, { prefer = 'return=representation' } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(payload),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json };
}

async function rpc(token, fnName, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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

// Service-role reads are used ONLY to independently verify ground truth
// (e.g. "did the row actually change") — never to perform the isolation
// checks themselves, which always use the tenant users' own tokens above.
async function serviceGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return res.json();
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log(`\n=== Cross-tenant RLS probe — ${new Date().toISOString()} ===\n`);

  console.log('--- Bootstrap: cleaning any leftover fixtures, then creating Tenant B ---');
  runSql(CLEANUP_SQL, 'pre-cleanup');
  runSql(BOOTSTRAP_SQL, 'bootstrap');
  console.log('Bootstrap complete.\n');

  try {
    console.log('--- Signing in as real users via /auth/v1/token (password grant) ---');
    const tenantA = await signIn(TENANT_A_EMPLOYEE);
    const tenantAManager = await signIn(TENANT_A_MANAGER);
    const tenantB = await signIn(TENANT_B_EMPLOYEE);
    console.log(`Tenant A employee token acquired (user ${tenantA.userId}).`);
    console.log(`Tenant A manager token acquired (user ${tenantAManager.userId}).`);
    console.log(`Tenant B employee token acquired (user ${tenantB.userId}).\n`);

    // -------------------------------------------------------------------
    // Sanity / positive controls — prove tokens and queries actually work,
    // so an empty result below can't be a false negative from a broken query.
    // -------------------------------------------------------------------
    console.log('--- Sanity checks (positive controls) ---');
    const ownVehiclesA = await restGet(tenantA.accessToken, 'vehicles?select=id,organization_id');
    record(
      'sanity: Tenant A employee can see Tenant A vehicles (own org)',
      ownVehiclesA.status === 200 && ownVehiclesA.body.length >= 10,
      `status=${ownVehiclesA.status} count=${ownVehiclesA.body?.length}`
    );

    const ownVehiclesB = await restGet(tenantB.accessToken, 'vehicles?select=id,organization_id');
    record(
      'sanity: Tenant B employee can see Tenant B\'s own vehicle',
      ownVehiclesB.status === 200 &&
        ownVehiclesB.body.length === 1 &&
        ownVehiclesB.body[0].id === VEHICLE_B,
      `status=${ownVehiclesB.status} body=${JSON.stringify(ownVehiclesB.body)}`
    );

    // -------------------------------------------------------------------
    // 4. Tenant B reads Tenant A data — must come back empty of Tenant A rows.
    // -------------------------------------------------------------------
    console.log('\n--- Check 4: Tenant B SELECT against Tenant A data ---');

    const vehiclesAsB = await restGet(tenantB.accessToken, 'vehicles?select=id,organization_id,plate');
    const leakedVehicles = vehiclesAsB.body.filter((v) => v.organization_id === ORG_A);
    record(
      'Tenant B cannot see any Tenant A vehicle via SELECT *',
      vehiclesAsB.status === 200 && leakedVehicles.length === 0,
      `status=${vehiclesAsB.status} leaked=${JSON.stringify(leakedVehicles)}`
    );

    const specificVehicleAsB = await restGet(tenantB.accessToken, `vehicles?id=eq.${VEHICLE_A_PROBE}`);
    record(
      'Tenant B cannot fetch a specific Tenant A vehicle by id (silently filtered, not errored)',
      specificVehicleAsB.status === 200 && specificVehicleAsB.body.length === 0,
      `status=${specificVehicleAsB.status} body=${JSON.stringify(specificVehicleAsB.body)}`
    );

    const reservationsAsB = await restGet(tenantB.accessToken, 'reservations?select=id,organization_id');
    const leakedReservations = reservationsAsB.body.filter((r) => r.organization_id === ORG_A);
    record(
      'Tenant B cannot see any Tenant A reservation',
      reservationsAsB.status === 200 && leakedReservations.length === 0,
      `status=${reservationsAsB.status} total_visible=${reservationsAsB.body?.length} leaked=${JSON.stringify(leakedReservations)}`
    );

    const knownReservationAsB = await restGet(
      tenantB.accessToken,
      `reservations?id=eq.${RESERVATION_A_KNOWN}`
    );
    record(
      'Tenant B cannot fetch a known Tenant A reservation by id',
      knownReservationAsB.status === 200 && knownReservationAsB.body.length === 0,
      `status=${knownReservationAsB.status} body=${JSON.stringify(knownReservationAsB.body)}`
    );

    const profilesAsB = await restGet(tenantB.accessToken, 'profiles?select=id,organization_id,full_name');
    const leakedProfiles = profilesAsB.body.filter((p) => p.organization_id === ORG_A);
    record(
      'Tenant B cannot see any Tenant A profile',
      profilesAsB.status === 200 && leakedProfiles.length === 0,
      `status=${profilesAsB.status} total_visible=${profilesAsB.body?.length} leaked=${JSON.stringify(leakedProfiles)}`
    );

    // -------------------------------------------------------------------
    // 5. Tenant B attempts to write into Tenant A's org.
    // -------------------------------------------------------------------
    console.log('\n--- Check 5: Tenant B INSERT/UPDATE against Tenant A data ---');

    const insertAttempt = await restPost(
      tenantB.accessToken,
      'trip_requests',
      {
        organization_id: ORG_A,
        requester_id: tenantB.userId,
        departure_at: new Date(Date.now() + 400 * 86400000).toISOString(),
        expected_return_at: new Date(Date.now() + 400 * 86400000 + 3600000).toISOString(),
        origin: 'Tenant B forged origin',
        destination: 'Tenant B forged destination',
        distance_km: 10,
        passenger_count: 1,
        requires_cargo: false,
        justification: TRIP_REQUEST_JUSTIFICATION_MARKER + '-insert-attack',
      },
      { prefer: 'return=representation' }
    );
    record(
      'Tenant B INSERT of a trip_request tagged with Tenant A org_id is rejected',
      insertAttempt.status === 401 || insertAttempt.status === 403,
      `status=${insertAttempt.status} body=${JSON.stringify(insertAttempt.body)}`
    );
    const verifyNoForgedTripRequest = await serviceGet(
      `trip_requests?justification=eq.${encodeURIComponent(TRIP_REQUEST_JUSTIFICATION_MARKER + '-insert-attack')}`
    );
    record(
      'Ground truth: forged trip_request was NOT created in the database',
      Array.isArray(verifyNoForgedTripRequest) && verifyNoForgedTripRequest.length === 0,
      `rows_found=${verifyNoForgedTripRequest?.length}`
    );

    const [probeVehicleBefore] = await serviceGet(`vehicles?id=eq.${VEHICLE_A_PROBE}&select=id,plate,status`);
    const updateAttempt = await restPatch(tenantB.accessToken, `vehicles?id=eq.${VEHICLE_A_PROBE}`, {
      plate: 'HACKED-BY-B',
    });
    const [probeVehicleAfter] = await serviceGet(`vehicles?id=eq.${VEHICLE_A_PROBE}&select=id,plate,status`);
    record(
      'Tenant B UPDATE of a Tenant A vehicle affects zero rows (RLS-filtered, not a visible error)',
      Array.isArray(updateAttempt.body) && updateAttempt.body.length === 0,
      `status=${updateAttempt.status} response_rows=${JSON.stringify(updateAttempt.body)}`
    );
    record(
      'Ground truth: Tenant A vehicle plate genuinely unchanged after Tenant B\'s UPDATE attempt',
      probeVehicleBefore.plate === probeVehicleAfter.plate,
      `before=${probeVehicleBefore.plate} after=${probeVehicleAfter.plate}`
    );

    // -------------------------------------------------------------------
    // 6. Tenant A employee attempts fleet-manager-only actions.
    // -------------------------------------------------------------------
    console.log('\n--- Check 6: employee role attempts fleet-manager-only actions ---');

    // 6a. Direct UPDATE of a vehicle's status (role-gated by the "fleet managers
    // manage vehicles" policy, which employee is not part of).
    const [rpcVehicleBefore] = await serviceGet(`vehicles?id=eq.${VEHICLE_A_FOR_RPC}&select=id,status`);
    const employeeDirectUpdate = await restPatch(tenantA.accessToken, `vehicles?id=eq.${VEHICLE_A_FOR_RPC}`, {
      status: 'blocked',
    });
    const [afterEmployeeDirectUpdate] = await serviceGet(
      `vehicles?id=eq.${VEHICLE_A_FOR_RPC}&select=id,status`
    );
    record(
      'employee direct UPDATE of vehicle.status affects zero rows',
      Array.isArray(employeeDirectUpdate.body) && employeeDirectUpdate.body.length === 0,
      `status=${employeeDirectUpdate.status} response_rows=${JSON.stringify(employeeDirectUpdate.body)}`
    );
    record(
      'Ground truth: vehicle status genuinely unchanged after employee\'s direct UPDATE attempt',
      rpcVehicleBefore.status === afterEmployeeDirectUpdate.status,
      `before=${rpcVehicleBefore.status} after=${afterEmployeeDirectUpdate.status}`
    );

    // 6b. approve_reservation RPC: employee creates their own pending reservation
    // (allowed by 0003's policy), then tries to approve it themselves (should fail),
    // then the fleet_manager approves it (positive control — proves the mechanism
    // isn't just broken for everyone).
    const createResp = await rpc(tenantA.accessToken, 'create_vehicle_reservation', {
      p_departure_at: new Date(Date.now() + 401 * 86400000).toISOString(),
      p_expected_return_at: new Date(Date.now() + 401 * 86400000 + 3600000).toISOString(),
      p_origin: 'RLS test origin',
      p_destination: 'RLS test destination',
      p_distance_km: 5,
      p_passenger_count: 1,
      p_requires_cargo: false,
      p_justification: TRIP_REQUEST_JUSTIFICATION_MARKER,
      p_vehicle_id: VEHICLE_A_FOR_RPC,
    });
    const reservationId = createResp.body;
    record(
      'setup: Tenant A employee can create their own pending reservation via RPC',
      createResp.status === 200 && typeof reservationId === 'string',
      `status=${createResp.status} body=${JSON.stringify(createResp.body)}`
    );

    if (typeof reservationId === 'string') {
      const employeeApproveAttempt = await rpc(tenantA.accessToken, 'approve_reservation', {
        p_reservation_id: reservationId,
      });
      record(
        'employee calling approve_reservation() on their own trip is rejected',
        employeeApproveAttempt.status >= 400,
        `status=${employeeApproveAttempt.status} body=${JSON.stringify(employeeApproveAttempt.body)}`
      );

      const [reservationAfterEmployeeAttempt] = await serviceGet(
        `reservations?id=eq.${reservationId}&select=id,status`
      );
      record(
        'Ground truth: reservation still pending_approval after employee\'s approve attempt',
        reservationAfterEmployeeAttempt?.status === 'pending_approval',
        `status=${reservationAfterEmployeeAttempt?.status}`
      );

      // Positive control: fleet_manager CAN approve it.
      const managerApproveAttempt = await rpc(tenantAManager.accessToken, 'approve_reservation', {
        p_reservation_id: reservationId,
      });
      record(
        'positive control: fleet_manager calling approve_reservation() on the same reservation succeeds',
        managerApproveAttempt.status === 200 || managerApproveAttempt.status === 204,
        `status=${managerApproveAttempt.status} body=${JSON.stringify(managerApproveAttempt.body)}`
      );
      const [reservationAfterManagerApproval] = await serviceGet(
        `reservations?id=eq.${reservationId}&select=id,status`
      );
      record(
        'Ground truth: reservation is confirmed after fleet_manager approval',
        reservationAfterManagerApproval?.status === 'confirmed',
        `status=${reservationAfterManagerApproval?.status}`
      );
    } else {
      record('employee calling approve_reservation() on their own trip is rejected', false, 'SKIPPED: setup RPC did not return a reservation id, see above');
      record('Ground truth: reservation still pending_approval after employee\'s approve attempt', false, 'SKIPPED');
      record('positive control: fleet_manager calling approve_reservation() on the same reservation succeeds', false, 'SKIPPED');
      record('Ground truth: reservation is confirmed after fleet_manager approval', false, 'SKIPPED');
    }
  } finally {
    console.log('\n--- Teardown: restoring vehicle state and deleting all Tenant B / test fixtures ---');
    // Restore whatever the approve_reservation positive control changed, then
    // delete every row this script created (org B cascades cover the rest).
    runSql(
      `update vehicles set status = 'available', updated_at = now()
         where id = '${VEHICLE_A_FOR_RPC}' and organization_id = '${ORG_A}';\n${CLEANUP_SQL}`,
      'teardown'
    );
    console.log('Teardown complete.\n');
  }

  // --- Summary ---------------------------------------------------------------
  console.log('=== Summary ===');
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.name}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log('\n*** TENANT ISOLATION BREACH OR PERMISSION BOUNDARY FAILURE DETECTED ***');
    console.log('Failed checks:');
    for (const r of failed) {
      console.log(`  - ${r.name}\n    ${JSON.stringify(r.details)}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\nAll cross-tenant isolation and role-boundary checks passed.');
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error('\nFATAL ERROR running the RLS probe:');
  console.error(err);
  // Best-effort cleanup even on a fatal (non-assertion) failure.
  try {
    runSql(CLEANUP_SQL, 'fatal-error-cleanup');
  } catch (cleanupErr) {
    console.error('Cleanup after fatal error also failed:', cleanupErr);
  }
  process.exitCode = 1;
});
