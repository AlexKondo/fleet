// Phase C7a: per-role regression of EVERY screen after the privacy migrations 0063/0064
// (Playwright against `next dev` on BASE_URL, live Supabase, disposable org). Screenshots ->
// resultado_de_testes/carpool-c7/screens/
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BASE, ROOT, T, record, results, sql, provisionOrg, cleanupOrgs, login } from "./carpool-c5-lib.mjs";

const SHOTS = path.join(ROOT, "resultado_de_testes", "carpool-c7", "screens");
mkdirSync(SHOTS, { recursive: true });
const table = [];
const browser = await chromium.launch({ headless: true });
const orgs = [];
const BAD = ["permission denied", "application error", "something went wrong", "unhandled runtime", "internal server error"];

async function newPage(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e).slice(0, 200)));
  await login(page, user);
  return page;
}
async function openBell(page) {
  const b = page.locator('button[aria-label^="Notificações"]:visible, button[aria-label="Falta de upload da CNH"]:visible').first();
  await b.waitFor({ state: "visible", timeout: 30000 });
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1200);
    await b.click();
    await page.waitForTimeout(500);
    if ((await b.getAttribute("aria-expanded")) === "true") return;
  }
}
const body = (page) => page.evaluate(() => document.body.innerText.toLowerCase());

