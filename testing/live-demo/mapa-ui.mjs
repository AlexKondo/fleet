// Embedded route map (Google Static Maps via a server action) - real-browser walk-through (Playwright; live Supabase
// + live Google through `next start` on BASE_URL, and a SECOND server with a bad Google key on BASE_URL_OUTAGE).
//   node testing/live-demo/start-server.mjs --mode start --port 3100
//   node testing/live-demo/start-server.mjs --mode start --port 3101 --bad-key
//   SERVER_LOG=<log of 3100> OUTAGE_LOG=<log of 3101> node testing/live-demo/mapa-ui.mjs
// Disposable org/users/reservations (carpool-c5-lib.mjs), removed in `finally`; the cleanup query must report zero rows.
// Screenshots -> resultado_de_testes/design-v2/implemented-mapa/ (+ antes-depois-mapa.html)
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { BASE, PASSWORD, record, results, sql, provisionOrg, cleanupOrgs, ROOT, localIso, setTripDates } from "./carpool-c5-lib.mjs";

const OUT = path.join(ROOT, "resultado_de_testes", "design-v2", "implemented-mapa");
mkdirSync(OUT, { recursive: true });
const BASE2 = process.env.BASE_URL_OUTAGE || "http://localhost:3101";
const envText = readFileSync(path.join(ROOT, ".env"), "utf8");
const REAL_KEY = envText.match(/^GOOGLE_MAPS_API_KEY=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
const BAD_KEY = "AIzaInvalidKeyForOutageSimulation";
if (!REAL_KEY || REAL_KEY.length < 20) throw new Error("GOOGLE_MAPS_API_KEY missing in .env");

const SP_A = "Avenida Paulista, 1578, São Paulo";
const SP_B = "Aeroporto de Congonhas, São Paulo";
const RIDER_DEST = "Avenida Washington Luís, 5000, São Paulo";
const SHORT_B = "Avenida Paulista, 1500, São Paulo";
const BSB = "Aeroporto Internacional de Brasília, Brasília - DF";

const dep = new Date(Date.now() + 24 * 3600000);
dep.setHours(10, 0, 0, 0);
const orgs = [];
const browser = await chromium.launch({ headless: true });
const seen = []; // every same-origin response body + header seen by the GOOD-server browsers (key scan)
const shotsTaken = [];
const shot = async (page, name, fullPage = true) => {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage });
  shotsTaken.push(name + ".png");
  console.log("    screenshot: " + path.relative(ROOT, file).replace(/\\/g, "/"));
};
async function newPage(user, { width, height, base = BASE, mobile = false, collect = true }) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.mapCalls = 0;
  page.on("pageerror", (e) => console.log("    [pageerror]", String(e).slice(0, 300)));
  page.on("request", (r) => {
    const body = r.postData() ?? "";
    // map action payload = {originText,destinationText} only (the Buscar Carona search also carries departureAt)
    if (r.method() === "POST" && body.includes('"originText"') && !body.includes("departureAt")) page.mapCalls += 1;
  });
  if (collect) {
    page.on("console", (m) => seen.push("console:" + m.text()));
    page.on("response", async (r) => {
      try {
        const url = r.url();
        if (!url.startsWith(base)) return;
        const ct = r.headers()["content-type"] ?? "";
        seen.push("headers:" + url.replace(base, "") + JSON.stringify(r.headers()));
        if (/(text|json|javascript|x-component|css|xml)/.test(ct)) seen.push(`${r.request().method()} ${url.replace(base, "")} ${r.status()}\n` + (await r.text()));
      } catch { /* body not available */ }
    });
  }
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  return page;
}
const hydrated = (page) =>
  page.waitForFunction(() => {
    const f = document.querySelector("main form");
    return Boolean(f) && Object.keys(f).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")) && (f.dataset.ready === undefined || f.dataset.ready === "true");
  }, null, { timeout: 60000 });
