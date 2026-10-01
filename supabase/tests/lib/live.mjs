// Shared helpers for the live (real Supabase project) test scripts added in Phase C7.
// Reads the repo-root .env. Never prints secrets. Disposable data only.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ENV_FILE = path.join(ROOT, '.env');
export const envFile = (n) => readFileSync(ENV_FILE, 'utf8').match(new RegExp('^' + n + '=(.*)$', 'm'))?.[1].trim();
export const MGMT = process.env.SUPABASE_TOKEN || envFile('SUPABASE_TOKEN');
export const URL_ = process.env.SUPABASE_URL || envFile('NEXT_PUBLIC_SUPABASE_URL');
export const ANON = process.env.SUPABASE_ANON_KEY || envFile('NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || envFile('SUPABASE_SERVICE_ROLE_KEY');
export const REF = 'rhbiwkxilelitugbwind';
export const T = Date.now().toString(36);
export const PW = 'C7pw!' + randomUUID().slice(0, 8);

export const results = [];
export function record(name, pass, details) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name);
  if (details !== undefined) console.log('    ' + (typeof details === 'string' ? details : JSON.stringify(details)));
}
export function summary(label) {
  console.log(`\n=== Summary (${label}) ===`);
  const failCount = results.filter((r) => !r.pass).length;
  for (const r of results.filter((x) => !x.pass)) console.log(`FAIL - ${r.name}`);
  console.log(`\n${results.length - failCount}/${results.length} checks passed.\n`);
  return failCount;
}

export async function sql(query) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.supabase.com/v1/projects/' + REF + '/database/query', {
      method: 'POST', headers: { Authorization: 'Bearer ' + MGMT, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const t = await res.text();
    if (res.status === 429 || res.status === 502 || res.status === 503) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (res.status >= 400) throw new Error('SQL failed: ' + t + '\n' + query.slice(0, 400));
    return JSON.parse(t);
  }
  throw new Error('SQL throttled repeatedly');
}
export async function adminCreateUser(email, password = PW) {
  const res = await fetch(URL_ + '/auth/v1/admin/users', {
    method: 'POST', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const j = await res.json();
  if (!j.id) throw new Error('create user failed ' + JSON.stringify(j));
  return j.id;
}
export async function adminDeleteUser(id) {
  await fetch(URL_ + '/auth/v1/admin/users/' + id, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
}
export async function signIn(email, password = PW) {
  const res = await fetch(URL_ + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('sign-in failed ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
// rest(token|null, METHOD, 'table?filter', body) -> {status, body}; null token = anon key only.
export async function rest(token, method, pathAndQuery, body, extraHeaders = {}) {
  const res = await fetch(URL_ + '/rest/v1/' + pathAndQuery, {
    method,
    headers: { apikey: ANON, Authorization: 'Bearer ' + (token ?? ANON), 'Content-Type': 'application/json', Prefer: 'return=representation', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let b = null;
  try { b = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: b };
}
export async function rpc(token, fn, args = {}, key = ANON) {
  const res = await fetch(URL_ + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + (token ?? key), 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  let b = null;
  try { b = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: b, ok: res.status < 300 };
}
export const denied = (r) => r.status === 401 || r.status === 403;
export const msg = (r) => (r.body && (r.body.message || JSON.stringify(r.body))) || String(r.status);
export const q = (v) => (v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");

/**
 * Provision one disposable org with the given users [name, role] and `nVehicles` available ICE
 * vehicles (capacity 5). Returns { orgId, users: {name:{id,email,token?}}, vehicles:[{id,plate}] }.
 */
export async function provisionOrg(tag, userDefs, nVehicles = 3) {
  const [org] = await sql(`insert into organizations (name) values ('C7-ORG-${tag}-${T}') returning id`);
  await sql(`insert into organization_settings (organization_id) values ('${org.id}') on conflict do nothing`);
  const users = {};
  for (const [name, role] of userDefs) {
    const email = `c7-${tag}-${name}-${T}@fleet-test.invalid`;
    const id = await adminCreateUser(email);
    users[name] = { id, email, role, fullName: `C7 ${tag} ${name}` };
    await sql(`insert into profiles (id, organization_id, full_name, role, drivers_license_number, drivers_license_category, drivers_license_expiration, driver_authorized) values ('${id}', '${org.id}', '${users[name].fullName}', '${role}', 'LIC-${tag}-${name}-${T}', 'B', '2031-01-01', true)`);
  }
  const [cat] = await sql(`insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('${org.id}', 'C7 SUV', 5, 'ICE') returning id`);
  const vehicles = [];
  for (let n = 1; n <= nVehicles; n++) {
    const [v] = await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km)
      values ('${org.id}', 'C7${tag.slice(0, 1).toUpperCase()}${n}${T.slice(-3).toUpperCase()}', '${cat.id}', 'available', 1000, 80, 600, 20000) returning id, plate`);
    vehicles.push(v);
  }
  return { orgId: org.id, users, vehicles, tag, categoryId: cat.id };
}

export async function signInAll(org) {
  for (const u of Object.values(org.users)) u.token = await signIn(u.email);
}

/** Delete every disposable org (reservations first: the exclusion constraint / FKs), then the auth users. */
export async function cleanupOrgs(orgs, label = 'C7') {
  const orgIds = orgs.map((o) => `'${o.orgId}'`).join(',');
  const ids = orgs.flatMap((o) => Object.values(o.users).map((u) => u.id));
  let left;
  try {
    for (const o of orgs) {
      await sql(`delete from reservations where organization_id='${o.orgId}'`);
      await sql(`delete from organizations where id='${o.orgId}'`);
    }
    for (const id of ids) await adminDeleteUser(id);
    left = await sql(`select
      (select count(*) from organizations where name like 'C7-ORG-%-${T}') orgs,
      (select count(*) from profiles where id in (${ids.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"})) profiles,
      (select count(*) from vehicles where organization_id in (${orgIds || "'00000000-0000-0000-0000-000000000000'"})) vehicles,
      (select count(*) from trip_requests where organization_id in (${orgIds || "'00000000-0000-0000-0000-000000000000'"})) trips,
      (select count(*) from carpool_offers where organization_id in (${orgIds || "'00000000-0000-0000-0000-000000000000'"})) offers,
      (select count(*) from chat_conversations where organization_id in (${orgIds || "'00000000-0000-0000-0000-000000000000'"})) chats,
      (select count(*) from notifications where organization_id in (${orgIds || "'00000000-0000-0000-0000-000000000000'"})) notifications`);
    record(`${label} cleanup: no disposable rows left`, Object.values(left[0]).every((v) => Number(v) === 0), left[0]);
  } catch (e) {
    record(`${label} cleanup`, false, String(e));
  }
}
