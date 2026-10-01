#!/usr/bin/env node
// Corporate Mobility Points CRUD + RLS probe (Phase C2).
//
// Same live-DB Management API pattern as carpool-offer-seat-constraint.mjs (Phase C1
// Auditor's own precedent) — this repo's other RLS probes (cross-tenant-rls.mjs) talk to a
// local docker Postgres + PostgREST + real user JWTs via the password grant, but this
// script targets the actual live project the Phase C2 migrations were just applied
// against, so it simulates an authenticated RLS session the same way PostgREST itself
// does: `set local role authenticated; select set_config('request.jwt.claims', ..., true)`
// in the same statement batch, then running the query as that simulated user — exercising
// the real `corporate_mobility_points` RLS policies
// (0054_corporate_mobility_points_and_geo_quota.sql), not a superuser bypass.
//
// Checks:
//   1. A member (any role) can SELECT an active point in their own organization.
//   2. A plain `employee` cannot INSERT a new point (write restricted to
//      fleet_manager/administrator) — negative control.
//   3. A `fleet_manager`/`administrator` CAN insert/update/deactivate a point — positive
//      control, so check #2 isn't a false PASS caused by RLS being broken for everyone.
//
// Known limitation (documented per this task's own "don't silently skip" instruction): the
// live project currently has exactly one organization seeded, so a true cross-tenant
// (org A cannot see org B's points) negative check isn't exercised here — that scenario is
// already covered generically for other tables by cross-tenant-rls.mjs's pattern and would
// need a disposable second org (with a real auth.users row, which this Management API
// channel cannot create — GoTrue needs to be involved) to test properly for this table
// specifically. Flagged here rather than faked.
//
// Usage:
//   node supabase/tests/corporate-mobility-points-crud-rls.mjs
//
// Env:
//   SUPABASE_TOKEN (required) — same token used to apply migrations (see .env)
//   SUPABASE_PROJECT_REF (optional, defaults to this repo's project ref)

const SUPABASE_TOKEN = process.env.SUPABASE_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'rhbiwkxilelitugbwind';
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

if (!SUPABASE_TOKEN) {
  console.error('SUPABASE_TOKEN is required (see .env)');
  process.exitCode = 1;
  process.exit(1);
}

const results = [];
function record(name, pass, details) {
  results.push({ name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  if (details !== undefined) {
    const text = typeof details === 'string' ? details : JSON.stringify(details);
    console.log(`    ${text}`);
  }
}

async function query(sql) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Wraps `sql` so it runs inside a transaction as the simulated `profileId` (authenticated
 * role + request.jwt.claims.sub), matching how PostgREST itself sets up an RLS session. */
function asUser(profileId, sql) {
  return `
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${profileId}"}', true);
    ${sql}
    commit;
  `;
}

const TEST_POINT_ID = '00000000-0000-4000-a000-c0ff00000c33';

async function main() {
  console.log(`\n=== Corporate Mobility Points CRUD + RLS probe — ${new Date().toISOString()} ===\n`);

  const lookup = await query(`
    select
      (select id from organizations limit 1) as org_id,
      (select p.id from profiles p where p.role in ('fleet_manager','administrator') limit 1) as manager_id,
      (select p.id from profiles p where p.role = 'employee' limit 1) as employee_id;
  `);
  if (lookup.status >= 400 || !Array.isArray(lookup.body) || lookup.body.length === 0) {
    throw new Error(`Could not find FK targets: ${JSON.stringify(lookup)}`);
  }
  const { org_id, manager_id, employee_id } = lookup.body[0];
  if (!org_id || !manager_id || !employee_id) {
    throw new Error(`Missing a required seeded role for this probe: ${JSON.stringify(lookup.body[0])}`);
  }
  console.log(`Using org_id=${org_id} manager_id=${manager_id} employee_id=${employee_id}`);

  await query(`delete from corporate_mobility_points where id = '${TEST_POINT_ID}';`);

  // --- Check 1: negative control — employee cannot INSERT ---
  const employeeInsert = await query(
    asUser(
      employee_id,
      `insert into corporate_mobility_points (id, organization_id, name, address_label, latitude, longitude)
       values ('${TEST_POINT_ID}', '${org_id}', 'RLS Probe Point', 'Rua Teste, 123', -23.5, -46.6);`,
    ),
  );
  const employeeInsertBlocked =
    employeeInsert.status >= 400 ||
    (typeof employeeInsert.body === 'string' && /row-level security|permission denied/i.test(employeeInsert.body));
  record('Employee cannot INSERT a corporate mobility point (write restricted to fleet_manager/administrator)', employeeInsertBlocked, employeeInsert.body);

  // --- Check 2: positive control — fleet_manager/administrator CAN insert ---
  const managerInsert = await query(
    asUser(
      manager_id,
      `insert into corporate_mobility_points (id, organization_id, name, address_label, latitude, longitude, category)
       values ('${TEST_POINT_ID}', '${org_id}', 'RLS Probe Point', 'Rua Teste, 123', -23.5, -46.6, 'office')
       returning id;`,
    ),
  );
  record('Fleet manager CAN insert a corporate mobility point (positive control)', managerInsert.status < 400 && Array.isArray(managerInsert.body) && managerInsert.body.length === 1, managerInsert.body);

  // --- Check 3: any member (employee) can SELECT it ---
  const employeeSelect = await query(
    asUser(employee_id, `select id, name from corporate_mobility_points where id = '${TEST_POINT_ID}';`),
  );
  record('Any org member (employee) can SELECT an active corporate mobility point', employeeSelect.status < 400 && Array.isArray(employeeSelect.body) && employeeSelect.body.length === 1, employeeSelect.body);

  // --- Check 4: employee cannot deactivate (UPDATE) ---
  // RLS silently filters an UPDATE with no matching row for that role rather than erroring
  // (`for all using (...)` on a role that doesn't match simply matches zero rows) — so the
  // ground truth is read back afterwards as superuser, not the (possibly empty) `returning`
  // output of the blocked statement itself, which this API's multi-statement batching
  // doesn't reliably surface as a distinct result.
  await query(asUser(employee_id, `update corporate_mobility_points set is_active = false where id = '${TEST_POINT_ID}';`));
  const groundTruthAfterEmployeeUpdate = await query(
    `select is_active from corporate_mobility_points where id = '${TEST_POINT_ID}';`,
  );
  const stillActive =
    groundTruthAfterEmployeeUpdate.status < 400 &&
    Array.isArray(groundTruthAfterEmployeeUpdate.body) &&
    groundTruthAfterEmployeeUpdate.body[0]?.is_active === true;
  record('Employee UPDATE has no effect (RLS silently filters; row is still active)', stillActive, groundTruthAfterEmployeeUpdate.body);

  // --- Check 5: fleet_manager CAN deactivate ---
  const managerDeactivate = await query(
    asUser(manager_id, `update corporate_mobility_points set is_active = false where id = '${TEST_POINT_ID}' returning id, is_active;`),
  );
  record('Fleet manager CAN deactivate a corporate mobility point', managerDeactivate.status < 400 && Array.isArray(managerDeactivate.body) && managerDeactivate.body[0]?.is_active === false, managerDeactivate.body);

  await query(`delete from corporate_mobility_points where id = '${TEST_POINT_ID}';`);

  console.log('\n=== Summary ===');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.name}`);
  const failCount = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failCount}/${results.length} checks passed.\n`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  try {
    await query(`delete from corporate_mobility_points where id = '${TEST_POINT_ID}';`);
  } catch {
    /* best effort */
  }
  process.exitCode = 1;
});
