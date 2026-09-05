#!/usr/bin/env node
// Concurrent double-booking regression test (ISSUE-017 / GT-015).
//
// The reservations table has a real Postgres EXCLUDE constraint
// (0001_init_schema.sql) preventing two active reservations from overlapping on the
// same vehicle — enforced transactionally by Postgres itself, not application code.
// This test proves that under a genuine race (two simultaneous requests for the same
// vehicle/overlapping window), exactly one wins and the other is rejected with the
// exclusion_violation error code (23P01), which apps/web/app/trips/new/actions.ts maps
// to a stable "RESERVATION_CONFLICT" application error.
//
// Real end-to-end test: signs in as the seeded Tenant A employee via the password
// grant and fires two real, genuinely concurrent HTTP RPC calls at PostgREST.
//
// Usage:
//   node supabase/tests/concurrent-reservation-race.mjs
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

// Seeded Tenant A fixtures (supabase/seed.sql) — same accounts cross-tenant-rls.mjs uses.
const TENANT_A_EMPLOYEE = { email: 'colaborador@gwm-demo.local', password: 'password123' };
// GWM9J90 (BEV, 'available') — the same "safe to use for transient RPC tests" vehicle
// cross-tenant-rls.mjs already uses; distinct time window below avoids any collision.
const VEHICLE_A_FOR_RPC = '40000000-0000-0000-0000-000000000009';
const JUSTIFICATION_MARKER = 'RACE-TEST-DISPOSABLE-concurrent-reservation-probe';

// Far enough in the future, and distinct from cross-tenant-rls.mjs's own +401 day
// window, that this test can never collide with seed data or that other test's runs.
const START_AT = new Date(Date.now() + 700 * 86400000).toISOString();
const END_AT = new Date(Date.now() + 700 * 86400000 + 3600000).toISOString();

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
delete from reservations where trip_request_id in
  (select id from trip_requests where justification = '${JUSTIFICATION_MARKER}');
delete from trip_requests where justification = '${JUSTIFICATION_MARKER}';
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

function makeReservationArgs(suffix) {
  return {
    p_departure_at: START_AT,
    p_expected_return_at: END_AT,
    p_origin: 'Race test origin',
    p_destination: `Race test destination ${suffix}`,
    p_distance_km: 5,
    p_passenger_count: 1,
    p_requires_cargo: false,
    p_justification: JUSTIFICATION_MARKER,
    p_vehicle_id: VEHICLE_A_FOR_RPC,
  };
}

async function main() {
  console.log(`\n=== Concurrent double-booking race probe — ${new Date().toISOString()} ===\n`);

  runSql(CLEANUP_SQL, 'pre-cleanup');

  try {
    const tenantA = await signIn(TENANT_A_EMPLOYEE);
    // A JWT minted an instant ago can occasionally be rejected as "issued at future"
    // (PGRST303) by host/Docker-container clock skew in local dev — unrelated to the
    // double-booking protection this test verifies. A short settle delay avoids that
    // false failure without weakening the race itself (both calls still fire together).
    await new Promise((resolve) => setTimeout(resolve, 1500));

    console.log('--- Firing two genuinely concurrent create_vehicle_reservation calls on the same vehicle/window ---');
    const [respA, respB] = await Promise.all([
      rpc(tenantA.accessToken, 'create_vehicle_reservation', makeReservationArgs('A')),
      rpc(tenantA.accessToken, 'create_vehicle_reservation', makeReservationArgs('B')),
    ]);

    const succeeded = [respA, respB].filter((r) => r.status === 200 && typeof r.body === 'string');
    const failed = [respA, respB].filter((r) => r.status >= 400);

    record(
      'Exactly one of the two concurrent requests succeeded',
      succeeded.length === 1,
      `respA={status:${respA.status}, body:${JSON.stringify(respA.body)}} respB={status:${respB.status}, body:${JSON.stringify(respB.body)}}`
    );

    record(
      'Exactly one of the two concurrent requests was rejected',
      failed.length === 1,
      `succeeded=${succeeded.length} failed=${failed.length}`
    );

    const loser = failed[0];
    record(
      'The rejected request failed with the exclusion_violation Postgres error code (23P01)',
      loser?.body?.code === '23P01',
      `loser body=${JSON.stringify(loser?.body)}`
    );

    // Ground truth: independently verify via service role that only ONE reservation
    // actually exists for this vehicle in this window — not just that one HTTP call
    // reported success (proves the DB constraint, not just the API response, held).
    const rows = await serviceGet(
      `reservations?vehicle_id=eq.${VEHICLE_A_FOR_RPC}&start_at=eq.${encodeURIComponent(START_AT)}&select=id,status`
    );
    record(
      'Ground truth: exactly one reservation row exists in the database for this vehicle/window',
      Array.isArray(rows) && rows.length === 1,
      `rows=${JSON.stringify(rows)}`
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
    console.log('Double-booking protection holds under a real concurrent race.');
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