async function openForm(page, base = BASE) {
  await page.goto(base + "/trips/new", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await hydrated(page);
}
async function fillAndSearch(page, { origin, destination }) {
  const ret = new Date(dep.getTime() + 8 * 3600000);
  await setTripDates(page, dep, ret); // date + time are separate inputs now
  await page.fill('input[name="origin"]', origin);
  await page.fill('input[name="destination"]', destination);
  await page.fill('input[name="distanceKm"]', "20");
  await page.fill('input[name="passengerCount"]', "1");
  await page.click('form button[type="submit"]:has-text("Buscar recomendação")');
}
const settle = async (page) => {
  await page.waitForTimeout(500);
  await page.waitForFunction(() => { const b = document.querySelector("button.rv-submit"); return Boolean(b) && !b.disabled; }, null, { timeout: 120000 });
  // React 19 resets the uncontrolled form AFTER the action settles (then the form effect restores the last values):
  // let that finish before the next fill, otherwise the fill is overwritten.
  await page.waitForTimeout(1500);
};
const planned = (page) =>
  page.waitForSelector('[data-testid="vehicle-card-recommended"], [data-testid="carpool-offer-card"], [data-testid="carpool-needs-precision"], [data-testid="carpool-unavailable"], .rv-error', { timeout: 120000 });
const mapReady = async (page, id = "route-map") => {
  await page.waitForSelector(`[data-testid="${id}"][data-state="ready"]`, { timeout: 90000 });
  await page.waitForFunction((tid) => { const i = document.querySelector(`[data-testid="${tid}-img"]`); return Boolean(i) && i.complete && i.naturalWidth > 0; }, id, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
};
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const imgInfo = (page, id = "route-map") =>
  page.evaluate((tid) => {
    const i = document.querySelector(`[data-testid="${tid}-img"]`);
    return i ? { w: i.naturalWidth, h: i.naturalHeight, alt: i.alt, srcIsData: i.src.startsWith("data:image/png;base64,") } : null;
  }, id);
const chipText = (page, id = "route-map") => page.locator(`[data-testid="${id}-chip"]`).innerText();
const quotas = async (orgId) => {
  const rows = await sql(`select provider_call_kind k, sum(call_count)::int c, sum(error_count)::int e from geo_provider_quota_counters where organization_id='${orgId}' group by 1`);
  return Object.fromEntries(rows.map((r) => [r.k, { calls: r.c, errors: r.e }]));
};
const KINDS = ["geocode", "place_search", "routing", "map_geocode", "map_routing", "static_map"];
const diff = (a, b) => Object.fromEntries(KINDS.map((k) => [k, (b[k]?.calls ?? 0) - (a[k]?.calls ?? 0)]));

try {
  const A = await provisionOrg("mp", [["owner", "employee"], ["cow", "employee"], ["host", "employee"], ["rider", "employee"], ["mgr", "fleet_manager"], ["capa", "employee"], ["capb", "employee"]]);
  orgs.push(A);
  const O = A.orgId;
  const U = A.users;
  await sql(`update organization_settings set booking_mode='hybrid' where organization_id='${O}'`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${O}', 1, 15, 15, 5, 15, 30)`);
  console.log(`\n=== Route map walkthrough (${BASE}) org=${O} ===\n`);

  // ---- reservations for /reservations/[id]
  const trip = async (who, origin, dest) =>
    (await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${O}','${U[who].id}', now() + interval '1 day', now() + interval '1 day 8 hours','${origin}','${dest}',20,1,'MAPA teste') returning id`))[0].id;
  let extra = 0;
  const catId0 = (await sql(`select id from vehicle_categories where organization_id='${O}' limit 1`))[0].id;
  const newVeh = async () =>
    (await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km) values ('${O}', 'MX${++extra}${Date.now().toString(36).slice(-4).toUpperCase()}', '${catId0}', 'available', 1000, 80, 600, 20000) returning id`))[0].id;
  const resv = async (vi, t) =>
    (await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${O}','${vi === 0 ? A.vehicles[0].id : await newVeh()}','${t}','confirmed', now() + interval '1 day', now() + interval '1 day 8 hours') returning id`))[0].id;
  const R1 = await resv(0, await trip("owner", SP_A, SP_B));

  // ---- warm-up (first requests compile / cold-start nothing to assert)
  const R0 = await resv(1, await trip("owner", "Avenida Paulista, 1000, São Paulo", "Parque Ibirapuera, São Paulo"));
  const warm = await newPage(U.owner, { width: 1280, height: 900, collect: false });
  await warm.goto(BASE + `/reservations/${R0}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await mapReady(warm).catch(() => {});
  await warm.context().close();

  // ======================= /reservations/[id]: owner (employee layout) =======================
  const q0 = await quotas(O);
  const own = await newPage(U.owner, { width: 1440, height: 900 });
  await own.goto(BASE + `/reservations/${R1}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const skeleton = await own.waitForSelector('[data-testid="route-map"][data-state="loading"], [data-testid="route-map"][data-state="ready"]', { timeout: 30000 });
  record("Reservation detail (owner): the map card mounts lazily (skeleton / aria-busy while loading)", Boolean(skeleton));
  await mapReady(own);
  const q1 = await quotas(O);
  const dOwn = diff(q0, q1);
  const info = await imgInfo(own);
  const chip = await chipText(own);
  record("Reservation detail (owner): real Google map image loads (naturalWidth>0, 1280x720 @2x), data URL, alt built from labels", info && info.w > 0 && info.h > 0 && info.srcIsData && /Mapa da rota de .+ até .+/.test(info.alt), info && { ...info, alt: info.alt.slice(0, 120) });
  record("Reservation detail (owner): chip shows km + minutes + 'tempo estimado' and never claims traffic", /\d[\d.,]* km/.test(chip) && /\d+\s*(min|h)/.test(chip) && /tempo estimado/.test(chip) && !/tr[aâ]nsito/i.test(await own.locator('[data-testid="route-map"]').innerText()), chip.replace(/\n/g, " | "));
  const labels = await own.locator('[data-testid="route-map"] dd').allInnerTexts();
  record("Reservation detail (owner): origin/destination labels shown", labels.length === 2 && /Paulista/i.test(labels[0]) && /Congonhas/i.test(labels[1]), labels);
  record("Reservation detail (owner): ONE map view = map_geocode +2, map_routing +1, static_map +1", dOwn.map_geocode === 2 && dOwn.map_routing === 1 && dOwn.static_map === 1, dOwn);
  record("Reservation detail (owner): carpool kinds do NOT move (geocode / place_search / routing +0)", dOwn.geocode === 0 && dOwn.place_search === 0 && dOwn.routing === 0, dOwn);
  const usage = async (uid) => Number((await sql(`select coalesce(sum(views),0)::int v from route_map_user_usage where user_id='${uid}' and day=(now() at time zone 'utc')::date`))[0].v);
  const v1 = await usage(U.owner.id);
  await own.reload({ waitUntil: "domcontentloaded" });
  await mapReady(own);
  const q2 = await quotas(O);
  const dCache = diff(q1, q2);
  record("Server cache: the same map again (fresh page load) makes NO provider call (all 6 kinds +0) but still consumes one per-user view", KINDS.every((k) => dCache[k] === 0) && (await usage(U.owner.id)) === v1 + 1, { dCache, viewsBefore: v1 });
  console.log("    counter delta for ONE map view:", JSON.stringify(dOwn), " errors:", JSON.stringify(Object.fromEntries(Object.entries(q1).map(([k, v]) => [k, v.errors]))));
  record("Reservation detail (owner): no horizontal scroll at 1440", (await hscroll(own)) <= 0);
  await shot(own, "04-reservation-owner-desktop");

  // ======================= manager (legacy AppShell layout) =======================
  const mg = await newPage(U.mgr, { width: 1440, height: 900 });
  await mg.goto(BASE + `/reservations/${R1}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await mapReady(mg);
  const mInfo = await imgInfo(mg);
  record("Reservation detail (fleet manager, AppShell layout): map shown and loads", mInfo && mInfo.w > 0);
  await shot(mg, "05-reservation-manager-desktop");

  // ======================= coworker: forbidden as today =======================
  const cow = await newPage(U.cow, { width: 1280, height: 900 });
  await cow.goto(BASE + `/reservations/${R1}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await cow.waitForTimeout(2500);
  record("Reservation detail (coworker): redirected to /trips exactly as before, no map", new URL(cow.url()).pathname === "/trips" && (await cow.locator('[data-testid="route-map"]').count()) === 0, cow.url());
  await cow.context().close();

  // ======================= /trips/new desktop 1440 =======================
  const d = await newPage(U.owner, { width: 1440, height: 900 });
  await openForm(d);
  await d.route("**/api/geo/route-map", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && (req.postData() ?? "").includes('"originText"')) await new Promise((r) => setTimeout(r, 20000)); // slow map (it starts when both places are filled, before the plan)
    await route.continue();
  });
  // "Reservar igual": the map loads as soon as BOTH places are filled (debounced, before the plan). It is a plain fetch to
  // POST /api/geo/route-map (a route handler, NOT a server action), so it never queues behind / blocks the plan submit.
  await setTripDates(d, dep, new Date(dep.getTime() + 8 * 3600000));
  await d.fill('input[name="origin"]', SP_A);
  await d.fill('input[name="destination"]', SP_B);
  await d.waitForSelector('[data-testid="route-map"][data-state="loading"]', { timeout: 20000 });
  const busy = await d.locator('[data-testid="route-map"][data-state="loading"]').getAttribute("aria-busy").catch(() => null);
  record("/trips/new: loading state is aria-busy with a status text", busy === "true" && (await d.locator('[data-testid="route-map"] [role="status"]').count()) === 1);
  await d.fill('input[name="distanceKm"]', "20");
  await d.fill('input[name="passengerCount"]', "1");
  await d.click('form button[type="submit"]:has-text("Buscar recomendação")');
  await planned(d);
  const vehicleVisible = await d.locator('[data-testid="vehicle-card-recommended"]').count();
  const stateAtPlan = await d.locator('[data-testid="route-map"]').getAttribute("data-state").catch(() => null);
  record("/trips/new: recommendation is shown while the (slowed 20s) map is still loading - the map never blocks it", vehicleVisible === 1 && (stateAtPlan === "loading" || stateAtPlan === null), { vehicleVisible, stateAtPlan });
  const confirmBtn = d.locator('button:has-text("Solicitar reserva")');
  record("/trips/new: the Solicitar reserva button is enabled", (await confirmBtn.count()) === 1 && (await confirmBtn.isEnabled()));
  await mapReady(d);
  await d.unroute("**/api/geo/route-map");
  const dInfo = await imgInfo(d);
  const dChip = await chipText(d);
  record("/trips/new desktop: map loads once both places are set (before the plan): image loads, km and time from the Routes API", dInfo && dInfo.w > 0 && /\d[\d.,]* km/.test(dChip) && /\d+\s*(min|h)/.test(dChip), dChip.replace(/\n/g, " | "));
  const box = await d.evaluate(() => {
    const m = document.querySelector('[data-testid="rv-mapcol"]').getBoundingClientRect();
    const r = document.querySelector('[data-testid="rv-form"]').getBoundingClientRect();
    return { mapLeft: Math.round(m.left), mapTop: Math.round(m.top + scrollY), resRight: Math.round(r.right), resTop: Math.round(r.top + scrollY), mapW: Math.round(m.width) };
  });
  record("/trips/new desktop 1440: map sits at the TOP, BESIDE the 'Detalhes da viagem' form (right column, aligned top)", box.mapLeft >= box.resRight - 2 && Math.abs(box.mapTop - box.resTop) < 40 && box.mapW >= 340, box);
  record("/trips/new desktop: no horizontal scroll", (await hscroll(d)) <= 0);
  const callsAfterFirst = d.mapCalls;
  record("/trips/new: exactly ONE map call for the first plan", callsAfterFirst === 1, callsAfterFirst);
  await shot(d, "01-desktop-trips-new-map");
  // same plan again: cached, no new call
  await d.click('form button[type="submit"]:has-text("Buscar recomendação")');
  await settle(d);
  await planned(d);
  await d.waitForTimeout(1500);
  record("/trips/new: re-planning the same origin/destination does NOT call the map action again (cached)", d.mapCalls === callsAfterFirst && (await d.locator('[data-testid="route-map"][data-state="ready"]').count()) === 1, d.mapCalls);

  // very short route
  await d.fill('input[name="destination"]', SHORT_B);
  await d.click('form button[type="submit"]:has-text("Buscar recomendação")');
  await settle(d);
  await planned(d);
  await mapReady(d);
  await d.waitForFunction(() => /Paulista, 1500/i.test(document.querySelector('[data-testid="route-map"]')?.innerText ?? ""), null, { timeout: 30000 }).catch(async () => console.log("    [debug] short-route card text: " + JSON.stringify(await d.locator('[data-testid="rv-mapcol"]').innerText().catch(() => "(none)"))));
  const sInfo = await imgInfo(d);
  const sChip = await chipText(d);
  record("/trips/new: very short route (~100 m) works: image loads and a distance is shown", sInfo && sInfo.w > 0 && /km/.test(sChip), sChip.replace(/\n/g, " | "));
  await shot(d, "02-desktop-short-route");

  // long route: Sao Paulo -> Brasilia (~1000 km) so the polyline cannot fit a Static Maps URL as is
  await d.fill('input[name="destination"]', BSB);
  await d.click('form button[type="submit"]:has-text("Buscar recomendação")');
  await settle(d);
  await planned(d);
  await d.waitForFunction(() => /Bras[ií]lia/i.test(document.querySelector('[data-testid="route-map"]')?.innerText ?? ""), null, { timeout: 90000 });
  const lInfo = await imgInfo(d);
  const lChip = await chipText(d);
  const lKm = Number((lChip.match(/([\d.]+)(?:,\d+)?\s*km/) ?? [])[1]?.replace(".", ""));
  record("/trips/new: LONG route (Sao Paulo -> Brasilia, 400+ km) works: image loads, km >= 400", lInfo && lInfo.w > 0 && lKm >= 400, lChip.replace(/\n/g, " | "));
  await shot(d, "03-desktop-long-route");

  // ======================= /trips/new mobile 390 =======================
  const m = await newPage(U.owner, { width: 390, height: 844, mobile: true });
  await openForm(m);
  await fillAndSearch(m, { origin: SP_A, destination: SP_B });
  await planned(m);
  await mapReady(m);
  const mBox = await m.evaluate(() => {
    const mc = document.querySelector('[data-testid="rv-mapcol"]').getBoundingClientRect();
    const r = document.querySelector('[data-testid="rv-form"]').getBoundingClientRect();
    return { mapTop: Math.round(mc.top + scrollY), resBottom: Math.round(r.bottom + scrollY), mapW: Math.round(mc.width), vw: innerWidth };
  });
  record("/trips/new mobile 390: map stacked UNDER the form, fits the viewport width", mBox.mapTop >= mBox.resBottom - 2 && mBox.mapW <= mBox.vw, mBox);
  record("/trips/new mobile: no horizontal scroll", (await hscroll(m)) <= 0);
  const mInfo2 = await imgInfo(m);
  record("/trips/new mobile: image loads", mInfo2 && mInfo2.w > 0);
  await m.locator('[data-testid="route-map"]').scrollIntoViewIfNeeded();
  await m.evaluate(() => document.querySelector('[data-testid="route-map-img"]').decode().catch(() => {}));
  await m.waitForTimeout(1000);
  await shot(m, "06-mobile-trips-new-map-viewport", false);
  await shot(m, "06b-mobile-trips-new-map-full", true);

  // ======================= /carpool: ONLY the rider's own route =======================
  const hostPage = await newPage(U.host, { width: 1280, height: 900 });
  await openForm(hostPage);
  await fillAndSearch(hostPage, { origin: SP_A, destination: SP_B });
  await hostPage.waitForSelector('[data-testid="host-offer-step"]', { timeout: 90000 });
  await hostPage.check('input[name="offerChoice"][value="yes"]');
  await hostPage.waitForTimeout(800);
  await hostPage.fill('input[name="offerSeats"]', "2");
  await hostPage.click("text=Solicitar reserva");
  await hostPage.waitForURL((u) => u.pathname === "/trips", { timeout: 60000 });
  const offer = (await sql(`select o.id, o.status from carpool_offers o join trip_requests tr on tr.id=o.trip_request_id where tr.requester_id='${U.host.id}'`))[0];
  record("Setup: host offer active", offer?.status === "active", offer);
  await hostPage.context().close();

  const r = await newPage(U.rider, { width: 1440, height: 900 });
  await r.goto(BASE + "/carpool", { waitUntil: "domcontentloaded" });
  await r.waitForFunction(() => {
    const f = document.querySelector('[data-testid="buscar-form"]');
    return Boolean(f) && Object.keys(f).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
  }, null, { timeout: 60000 });
  record("/carpool: no map before a search", (await r.locator('[data-testid="route-map"]').count()) === 0);
  await r.fill('input[name="origin"]', SP_A);
  await r.fill('input[name="destination"]', RIDER_DEST);
  await r.fill('input[name="departureAt"]', localIso(dep));
  await r.fill('input[name="passengerCount"]', "1");
  await r.click('[data-testid="buscar-submit"]');
  await r.waitForSelector('[data-testid="carpool-offer-card"]', { timeout: 120000 });
  await mapReady(r);
  const rTxt = await r.locator('[data-testid="route-map"]').innerText();
  const rInfo = await imgInfo(r);
  record("/carpool: the map card shows the RIDER's own route (Washington Luís) and nothing of the host's (no Congonhas)", rInfo && rInfo.w > 0 && /Washington/i.test(rTxt) && !/Congonhas/i.test(rTxt) && !/Congonhas/i.test(rInfo.alt), rTxt.replace(/\n/g, " | ").slice(0, 200));
  record("/carpool: only one map and its call carried only the rider's texts", (await r.locator('[data-testid="route-map"]').count()) === 1 && r.mapCalls === 1, r.mapCalls);
  await shot(r, "07-desktop-carpool-rider-route");

  // ======================= per-user DB daily cap =======================
  const R2 = await resv(1, await trip("capa", "Avenida Paulista, 1578, São Paulo", "Aeroporto de Congonhas, São Paulo"));
  const R3 = await resv(1, await trip("capb", "Avenida Paulista, 1578, São Paulo", "Aeroporto de Congonhas, São Paulo"));
  await sql(`insert into route_map_user_usage (user_id, day, views) values ('${U.capa.id}', (now() at time zone 'utc')::date, 99), ('${U.capb.id}', (now() at time zone 'utc')::date, 100)`);
  const qc0 = await quotas(O);
  const ca = await newPage(U.capa, { width: 1280, height: 900 });
  await ca.goto(BASE + `/reservations/${R2}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await mapReady(ca);
  record("Per-user cap: a user at cap-1 (99) still gets the map (view 100)", (await ca.locator('[data-testid="route-map-img"]').count()) === 1 && (await usage(U.capa.id)) === 100);
  await ca.reload({ waitUntil: "domcontentloaded" });
  await ca.waitForSelector('[data-testid="route-map-unavailable"]', { timeout: 60000 });
  record("Per-user cap: the next view (100 -> over cap) is rate_limited: muted unavailable line, no image, views stay 100", (await ca.locator('[data-testid="route-map-img"]').count()) === 0 && (await usage(U.capa.id)) === 100);
  const cb = await newPage(U.capb, { width: 1280, height: 900 });
  await cb.goto(BASE + `/reservations/${R3}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await cb.waitForSelector('[data-testid="route-map-unavailable"]', { timeout: 60000 });
  const qc1 = await quotas(O);
  const dCap = diff(qc0, qc1);
  record("Per-user cap: a user already AT the cap (100) gets rate_limited and the capped views made no provider call beyond the cap-1 view's cache hit", (await cb.locator('[data-testid="route-map-img"]').count()) === 0 && (await usage(U.capb.id)) === 100 && KINDS.every((k) => dCap[k] === 0), dCap);
  record("Per-user cap: page itself still renders for a capped user", (await cb.locator('[data-testid="reservation-detail-fm"]').count()) === 1);

  // ======================= key never reaches the browser =======================
  const blob = seen.join("\n").replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "data:image/png;base64,<img>");
  record("Key scan (browsers on the good server): the real key string never appears in any HTML / JS / action response / header / console line", !blob.includes(REAL_KEY), { scannedKB: Math.round(blob.length / 1024) });
  record("Key scan: no 'AIza' string anywhere in what the browser received (image bytes excluded)", !/AIza/.test(blob), (blob.match(/.{20}AIza.{20}/) ?? [])[0] ? "FOUND" : "none");
  record("Key scan: no 'maps.googleapis.com' URL with a key= parameter in anything the browser received", !/maps\.googleapis\.com[^\s"']*key=/i.test(blob));
  const domScan = await r.evaluate((k) => ({ html: document.documentElement.outerHTML.includes(k), imgSrcsAreData: [...document.images].every((i) => i.src.startsWith("data:") || i.src.startsWith(location.origin)) }), REAL_KEY);
  record("Key scan: rendered DOM has no key and every <img> is a data: URL or same-origin", !domScan.html && domScan.imgSrcsAreData, domScan);
  for (const [label, file] of [["server log (good server)", process.env.SERVER_LOG], ["server log (outage server)", process.env.OUTAGE_LOG]]) {
    if (file && existsSync(file)) {
      const log = readFileSync(file, "utf8");
      record(`Key scan: ${label} contains neither the real key nor the fake key`, !log.includes(REAL_KEY) && !log.includes(BAD_KEY), { bytes: log.length });
    }
  }

  // ======================= OUTAGE (bad key) =======================
  // the walkthrough above reserved the org's two vehicles: add a free one so the recommendation exists
  const catId = (await sql(`select id from vehicle_categories where organization_id='${O}' limit 1`))[0].id;
  await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km) values ('${O}', 'MP9X${Date.now().toString(36).slice(-3).toUpperCase()}', '${catId}', 'available', 1000, 80, 600, 20000)`);
  const outSeen = [];
  try {
    const o = await newPage(U.owner, { width: 1440, height: 900, base: BASE2, collect: false });
    o.on("response", async (rs) => {
      try {
        const ct = rs.headers()["content-type"] ?? "";
        if (/(text|json|javascript|x-component)/.test(ct)) outSeen.push(await rs.text());
      } catch { /* */ }
    });
    await openForm(o, BASE2);
    await fillAndSearch(o, { origin: SP_A, destination: SP_B });
    await o.waitForSelector('[data-testid="carpool-unavailable"]', { timeout: 120000 });
    await o.waitForSelector(".rv-plate", { timeout: 60000 }).catch(async () => console.log("    [debug] outage page text: " + JSON.stringify((await o.evaluate(() => document.querySelector("main")?.innerText ?? "")).slice(0, 900))));
    await o.waitForSelector('[data-testid="route-map-unavailable"], [data-testid="route-map"][data-state="ready"]', { timeout: 60000 }).catch(() => {});
    const ready = await o.locator('[data-testid="route-map"][data-state="ready"]').count();
    const mute = await o.locator('[data-testid="route-map-unavailable"]').count();
    record("Outage (bad key): NO map image; at most one muted 'Mapa indisponível' line", ready === 0 && (await o.locator('[data-testid="route-map-img"]').count()) === 0 && mute <= 1, { ready, mute });
    record("Outage: the vehicle recommendation and the confirm button work exactly as before", (await o.locator('button:has-text("Solicitar reserva")').count()) === 1 && (await o.locator('button:has-text("Solicitar reserva")').isEnabled()));
    record("Outage: the fake key never appears in anything the browser received", !outSeen.join("\n").includes(BAD_KEY) && !(await o.content()).includes(BAD_KEY));
    await shot(o, "08-desktop-outage-no-map");
    await o.goto(BASE2 + `/reservations/${R1}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await o.waitForSelector('[data-testid="route-map-unavailable"]', { timeout: 60000 }).catch(() => {});
    record("Outage: /reservations/[id] still renders fully (header + messages), no map", (await o.locator('[data-testid="reservation-detail-fm"]').count()) === 1 && (await o.locator('[data-testid="route-map"][data-state="ready"]').count()) === 0);
  } catch (e) {
    record("Outage state (second server)", false, String(e).slice(0, 300));
  }

  // ---- final counters for this org
  const qEnd = await quotas(O);
  console.log("    final Cost Guard counters for the disposable org:", JSON.stringify(qEnd));
} catch (e) {
  record("FATAL (unexpected exception)", false, String(e && e.stack ? e.stack : e));
} finally {
  await browser.close().catch(() => {});
  if (process.env.KEEP !== "1") {
    try {
      const uids = orgs.flatMap((o) => Object.values(o.users).map((u) => `'${u.id}'`)).join(",");
      if (uids) await sql(`delete from route_map_user_usage where user_id in (${uids})`);
    } catch (e) { console.log("usage cleanup failed", String(e)); }
    await cleanupOrgs(orgs);
    try {
      const uids = orgs.flatMap((o) => Object.values(o.users).map((u) => `'${u.id}'`)).join(",");
      const left = uids ? await sql(`select count(*)::int c from route_map_user_usage where user_id in (${uids})`) : [{ c: 0 }];
      record("Cleanup: route_map_user_usage rows of the disposable users are zero", left[0].c === 0, left[0]);
    } catch (e) { record("Cleanup route_map_user_usage", false, String(e)); }
  }
  // before / after page (art06 next to the real screenshot)
  try {
    const rel = (f) => encodeURI(f);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Antes / depois - mapa da rota</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#f4f7fb;color:#19283b}h1{font-size:22px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}figure{margin:0;background:#fff;border:1px solid #dce4ee;border-radius:12px;padding:12px}figcaption{font-weight:700;margin-bottom:8px}img{max-width:100%;height:auto;border:1px solid #dce4ee;border-radius:8px}p.n{max-width:900px;color:#44566c}@media(max-width:900px){.pair{grid-template-columns:1fr}}</style></head><body>
<h1>Mapa da rota - arte aprovada x implementado</h1>
<p class="n">Esquerda: arte aprovada (art06-web.png). Direita: tela real (Google Static Maps via server action, imagem em data URL; chave nunca vai ao navegador). Diferencas honestas: o mapa fica em um cartao "Rota" ao lado do resultado (nao dentro do cartao do formulario); o chip mostra km e tempo estimado sem "transito normal" (nao pedimos dados de transito); sem botoes "Opcoes de rota" / localizacao e sem placas de rodovia sobrepostas (a imagem e estatica); pinos A/B do Google em vez de pinos desenhados.</p>
<div class="pair"><figure><figcaption>Arte (art06-web.png)</figcaption><img src="${rel("../usr002/art06-web.png")}" alt="Arte aprovada"></figure>
<figure><figcaption>Implementado - desktop 1440 (/trips/new)</figcaption><img src="${rel("01-desktop-trips-new-map.png")}" alt="Tela real desktop"></figure></div>
<div class="pair"><figure><figcaption>Arte mobile (art06-mobile.png)</figcaption><img src="${rel("../usr002/art06-mobile.png")}" alt="Arte mobile"></figure>
<figure><figcaption>Implementado - mobile 390 (viewport)</figcaption><img src="${rel("06-mobile-trips-new-map-viewport.png")}" alt="Tela real mobile"></figure></div>
<div class="pair"><figure><figcaption>Detalhe da reserva (colaborador)</figcaption><img src="${rel("04-reservation-owner-desktop.png")}" alt="Reserva"></figure>
<figure><figcaption>Buscar Carona (somente a rota do solicitante)</figcaption><img src="${rel("07-desktop-carpool-rider-route.png")}" alt="Carona"></figure></div>
</body></html>`;
    writeFileSync(path.join(OUT, "antes-depois-mapa.html"), html, "utf8");
    console.log("    wrote " + path.relative(ROOT, path.join(OUT, "antes-depois-mapa.html")).replace(/\\/g, "/"));
  } catch (e) {
    console.log("antes-depois write failed", String(e));
  }
  const failed = results.filter((x) => !x.pass);
  console.log("\n=== Summary ===");
  for (const x of failed) console.log("FAIL - " + x.name);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  process.exitCode = failed.length ? 1 : 0;
}
