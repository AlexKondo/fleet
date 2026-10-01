// C7b browser checks (real Chromium against `next dev` on BASE_URL, live Supabase, disposable org):
//   1. hostile free text (XSS payloads, SQL-ish text, unicode tricks, 5000-char strings) in a trip destination /
//      origin / justification, a stored pickup label, a drop-off label and a host's reject reason is rendered as INERT
//      TEXT on every page that shows it (host trip page, manager dashboard + bell, rider /trips, analytics)
//   2. L1: the Gantt zoom preference now persists (and a user cannot write someone else's)
//   3. M3: toggling "driver authorized" / editing a license never wipes the CNH
//   4. KPI dashboard access (manager yes, employee redirected) and numbers present
//   5. hardening 4b: vehicleOptions come back after a reload (numbered buttons), tampered ones do not
// Screenshots -> resultado_de_testes/carpool-c7b/
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BASE, ROOT, T, record, results, sql, provisionOrg, cleanupOrgs, login, PASSWORD, URL_, ANON, SVC } from "./carpool-c5-lib.mjs";

const SHOTS = path.join(ROOT, "resultado_de_testes", "carpool-c7b");
mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); };

const XSS1 = `<img src=x onerror="window.__xss=(window.__xss||0)+1">`;
const XSS2 = `</script><script>window.__xss=(window.__xss||0)+10</script>`;
const XSS3 = `" onmouseover="window.__xss=99" autofocus onfocus="window.__xss=98" x="`;
const SQLI = `'; drop table profiles; --`;
const UNI = `‮gnp.exe​‍﻿ 🚗`;
const LONG = "A".repeat(5000);

async function token(email) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  return (await r.json()).access_token;
}
async function rpc(tok, fn, args, key = ANON) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${tok ?? key}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  let body = null; try { body = await r.json(); } catch { /* empty */ }
  return { ok: r.status < 300, status: r.status, body };
}

