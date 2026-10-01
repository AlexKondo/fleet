// Shared helpers for the Phase C5 real-browser walk-throughs (Playwright, live Supabase + live
// Google through the local `next dev` server). Provisioning mirrors
// supabase/tests/carpool-lifecycle-rpcs.mjs: disposable orgs/users, removed in `finally`.
import '../../supabase/tests/lib/net-retry.mjs';
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const ROOT = "C:/projects/fleet";
const envText = readFileSync(path.join(ROOT, ".env"), "utf8");
const envGet = (n) => envText.match(new RegExp("^" + n + "=(.*)$", "m"))?.[1].trim();
export const MGMT = envGet("SUPABASE_TOKEN");
export const URL_ = envGet("NEXT_PUBLIC_SUPABASE_URL");
export const ANON = envGet("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const SVC = envGet("SUPABASE_SERVICE_ROLE_KEY");
export const CRON_SECRET = envGet("CRON_SECRET");
const REF = "rhbiwkxilelitugbwind";
export const BASE = process.env.BASE_URL || "http://localhost:3100";
export const SHOTS = path.join(ROOT, "resultado_de_testes", "carpool-c5");
mkdirSync(SHOTS, { recursive: true });

export const T = Date.now().toString(36);
export const PASSWORD = "C5ui!" + randomUUID().slice(0, 8);
export const emailOf = (n) => `c5ui-${n}-${T}@fleet-test.invalid`;

export const results = [];
export function record(name, pass, details) {
  results.push({ name, pass });
  console.log((pass ? "PASS" : "FAIL") + " - " + name);
  if (details !== undefined) console.log("    " + (typeof details === "string" ? details : JSON.stringify(details)));
}

export async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + MGMT, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await res.text();
  if (res.status >= 400) throw new Error("SQL failed: " + t + "\n" + query);
  return JSON.parse(t);
}
export async function adminCreateUser(email, password) {
  const res = await fetch(URL_ + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const j = await res.json();
  if (!j.id) throw new Error("create user failed " + JSON.stringify(j));
  return j.id;
}
export async function adminDeleteUser(id) {
  await fetch(URL_ + "/auth/v1/admin/users/" + id, { method: "DELETE", headers: { apikey: SVC, Authorization: "Bearer " + SVC } });
}

/** Provision one disposable org with users and two available ICE vehicles (capacity 5). */
export async function provisionOrg(tag, userDefs) {
  const [org] = await sql(`insert into organizations (name) values ('C5UI-ORG-${tag}-${T}') returning id`);
  await sql(`insert into organization_settings (organization_id) values ('${org.id}') on conflict do nothing`);
  const users = {};
  for (const [name, role] of userDefs) {
    const id = await adminCreateUser(emailOf(`${tag}-${name}`), PASSWORD);
    users[name] = { id, email: emailOf(`${tag}-${name}`), fullName: `C5UI ${tag} ${name}` };
    await sql(`insert into profiles (id, organization_id, full_name, role, drivers_license_number, drivers_license_category, drivers_license_expiration) values ('${id}', '${org.id}', '${users[name].fullName}', '${role}', 'C5UI-000', 'B', '2030-01-01')`);
  }
  const [cat] = await sql(`insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('${org.id}', 'C5UI SUV', 5, 'ICE') returning id`);
  const vehicles = [];
  for (const n of [1, 2]) {
    const [v] = await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km)
      values ('${org.id}', 'C5${tag.slice(0, 1).toUpperCase()}${n}${T.slice(-3).toUpperCase()}', '${cat.id}', 'available', 1000, 80, 600, 20000) returning id, plate`);
    vehicles.push(v);
  }
  return { orgId: org.id, users, vehicles, tag };
}

export async function cleanupOrgs(orgs) {
  const ids = orgs.flatMap((o) => Object.values(o.users).map((u) => u.id));
  const orgIds = orgs.map((o) => `'${o.orgId}'`).join(",");
  try {
    for (const o of orgs) {
      await sql(`delete from reservations where organization_id='${o.orgId}'`);
      await sql(`delete from organizations where id='${o.orgId}'`);
    }
    for (const id of ids) await adminDeleteUser(id);
    const q = `select
      (select count(*) from organizations where name like 'C5UI-ORG-%-${T}') orgs,
      (select count(*) from profiles where id in (${ids.map((i) => `'${i}'`).join(",") || "'00000000-0000-0000-0000-000000000000'"})) profiles,
      (select count(*) from vehicles where organization_id in (${orgIds})) vehicles,
      (select count(*) from trip_requests where organization_id in (${orgIds})) trips,
      (select count(*) from trip_participants where organization_id in (${orgIds})) participants,
      (select count(*) from carpool_offers where organization_id in (${orgIds})) offers,
      (select count(*) from carpool_ride_requests where organization_id in (${orgIds})) requests,
      (select count(*) from carpool_events where organization_id in (${orgIds})) events,
      (select count(*) from carpool_policy_settings where organization_id in (${orgIds})) policies,
      (select count(*) from geo_provider_quota_counters where organization_id in (${orgIds})) quota_rows,
      (select count(*) from notifications where organization_id in (${orgIds})) notifications,
      (select count(*) from audit_log where organization_id in (${orgIds})) audit`;
    const left = await sql(q);
    record("Cleanup: no disposable rows left in the live DB", Object.values(left[0]).every((v) => Number(v) === 0), left[0]);
    console.log("CLEANUP QUERY:\n" + q);
  } catch (e) {
    record("Cleanup", false, String(e));
  }
}

export async function login(page, user) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
}

let shotIndex = 0;
export async function shot(page, name) {
  shotIndex += 1;
  const file = path.join(SHOTS, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("    screenshot: " + path.relative(ROOT, file).replace(/\\/g, "/"));
  return file;
}
export function setShotIndex(n) {
  shotIndex = n;
}

export function localIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Fill the New Trip form and submit ("Buscar recomendação"). */
export async function fillTrip(page, { departure, origin, destination, passengers = 1 }) {
  await page.goto(BASE + "/trips/new", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitHydrated(page);
  const ret = new Date(new Date(departure).getTime() + 8 * 3600000);
  await page.fill('input[name="departureAt"]', localIso(new Date(departure)));
  await page.fill('input[name="expectedReturnAt"]', localIso(ret));
  await page.fill('input[name="origin"]', origin);
  await page.fill('input[name="destination"]', destination);
  await page.fill('input[name="distanceKm"]', "20");
  await page.fill('input[name="passengerCount"]', String(passengers));
  await page.fill('textarea[name="justification"]', "C5UI teste");
  await page.click('form button[type="submit"]:has-text("Buscar recomendação")');
}

/** Wait until React has hydrated the page's form (before that, a form action posts natively). */
export async function waitHydrated(page) {
  await page.waitForFunction(() => {
    const f = document.querySelector("form");
    return Boolean(f) && Object.keys(f).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
  }, null, { timeout: 60000 });
}
