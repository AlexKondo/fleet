#!/usr/bin/env node
// Carpool offer seat-constraint DB-level atomicity probe (Phase C1 Auditor finding).
//
// The C1 checklist requires "a concurrency test proves seat decrement is atomic at the DB
// level (not app-level)." carpoolOffer.test.ts only proves the pure `updateSeats` TS
// function's arithmetic guard never computes a negative value in-memory — it says nothing
// about the real `carpool_offers` table. This script proves (or disproves) that the actual
// `check (seats_available >= 0)` constraint (0052_carpool_offers_and_ride_requests.sql)
// genuinely rejects an over-decrement when two "claim the last seat" UPDATEs race, even
// though no row-locking RPC exists yet (that's Phase C4 — SELECT ... FOR UPDATE). It
// deliberately uses a *blind* expression UPDATE with no defensive WHERE guard
// (`set seats_available = seats_available - 1`, not `... where seats_available >= 1`), so
// the only thing standing between this and overbooking is Postgres's own per-row UPDATE
// lock plus the CHECK constraint — exactly what C1 shipped and nothing more.
//
// This repo's other DB-integration tests (e.g. carpool-host-acceptance.mjs) talk to a local
// docker Postgres via `psql`. This one instead uses the Supabase Management API
// `/database/query` endpoint — the same connection/query pattern this phase's migrations
// were themselves applied with — because it targets the actual live project DB the
// migrations were just run against, not a local demo stack.
//
// Usage:
//   node supabase/tests/carpool-offer-seat-constraint.mjs
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

const TEST_OFFER_ID = '00000000-0000-4000-a000-c0ff0000001e'; // fixed disposable id, easy to spot/clean

async function main() {
  console.log(`\n=== Carpool offer seat-constraint atomicity probe — ${new Date().toISOString()} ===\n`);

  // Look up real FK targets (org/host/trip_request) already present in this project's data,
  // same as the app itself would reference.
  const lookup = await query(
    `select o.id as org_id, p.id as host_id, tr.id as trip_request_id
     from organizations o
     join profiles p on p.organization_id = o.id
     join trip_requests tr on tr.organization_id = o.id
     limit 1;`
  );
  if (lookup.status >= 400 || !Array.isArray(lookup.body) || lookup.body.length === 0) {
    throw new Error(`Could not find FK targets to seed a test offer: ${JSON.stringify(lookup)}`);
  }
  const { org_id, host_id, trip_request_id } = lookup.body[0];
  console.log(`Using org_id=${org_id} host_id=${host_id} trip_request_id=${trip_request_id}`);

  // Cleanup any leftover row from a prior aborted run, then seed a fresh offer with exactly
  // 1 seat available — the minimum needed to make "two riders race the last seat" meaningful.
  await query(`delete from carpool_offers where id = '${TEST_OFFER_ID}';`);
  const seed = await query(`
    insert into carpool_offers (id, organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version)
    values ('${TEST_OFFER_ID}', '${org_id}', '${trip_request_id}', '${host_id}', 'active', 1, 1, 1)
    returning id, seats_available;
  `);
  record('Seed offer created with seats_available = 1', seed.status < 400 && Array.isArray(seed.body) && seed.body.length === 1, seed.body);

  // Fire two BLIND decrements concurrently — no defensive "and seats_available >= 1" guard,
  // on purpose: this isolates exactly what the raw table (row lock + CHECK constraint)
  // guarantees on its own, with nothing from an app-layer RPC helping it.
  const decrementSql = `update carpool_offers set seats_available = seats_available - 1 where id = '${TEST_OFFER_ID}' returning seats_available;`;
  console.log('\nFiring two concurrent blind UPDATEs against the same row...');
  const [resultA, resultB] = await Promise.allSettled([query(decrementSql), query(decrementSql)]);

  const outcomeA = resultA.status === 'fulfilled' ? resultA.value : { status: 'rejected', body: String(resultA.reason) };
  const outcomeB = resultB.status === 'fulfilled' ? resultB.value : { status: 'rejected', body: String(resultB.reason) };
  console.log('Call A:', JSON.stringify(outcomeA));
  console.log('Call B:', JSON.stringify(outcomeB));

  const succeeded = [outcomeA, outcomeB].filter((o) => o.status === 201 && !(typeof o.body === 'string' && /violates check constraint/.test(o.body)));
  const rejectedByConstraint = [outcomeA, outcomeB].filter(
    (o) => o.status >= 400 || (typeof o.body === 'string' && /violates check constraint/.test(o.body))
  );

  record(
    'Exactly one of the two concurrent decrements succeeded, the other was rejected by the CHECK constraint',
    succeeded.length === 1 && rejectedByConstraint.length === 1,
    { succeededCount: succeeded.length, rejectedCount: rejectedByConstraint.length }
  );

  const finalRow = await query(`select seats_available from carpool_offers where id = '${TEST_OFFER_ID}';`);
  const finalSeats = Array.isArray(finalRow.body) ? finalRow.body[0]?.seats_available : undefined;
  record('Final seats_available never went negative (ground truth read from the table)', finalSeats === 0, { finalSeats });

  await query(`delete from carpool_offers where id = '${TEST_OFFER_ID}';`);

  console.log('\n=== Summary ===');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.name}`);
  const failCount = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failCount}/${results.length} checks passed.\n`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  try {
    await query(`delete from carpool_offers where id = '${TEST_OFFER_ID}';`);
  } catch {
    /* best effort */
  }
  process.exitCode = 1;
});