async function visit(page, role, screen, url, { expect = [], forbid = [], expectPath, input } = {}) {
  const problems = [];
  try {
    await page.goto(BASE + url, { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(1500);
    const text = await body(page);
    const finalPath = new URL(page.url()).pathname;
    const want = expectPath ?? url.split("?")[0];
    if (finalPath !== want) problems.push(`landed on ${finalPath} (wanted ${want})`);
    for (const b of BAD) if (text.includes(b)) problems.push(`page shows "${b}"`);
    for (const e of expect) if (!text.includes(e.toLowerCase())) problems.push(`missing "${e}"`);
    for (const f of forbid) if (text.includes(f.toLowerCase())) problems.push(`LEAK "${f}" visible`);
    if (input) {
      const v = await page.inputValue(input.selector).catch(() => null);
      if (v !== input.value) problems.push(`input ${input.selector}=${JSON.stringify(v)} wanted ${JSON.stringify(input.value)}`);
    }
    const file = path.join(SHOTS, `${role}-${screen}.png`.replace(/[^\w.-]/g, "_"));
    await page.screenshot({ path: file, fullPage: true });
  } catch (e) {
    problems.push("exception " + String(e).slice(0, 150));
  }
  table.push({ role, screen, ok: problems.length === 0 });
  record(`${role} / ${screen}`, problems.length === 0, problems.length ? problems : undefined);
}

try {
  const A = await provisionOrg("r", [
    ["empA", "employee"], ["empB", "employee"], ["empC", "employee"], ["empE", "employee"], ["sec", "security"], ["mgr", "fleet_manager"], ["adm", "administrator"], ["mnt", "maintenance_operator"], ["nocnh", "employee"], ["secnc", "security"],
  ]);
  orgs.push(A);
  const U = A.users;
  const nm = (k) => U[k].fullName.toLowerCase();
  await sql(`update profiles set drivers_license_number=null, drivers_license_category=null, drivers_license_expiration=null, driver_authorized=false where id in ('${U.nocnh.id}','${U.secnc.id}')`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);
  const [cat] = await sql(`select id from vehicle_categories where organization_id='${A.orgId}'`);
  const mkVeh = async (n) => (await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km) values ('${A.orgId}','C7R${n}${T.slice(-3).toUpperCase()}','${cat.id}','available',1000,80,600,20000) returning id, plate`))[0];
  const v3 = await mkVeh(3);
  const v4 = await mkVeh(4);
  const [v1, v2] = A.vehicles;
  const day = (h, d = 1) => `now() + interval '${d} day' + interval '${h} hours'`;
  const trip = async (who, dest, just) => (await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${A.orgId}','${U[who].id}',${day(10)},${day(16)},'Origem ${who}','${dest}',20,1,'${just}') returning id`))[0].id;
  const res = async (veh, t, st) => (await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${A.orgId}','${veh}','${t}','${st}',${day(10)},${day(16)}) returning id`))[0].id;
  const tA = await trip("empA", "Campinas-A", "justA");
  const tB = await trip("empB", "Santos-B", "justB");
  const tE = await trip("empE", "SEGREDO-E-DEST", "SEGREDO-E-JUST");
  const rA = await res(v1.id, tA, "confirmed");
  await sql(`update vehicles set status='reserved' where id='${v1.id}'`);
  const rB = await res(v2.id, tB, "pending_approval");
  const rE = await res(v3.id, tE, "pending_approval");
  const [o] = await sql(`insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) values ('${A.orgId}','${tA}','${U.empA.id}','active',3,2,1) returning id`);
  const loc = (l) => `'${JSON.stringify({ label: l, coordinates: { lat: -23.5, lng: -46.6 } })}'::jsonb`;
  const rr = (who, st, pl, dl) => sql(`insert into carpool_ride_requests (organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location, requested_departure_at, status, policy_version, match_additional_distance_km, match_additional_time_min) values ('${A.orgId}','${o.id}','${U[who].id}',1,${loc(pl)},${loc(dl)},${day(10)},'${st}',1,1.1,3)`);
  await rr("empB", "ACCEPTED", "Rua Augusta, 1500 - Consolação, São Paulo - SP", "Av. Brigadeiro 77 - Jardins, São Paulo");
  await sql(`insert into trip_participants (organization_id, trip_request_id, passenger_id, passenger_count, status) values ('${A.orgId}','${tA}','${U.empB.id}',1,'accepted')`);
  await rr("empC", "PENDING", "Av. Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100, Brasil", "Rua Haddock Lobo, 595 - Cerqueira César, São Paulo");
  await sql(`insert into reservation_messages (organization_id, reservation_id, sender_id, message_type, body) values ('${A.orgId}','${rA}','${U.empA.id}','text','MSG-DO-HOST'),('${A.orgId}','${rA}','${U.mgr.id}','text','MSG-DO-GESTOR')`);
  await sql(`insert into notifications (organization_id, user_id, title, body) values ('${A.orgId}','${U.empA.id}','Aviso de teste','corpo de teste')`);

  const SECRET = ["SEGREDO-E-DEST", "SEGREDO-E-JUST"];

  // ---------------------------------------------------------------- employee A (host)
  let p = await newPage(U.empA);
  await visit(p, "employee-host", "dashboard", "/dashboard", { forbid: SECRET });
  await visit(p, "employee-host", "trips", "/trips", { expect: ["campinas-a"], forbid: [...SECRET, "santos-b"] });
  await visit(p, "employee-host", "trips-new", "/trips/new", { forbid: SECRET });
  await visit(p, "employee-host", "reservation-detail", `/reservations/${rA}`, {
    expect: ["campinas-a", "msg-do-host", "msg-do-gestor", nm("mgr"), nm("empB"), nm("empC"), "av. paulista, bela vista", "rua augusta, 1500"],
    forbid: [...SECRET, "01310", "paulista, 1000", "haddock lobo, 595"],
  });
  await visit(p, "employee-host", "reservation-pickup", `/reservations/${rA}/pickup`, { expect: [v1.plate.toLowerCase()] });
  await visit(p, "employee-host", "reservation-of-coworker", `/reservations/${rE}`, { expectPath: "/trips", forbid: SECRET });
  await visit(p, "employee-host", "account", "/account");
  await visit(p, "employee-host", "account-profile", "/account/profile", { input: { selector: 'input[name="fullName"]', value: U.empA.fullName } });
  await visit(p, "employee-host", "account-license", "/account/license");
  await visit(p, "employee-host", "settings-redirect", "/settings", { expectPath: "/dashboard" });
  await visit(p, "employee-host", "fleet-redirect", "/fleet", { expectPath: "/dashboard" });
  await visit(p, "employee-host", "gate-redirect", "/gate", { expectPath: "/dashboard" });
  await visit(p, "employee-host", "analytics-redirect", "/analytics", { expectPath: "/dashboard" });
  await p.goto(BASE + "/dashboard", { waitUntil: "load" });
  await p.waitForTimeout(1500);
  await openBell(p);
  await p.waitForTimeout(800);
  const bellText = await body(p);
  record("employee-host / notification bell: shows own notification, NO 'falta de upload da cnh' (has valid CNH)", bellText.includes("aviso de teste") && !bellText.includes("falta de upload da cnh"), { sawNotif: bellText.includes("aviso de teste") });
  table.push({ role: "employee-host", screen: "bell", ok: bellText.includes("aviso de teste") && !bellText.includes("falta de upload da cnh") });
  await p.screenshot({ path: path.join(SHOTS, "employee-host-bell.png") });
  await p.keyboard.press("Escape");
  await p.click('button[type="button"][aria-label="Assistente Fleet"]').catch(() => {});
  await p.waitForTimeout(1000);
  const chatOpen = await p.locator('[role="dialog"][aria-label="Assistente Fleet"]').isVisible().catch(() => false);
  record("employee-host / chat panel opens", chatOpen);
  table.push({ role: "employee-host", screen: "chat panel", ok: chatOpen });
  await p.screenshot({ path: path.join(SHOTS, "employee-host-chat.png") });
  await p.context().close();

  // ---------------------------------------------------------------- employee B (accepted rider)
  p = await newPage(U.empB);
  await visit(p, "employee-rider", "dashboard", "/dashboard", { forbid: SECRET });
  await visit(p, "employee-rider", "trips", "/trips", { expect: ["campinas-a", "santos-b"], forbid: SECRET });
  await visit(p, "employee-rider", "reservation-of-own", `/reservations/${rB}`, { expect: ["santos-b"] });
  await visit(p, "employee-rider", "reservation-of-host-not-allowed", `/reservations/${rA}`, { expectPath: "/trips", forbid: ["msg-do-gestor"] });
  await visit(p, "employee-rider", "account-profile", "/account/profile", { input: { selector: 'input[name="fullName"]', value: U.empB.fullName } });
  await p.context().close();

  // ---------------------------------------------------------------- employee E (unrelated) incl. planning with busy vehicles
  p = await newPage(U.empE);
  await visit(p, "employee-unrelated", "dashboard", "/dashboard", { forbid: ["campinas-a", "santos-b", "msg-do"] });
  await visit(p, "employee-unrelated", "trips", "/trips", { expect: ["segredo-e-dest"], forbid: ["campinas-a", "santos-b"] });
  await visit(p, "employee-unrelated", "reservation-of-host", `/reservations/${rA}`, { expectPath: "/trips", forbid: ["campinas-a"] });
  const dep = new Date(Date.now() + 5 * 24 * 3600000);
  dep.setHours(9, 0, 0, 0);
  const lp = (d) => { const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
  await p.goto(BASE + "/trips/new", { waitUntil: "load" });
  await p.waitForFunction(() => { const f = document.querySelector("form"); return f && Object.keys(f).some((k) => k.startsWith("__react")); }, null, { timeout: 60000 });
  await p.fill('input[name="departureAt"]', lp(dep));
  await p.fill('input[name="expectedReturnAt"]', lp(new Date(dep.getTime() + 8 * 3600000)));
  await p.fill('input[name="origin"]', "Avenida Paulista, 1578, São Paulo");
  await p.fill('input[name="destination"]', "Avenida Washington Luís, 5000, São Paulo");
  await p.fill('input[name="distanceKm"]', "20");
  await p.fill('input[name="passengerCount"]', "1");
  await p.fill('textarea[name="justification"]', "c7a plan");
  await p.click('form button[type="submit"]:has-text("Buscar recomendação")');
  await p.waitForTimeout(9000);
  const planText = await body(p);
  await p.screenshot({ path: path.join(SHOTS, "employee-unrelated-plan.png"), fullPage: true });
  const okPlan = planText.includes(v4.plate.toLowerCase()) && !planText.includes(v1.plate.toLowerCase()) && !planText.includes(v2.plate.toLowerCase()) && !planText.includes(v3.plate.toLowerCase()) && !BAD.some((b) => planText.includes(b));
  record("employee-unrelated / trips/new planning recommends ONLY the free vehicle (busy windows exclude V1-V3)", okPlan, { v4: v4.plate });
  table.push({ role: "employee-unrelated", screen: "trips/new plan submit", ok: okPlan });
  await p.context().close();

  // ---------------------------------------------------------------- security
  p = await newPage(U.sec);
  await visit(p, "security", "dashboard", "/dashboard");
  await visit(p, "security", "gate", "/gate", { expect: [nm("empA"), "campinas-a", v1.plate.toLowerCase()] });
  await visit(p, "security", "reservation-detail", `/reservations/${rA}`, { expect: ["campinas-a", "msg-do-host", "msg-do-gestor", nm("empA")] });
  await visit(p, "security", "reservation-pickup", `/reservations/${rA}/pickup`, { expect: [v1.plate.toLowerCase()] });
  await visit(p, "security", "account-profile", "/account/profile", { input: { selector: 'input[name="fullName"]', value: U.sec.fullName } });
  await visit(p, "security", "trips", "/trips");
  await p.context().close();

  // ---------------------------------------------------------------- maintenance operator
  p = await newPage(U.mnt);
  await visit(p, "maintenance", "dashboard", "/dashboard", { forbid: SECRET });
  await visit(p, "maintenance", "fleet-redirect", "/fleet", { expectPath: "/dashboard" });
  await visit(p, "maintenance", "trips", "/trips", { forbid: SECRET });
  await p.context().close();

  // ---------------------------------------------------------------- managers
  const mgrScreens = async (role, user) => {
    const pg = await newPage(user);
    await visit(pg, role, "dashboard", "/dashboard", { expect: [nm("empB"), nm("empE"), "santos-b", "segredo-e-dest"] });
    await visit(pg, role, "trips", "/trips");
    await visit(pg, role, "trips-new", "/trips/new");
    await visit(pg, role, "reservation-detail", `/reservations/${rA}`, { expect: ["campinas-a", "msg-do-host", "msg-do-gestor", nm("empA")] });
    await visit(pg, role, "reservation-pickup", `/reservations/${rA}/pickup`, { expect: [v1.plate.toLowerCase()] });
    await visit(pg, role, "gate", "/gate", { expect: [nm("empA"), "campinas-a"] });
    await visit(pg, role, "fleet", "/fleet", { expect: [v1.plate.toLowerCase(), v4.plate.toLowerCase()] });
    await visit(pg, role, "fleet-vehicle", `/fleet/vehicles/${v1.id}`, { expect: ["campinas-a", nm("empA")] });
    await visit(pg, role, "analytics", "/analytics");
    await visit(pg, role, "settings", "/settings");
    await visit(pg, role, "settings-mobility-points", "/settings/mobility-points");
    await visit(pg, role, "account", "/account");
    await visit(pg, role, "account-profile", "/account/profile", { input: { selector: 'input[name="fullName"]', value: user.fullName } });
    await visit(pg, role, "account-license", "/account/license");
    return pg;
  };
  p = await mgrScreens("fleet_manager", U.mgr);
  await p.goto(BASE + "/dashboard", { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.locator('button:has-text("Aprovar")').first().click().catch(() => {});
  await p.waitForTimeout(3500);
  const st = (await sql(`select (select status from reservations where id='${rB}') b, (select status from reservations where id='${rE}') e`))[0];
  const approvedOne = st.b === "confirmed" || st.e === "confirmed";
  record("fleet_manager / dashboard: Approve a pending reservation works", approvedOne, st);
  table.push({ role: "fleet_manager", screen: "dashboard approve action", ok: approvedOne });
  await visit(p, "fleet_manager", "settings-users-redirect", "/settings/users", { expectPath: "/settings" });
  await p.context().close();

  p = await mgrScreens("administrator", U.adm);
  await visit(p, "administrator", "settings-users", "/settings/users", { expect: [nm("empA"), nm("mgr"), nm("nocnh")] });
  const lic = await p.$$eval('input[name="licenseNumber"]', (els) => els.map((e) => e.value).filter((v) => v === "C5UI-000").length);
  record("administrator / settings-users: license numbers load from list_member_licenses (8 members with CNH)", lic >= 8, { lic });
  table.push({ role: "administrator", screen: "settings-users license data", ok: lic >= 8 });
  await p.context().close();

  // ---------------------------------------------------------------- license gate
  p = await newPage(U.nocnh);
  await p.goto(BASE + "/dashboard", { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const gatedPath = new URL(p.url()).pathname;
  const gateText = await body(p);
  const g1 = gatedPath === "/account/license" && gateText.includes("antes de continuar, envie");
  record("license gate: user WITHOUT CNH is redirected to /account/license and sees the gate notice", g1, gatedPath);
  await p.screenshot({ path: path.join(SHOTS, "nocnh-gated.png") });
  await p.goto(BASE + "/trips", { waitUntil: "load" });
  const g2 = new URL(p.url()).pathname === "/account/license";
  record("license gate: other routes stay blocked", g2);
  const g3 = true;
  // The bell item exists only where the gate does not hide the shell: security (exempt from the gate) without a CNH.
  const sp = await newPage(U.secnc);
  await sp.goto(BASE + "/dashboard", { waitUntil: "load" });
  await sp.waitForTimeout(2500);
  const bellOn = (await sp.locator('button[aria-label="Falta de upload da CNH"]:visible').count()) > 0;
  record("license bell: security user WITHOUT CNH sees the 'Falta de upload da CNH' bell item (not gated)", bellOn);
  await sp.screenshot({ path: path.join(SHOTS, "secnc-bell-missing.png") });
  await sql(`update profiles set drivers_license_number='SEC-123', drivers_license_category='B', drivers_license_expiration='2031-01-01', driver_authorized=true where id='${U.secnc.id}'`);
  await sp.goto(BASE + "/dashboard", { waitUntil: "load" });
  await sp.waitForTimeout(2500);
  const bellOff = (await sp.locator('button[aria-label="Falta de upload da CNH"]:visible').count()) === 0 && (await sp.locator('button[aria-label*="Notifica"]:visible').count()) > 0;
  record("license bell: after the CNH is on file the bell item disappears", bellOff);
  table.push({ role: "security-nocnh", screen: "bell item appears, then clears", ok: bellOn && bellOff });
  await sp.context().close();
  await sql(`update profiles set drivers_license_number='NOCNH-123', drivers_license_category='B', drivers_license_expiration='2031-01-01', driver_authorized=true where id='${U.nocnh.id}'`);
  await p.goto(BASE + "/dashboard", { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const afterPath = new URL(p.url()).pathname;
  const g4 = afterPath === "/dashboard" && (await p.locator('button[aria-label="Falta de upload da CNH"]:visible').count()) === 0 && (await p.locator('button[aria-label*="Notifica"]:visible').count()) > 0;
  record("license gate: once the CNH is on file the gate clears and the bell item is gone", g4, afterPath);
  await p.screenshot({ path: path.join(SHOTS, "nocnh-after-cnh.png") });
  table.push({ role: "employee-nocnh", screen: "gate + bell, then cleared", ok: g1 && g2 && g3 && g4 });
  await p.context().close();
} catch (e) {
  record("FATAL", false, String(e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  await cleanupOrgs(orgs);
  const fails = results.filter((r) => !r.pass);
  console.log("\n=== SCREEN x ROLE TABLE ===");
  for (const r of table) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.role.padEnd(20)} ${r.screen}`);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed.`);
  for (const f of fails) console.log("FAIL - " + f.name);
  process.exitCode = fails.length ? 1 : 0;
}