const browser = await chromium.launch({ headless: true });
const orgs = [];
const newPage = async (user, vp = { width: 1280, height: 900 }) => {
  const ctx = await browser.newContext({ viewport: vp, locale: "pt-BR" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await login(page, user);
  return page;
};
const inert = (page) => page.evaluate(() => ({
  xss: window.__xss ?? 0,
  imgX: document.querySelectorAll('img[src="x"]').length,
  // Next's inline flight-data scripts (self.__next_f.push) contain the payload only as an escaped JSON string: not an injection
  injectedScripts: [...document.querySelectorAll("script:not([src])")].filter((s) => !(s.textContent || "").trimStart().startsWith("self.__next_f") && (s.textContent || "").includes("__xss=")).length,
  hostileAttr: document.querySelectorAll("[onmouseover],[onfocus],[onerror]").length,
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  text: document.body.innerText,
}));

try {
  const A = await provisionOrg("c7b", [["host", "employee"], ["rider", "employee"], ["rider2", "employee"], ["mgr", "fleet_manager"], ["adm", "administrator"], ["emp", "employee"]]);
  orgs.push(A);
  const U = A.users;
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);

  // ---------------------------------------------------------------- seed hostile data through the REAL RPCs
  const tHost = await token(U.host.email);
  const dep = new Date(Date.now() + 30 * 3600e3), ret = new Date(dep.getTime() + 4 * 3600e3);
  const created = await rpc(tHost, "create_vehicle_reservation", {
    p_departure_at: dep.toISOString(), p_expected_return_at: ret.toISOString(), p_origin: `${XSS3} ${UNI}`, p_destination: `${XSS1} ${SQLI} ${LONG}`,
    p_distance_km: 12, p_passenger_count: 1, p_requires_cargo: false, p_justification: XSS2, p_vehicle_id: A.vehicles[0].id, p_allow_carpool: true,
  });
  record("seed: hostile reservation created through create_vehicle_reservation", created.ok, created.ok ? undefined : created.body);
  const [trip] = await sql(`select tr.id trip, r.id res, tr.destination from trip_requests tr join reservations r on r.trip_request_id=tr.id where tr.requester_id='${U.host.id}'`);
  record("seed: the 5000+ char destination is stored (DB has no limit); the form/chat paths clamp it to 300 chars (see unit tests)", trip.destination.length > 5000, { len: trip.destination.length });
  const en = await rpc(tHost, "enable_carpool_offer", { p_trip_request_id: trip.trip, p_seats: 3 });
  const offerId = en.body;
  // clamp-aware: tests use short destination for the label-bearing requests below
  const mkReq = async (riderId, pickup, dropoff) => (await rpc(SVC, "create_carpool_ride_request_as_rider", {
    p_rider_id: riderId, p_offer_id: offerId, p_seats: 1, p_pickup: pickup, p_dropoff: dropoff, p_requested_departure_at: dep.toISOString(),
    p_client_request_id: randomUUID(), p_match_additional_distance_km: 1, p_match_additional_time_min: 2,
  }, SVC));
  const loc = (label) => ({ label, coordinates: { lat: -23.55, lng: -46.63 }, source: "manual_lat_lng" });
  const r1 = await mkReq(U.rider.id, loc(`Rua ${XSS1} 10 ${UNI}, Centro`), loc(`Av ${XSS3} 20`));
  const r2 = await mkReq(U.rider2.id, loc("Rua Normal 1, Centro"), loc("Av Normal 2"));
  record("seed: ride requests with hostile pickup/drop-off labels created", r1.ok && r2.ok, { r1: r1.status, r2: r2.status });
  const req1 = r1.body, req2 = r2.body;
  const stored = await sql(`select pickup_location->>'label' l from carpool_ride_requests where id='${req1}'`);
  record("seed: the hostile label is stored verbatim as DATA (escaping happens at render)", stored[0]?.l?.includes("<img"), { len: stored[0]?.l?.length });
  // host pending view first (coarse), then accept r1 (exact label shown) and reject r2 with a hostile reason
  const hostPage = await newPage(U.host);
  await hostPage.goto(`${BASE}/reservations/${trip.res}`, { waitUntil: "load", timeout: 90000 });
  await hostPage.waitForTimeout(1500);
  let st = await inert(hostPage);
  record("host reservation page (PENDING requests, coarse labels): nothing executed, no injected elements", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0 && st.hostileAttr === 0, { xss: st.xss, imgX: st.imgX, scripts: st.injectedScripts, attrs: st.hostileAttr });
  await shot(hostPage, "xss-host-reservation-pending");
  await rpc(tHost, "accept_carpool_ride_request", { p_request_id: req1 });
  await rpc(tHost, "reject_carpool_ride_request", { p_request_id: req2, p_reason: `${XSS1} ${XSS2} ${SQLI}` });
  await hostPage.reload({ waitUntil: "load" });
  await hostPage.waitForTimeout(1500);
  st = await inert(hostPage);
  record("host reservation page (ACCEPTED rider => exact hostile label rendered): inert text", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0 && st.hostileAttr === 0, { xss: st.xss, imgX: st.imgX });
  record("host reservation page shows the hostile destination / label as visible TEXT (escaped, not interpreted)", st.text.includes("<img src=x") || st.text.includes("onerror"), { sawPayloadText: st.text.includes("<img src=x") });
  record("host reservation page: a 5000-char destination does not break the layout (no horizontal page overflow > 40px)", st.overflow <= 40, { overflowPx: st.overflow });
  await shot(hostPage, "xss-host-reservation-accepted");
  await hostPage.goto(`${BASE}/trips`, { waitUntil: "load" });
  await hostPage.waitForTimeout(1500);
  st = await inert(hostPage);
  record("host /trips (Gantt bar label = hostile destination): inert", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0, { xss: st.xss, overflowPx: st.overflow });
  await shot(hostPage, "xss-host-trips");

  // L1: Gantt zoom persistence (host has a reservation so the Gantt renders)
  const before = (await sql(`select gantt_zoom_preference z from profiles where id='${U.host.id}'`))[0].z;
  await hostPage.getByRole("button", { name: "Diminuir zoom" }).click();
  await hostPage.waitForTimeout(2500);
  const after = (await sql(`select gantt_zoom_preference z from profiles where id='${U.host.id}'`))[0].z;
  const labelOf = { week: "Semana", month: "Mês", quarter: "Trimestre" };
  record("L1: changing the Gantt zoom persists to profiles.gantt_zoom_preference (was never saved before)", after !== before && Boolean(labelOf[after]), { before, after });
  await hostPage.reload({ waitUntil: "load" });
  await hostPage.waitForTimeout(1200);
  record(`L1: after a reload the Gantt opens at the saved zoom (${labelOf[after]})`, (await hostPage.locator("body").innerText()).toLowerCase().includes(labelOf[after].toLowerCase()));
  // a user cannot write someone else's preference: direct PostgREST PATCH as another user affects nothing
  const tRider = await token(U.rider.email);
  const patch = await fetch(`${URL_}/rest/v1/profiles?id=eq.${U.host.id}`, { method: "PATCH", headers: { apikey: ANON, Authorization: `Bearer ${tRider}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ gantt_zoom_preference: after === "week" ? "month" : "week" }) });
  const patched = await patch.json().catch(() => null);
  const still = (await sql(`select gantt_zoom_preference z from profiles where id='${U.host.id}'`))[0].z;
  record("L1: another user cannot set someone else's zoom (PATCH on profiles changes nothing)", still === after && (!Array.isArray(patched) || patched.length === 0), { status: patch.status, still, after });
  await hostPage.context().close();

  // rider /trips: own requests (accepted with hostile labels' coordinates) ; rejected rider2 sees the hostile reason as text
  const riderPage = await newPage(U.rider);
  await riderPage.goto(`${BASE}/trips`, { waitUntil: "load" });
  await riderPage.waitForTimeout(1500);
  st = await inert(riderPage);
  record("rider /trips (accepted request): inert", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0, { xss: st.xss });
  await riderPage.context().close();
  const rider2Page = await newPage(U.rider2);
  await rider2Page.goto(`${BASE}/trips`, { waitUntil: "load" });
  await rider2Page.waitForTimeout(1500);
  st = await inert(rider2Page);
  record("rider2 /trips (REJECTED with a hostile host reason): reason shown as inert text, nothing executed", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0 && st.text.includes("<img src=x"), { xss: st.xss, imgX: st.imgX, sawReasonText: st.text.includes("<img src=x") });
  await shot(rider2Page, "xss-rider-rejected-reason");
  await rider2Page.context().close();

  // manager: dashboard (pending approval list = hostile destination) + the bell notification body
  const mgrPage = await newPage(U.mgr);
  await mgrPage.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await mgrPage.waitForTimeout(2500);
  st = await inert(mgrPage);
  record("manager dashboard (pending approvals show the hostile destination): inert", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0, { xss: st.xss, imgX: st.imgX, overflowPx: st.overflow });
  await shot(mgrPage, "xss-manager-dashboard");
  const bell = mgrPage.locator('button[aria-label^="Notificações"]:visible').first();
  await bell.waitFor({ state: "visible", timeout: 30000 });
  for (let i = 0; i < 5; i++) { await mgrPage.waitForTimeout(1000); await bell.click(); await mgrPage.waitForTimeout(500); if ((await bell.getAttribute("aria-expanded")) === "true") break; }
  st = await inert(mgrPage);
  record("manager bell: the notification body built from the hostile destination is inert text", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0 && st.hostileAttr === 0, { xss: st.xss, imgX: st.imgX, sawPayloadText: st.text.includes("<img src=x") });
  await shot(mgrPage, "xss-manager-bell");
  await mgrPage.context().close();

  // administrator: analytics (top destinations) + KPI dashboard
  const admPage = await newPage(U.adm);
  await admPage.goto(`${BASE}/analytics`, { waitUntil: "load" });
  await admPage.waitForTimeout(2000);
  st = await inert(admPage);
  record("administrator /analytics (destinations list with the hostile destination): inert", st.xss === 0 && st.imgX === 0 && st.injectedScripts === 0, { xss: st.xss, overflowPx: st.overflow });
  await shot(admPage, "xss-analytics");
  const link = await admPage.locator('[data-testid="carpool-kpi-link"]').count();
  record("administrator: /analytics links to the carpool KPI dashboard", link === 1);
  await admPage.goto(`${BASE}/analytics/carpool?range=30`, { waitUntil: "load" });
  await admPage.waitForTimeout(1500);
  const kpiText = await admPage.locator('[data-testid="carpool-kpi-page"]').innerText();
  const num = async (id) => (await admPage.locator(`[data-testid="${id}"] p`).first().getAttribute("data-value"));
  record("KPI dashboard (administrator) renders: ride requests = 2 (1 accepted, 1 rejected), offers enabled = 1", (await num("kpi-requests-total")) === "2" && (await num("kpi-requests-accepted")) === "1" && (await num("kpi-requests-rejected")) === "1" && (await num("kpi-offers-enabled")) === "1", { total: await num("kpi-requests-total"), accepted: await num("kpi-requests-accepted"), enabled: await num("kpi-offers-enabled") });
  record("KPI dashboard shows the estimate labelling (avoided km marked as ESTIMATE, cost marked as ESTIMATED)", /ESTIMATIVA/.test(kpiText) && /ESTIMADO/.test(kpiText), { est: /ESTIMATIVA/.test(kpiText), cost: /ESTIMADO/.test(kpiText) });
  for (const d of [7, 90]) {
    await admPage.locator(`[data-testid="kpi-range-${d}"]`).click();
    await admPage.waitForURL((u) => u.searchParams.get("range") === String(d), { timeout: 30000 });
    await admPage.waitForTimeout(800);
  }
  record("KPI dashboard: the 7 / 30 / 90 day range links work", true);
  await shot(admPage, "kpi-dashboard-admin");
  await admPage.context().close();
  const mgr2 = await newPage(U.mgr);
  await mgr2.goto(`${BASE}/analytics/carpool`, { waitUntil: "load" });
  record("KPI dashboard: fleet_manager can open it", new URL(mgr2.url()).pathname === "/analytics/carpool");
  await mgr2.context().close();
  for (const who of ["host", "emp"]) {
    const p = await newPage(U[who]);
    await p.goto(`${BASE}/analytics/carpool`, { waitUntil: "load" });
    await p.waitForTimeout(800);
    record(`KPI dashboard: employee (${who}) is redirected away`, new URL(p.url()).pathname !== "/analytics/carpool", { landed: new URL(p.url()).pathname });
    await p.context().close();
  }

  // ---------------------------------------------------------------- M3: team screen never wipes a CNH
  const adminTeam = await newPage(U.adm);
  await adminTeam.goto(`${BASE}/settings/users`, { waitUntil: "load" });
  await adminTeam.waitForTimeout(2000);
  const lic0 = (await sql(`select drivers_license_number n, drivers_license_category c, drivers_license_expiration e, driver_authorized a from profiles where id='${U.emp.id}'`))[0];
  const row = adminTeam.locator("tr", { hasText: U.emp.fullName });
  await row.locator('input[name="driverAuthorized"]').click();
  await adminTeam.waitForTimeout(2500);
  const lic1 = (await sql(`select drivers_license_number n, drivers_license_category c, drivers_license_expiration e, driver_authorized a from profiles where id='${U.emp.id}'`))[0];
  record("M3: toggling driver authorization changes ONLY driver_authorized (CNH number / category / expiry untouched)", lic1.a !== lic0.a && lic1.n === lic0.n && lic1.c === lic0.c && String(lic1.e) === String(lic0.e), { before: lic0, after: lic1 });
  await row.locator('input[name="licenseCategory"]').fill("AB");
  await row.locator('input[name="licenseCategory"]').blur();
  await adminTeam.waitForTimeout(2500);
  const lic2 = (await sql(`select drivers_license_number n, drivers_license_category c, drivers_license_expiration e, driver_authorized a from profiles where id='${U.emp.id}'`))[0];
  record("M3: editing the license category changes ONLY the license columns (driver_authorized untouched)", lic2.c === "AB" && lic2.n === lic0.n && lic2.a === lic1.a, { after: lic2 });
  await shot(adminTeam, "m3-team-screen");
  await adminTeam.context().close();

  // ---------------------------------------------------------------- 4b: vehicleOptions survive a reload
  const [conv] = await sql(`insert into chat_conversations (organization_id, user_id, status) values ('${A.orgId}', '${U.emp.id}', 'active') returning id`);
  const slots = { origin: "Av Paulista 1000, São Paulo", destination: "Campinas", departureAt: "2026-10-05T08:00:00-03:00", expectedReturnAt: "2026-10-05T18:00:00-03:00", passengerCount: "1", requiresCargo: "false", distanceKm: "100", allowCarpool: "false", preferredVehicleId: A.vehicles[0].id };
  const vopts = [{ vehicleId: A.vehicles[0].id, plate: A.vehicles[0].plate, vehicleName: "SUV Um" }, { vehicleId: A.vehicles[1].id, plate: A.vehicles[1].plate, vehicleName: "SUV Dois" }];
  const esc = (o) => JSON.stringify(o).replace(/'/g, "''");
  await sql(`insert into chat_messages (conversation_id, role, content, intent, slots) values ('${conv.id}', 'user', 'reservar para Campinas', null, null), ('${conv.id}', 'assistant', 'Vou reservar o veículo SUV Um ' || '${XSS1.replace(/'/g, "''")}', 'CREATE_RESERVATION', '${esc({ ...slots, __vehicle_options: JSON.stringify(vopts) })}'::jsonb)`);
  const chatPage = await newPage(U.emp);
  await chatPage.goto(`${BASE}/trips`, { waitUntil: "load" });
  await chatPage.waitForSelector('button[type="button"][aria-label="Assistente Fleet"]', { timeout: 60000 });
  await chatPage.waitForTimeout(1500);
  await chatPage.click('button[type="button"][aria-label="Assistente Fleet"]');
  const dlg = chatPage.locator('[role="dialog"][aria-label="Assistente Fleet"]');
  await dlg.waitFor({ state: "visible" });
  await chatPage.waitForTimeout(1500);
  const btns = await dlg.locator("button").allInnerTexts();
  const numbered = btns.filter((b) => /^\d\. /.test(b.trim()));
  record("4b: after a PAGE RELOAD the chat card shows the vehicle alternatives as numbered buttons again", numbered.length === 2 && numbered[0].includes("SUV Um") && numbered[1].includes("SUV Dois"), numbered);
  const chatInert = await inert(chatPage);
  record("chat: an assistant message / confirmation summary containing an XSS payload is rendered as inert text after reload", chatInert.xss === 0 && chatInert.imgX === 0 && chatInert.injectedScripts === 0, { xss: chatInert.xss, imgX: chatInert.imgX, sawPayloadText: (await dlg.innerText()).includes("<img src=x") });
  await shot(chatPage, "chat-vehicle-options-after-reload");
  await chatPage.context().close();
  // tampered persisted list (non-uuid id): the card falls back to the plain confirmation, no buttons, no crash
  await sql(`update chat_messages set slots = '${esc({ ...slots, __vehicle_options: JSON.stringify([{ vehicleId: "../x", plate: "A", vehicleName: "<b>x</b>" }, vopts[1]]) })}'::jsonb where conversation_id='${conv.id}' and role='assistant'`);
  const chat2 = await newPage(U.emp);
  await chat2.goto(`${BASE}/trips`, { waitUntil: "load" });
  await chat2.waitForSelector('button[type="button"][aria-label="Assistente Fleet"]', { timeout: 60000 });
  await chat2.waitForTimeout(1500);
  await chat2.click('button[type="button"][aria-label="Assistente Fleet"]');
  const dlg2 = chat2.locator('[role="dialog"][aria-label="Assistente Fleet"]');
  await dlg2.waitFor({ state: "visible" });
  await chat2.waitForTimeout(1500);
  const btns2 = (await dlg2.locator("button").allInnerTexts()).filter((b) => /^\d\. /.test(b.trim()));
  const text2 = await dlg2.innerText();
  record("4b: a TAMPERED persisted vehicle list is rejected on restore (no numbered buttons; plain confirmation card)", btns2.length === 0 && text2.includes("Vou reservar o veículo"), { buttons: btns2.length });
  await chat2.context().close();
} finally {
  await cleanupOrgs(orgs);
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
void T;
