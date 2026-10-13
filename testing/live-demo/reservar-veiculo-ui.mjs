// SCR-USR-002 "Reservar Veiculo" (/trips/new, FleetMind v2.0 look) real-browser walk-through (Playwright; live Supabase
// + live Google through `next start` on BASE_URL, and a SECOND server with a bad Google key on BASE_URL_OUTAGE).
// Disposable org/users/offers (carpool-c5-lib.mjs), removed in `finally`; the cleanup query must report zero rows.
// Screenshots -> resultado_de_testes/design-v2/implemented-usr002/
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BASE, PASSWORD, record, results, sql, provisionOrg, cleanupOrgs, ROOT, localIso, setTripDates,
} from "./carpool-c5-lib.mjs";

const OUT = path.join(ROOT, "resultado_de_testes", "design-v2", "implemented-usr002");
mkdirSync(OUT, { recursive: true });
const BASE2 = process.env.BASE_URL_OUTAGE || "http://localhost:3101";

const HOST_ORIGIN = "Avenida Paulista, 1578, São Paulo";
const HOST_DEST = "Aeroporto de Congonhas, São Paulo";
const RIDER_ORIGIN = "Avenida Paulista, 1578, São Paulo";
const RIDER_DEST = "Avenida Washington Luís, 5000, São Paulo";
const FAR_DEST = "Terminal Rodoviário de Campinas, Campinas, SP";

const dep = new Date(Date.now() + 24 * 3600000);
dep.setHours(10, 0, 0, 0);

const orgs = [];
const browser = await chromium.launch({ headless: true });
const shot = async (page, name, fullPage = true) => {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage });
  console.log("    screenshot: " + path.relative(ROOT, file).replace(/\\/g, "/"));
};
async function newPage(user, { width, height, base = BASE, mobile = false }) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("    [pageerror]", String(e).slice(0, 300)));
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
async function fillAndSearch(page, { origin, destination, passengers = 1 }) {
  const ret = new Date(dep.getTime() + 8 * 3600000);
  await setTripDates(page, dep, ret); // date + time are separate inputs now ("Reservar igual")
  await page.fill('input[name="origin"]', origin);
  await page.fill('input[name="destination"]', destination);
  await page.fill('input[name="distanceKm"]', "20");
  await page.fill('input[name="passengerCount"]', String(passengers));
  await page.selectOption("#rv-motivo", "training"); // "Motivo da viagem" is a select now
  await page.click('form button[type="submit"]:has-text("Buscar recomendação")');
}
const outcome = (page) =>
  page.waitForSelector('[data-testid="carpool-offer-card"], [data-testid="host-offer-step"], [data-testid="vehicle-card-recommended"], [data-testid="carpool-needs-precision"], [data-testid="carpool-unavailable"], .rv-error', { timeout: 120000 });
// The embedded route map card (Google Static Maps, added after this script was written) is intentional and
// is excluded from the "no invented elements" checks; it has its own coverage in mapa-ui.mjs.
const bodyText = (page) => page.evaluate(() => { const els = [...document.querySelectorAll('[data-testid="route-map"], [data-testid="route-map-unavailable"], [data-testid="rv-map-empty"], [data-testid="fm-assistant-panel"]')]; const prev = els.map((e) => e.style.display); els.forEach((e) => (e.style.display = "none")); const t = document.body.innerText; els.forEach((e, k) => (e.style.display = prev[k])); return t; });
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".fm-theme a, .fm-theme button, .fm-theme input, .fm-theme textarea")]
      .filter((e) => {
        if (e.closest(".fm-sr-only") || e.type === "hidden") return false;
        const r = e.getBoundingClientRect();
        if (r.width === 0) return false;
        // radio/checkbox: the whole label is the target
        const box = e.type === "radio" || e.type === "checkbox" ? (e.closest("label") ?? e).getBoundingClientRect() : r;
        return box.height < 44 || box.width < 44;
      })
      .map((e) => (e.getAttribute("name") || e.textContent || e.tagName).trim().slice(0, 30) + ":" + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)),
  );
const stepState = (page) => page.evaluate(() => [...document.querySelectorAll(".rv-step")].map((li) => li.querySelector(".rv-step-label").firstChild.textContent.trim() + ":" + li.dataset.state));
const lum = (rgb) => { const [r, g, b] = rgb.match(/[0-9]+(?:[.][0-9]+)?/g).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// "Reservar igual": vehicle cards now show REAL energy levels ("Bateria 90%"), so a bare % is no longer a sign of invented data (Match %, stars, promo... remain forbidden).
const INVENTED = /match \d|★|\bmapa\b|promo|uso recente|por período|por destino|uso recorrente|minha localização|filtros|km \(elétrico\)/i;

try {
  const A = await provisionOrg("rv", [["host", "employee"], ["rider", "employee"], ["rider2", "employee"], ["rider3", "employee"], ["mgr", "fleet_manager"], ["adm", "administrator"]]);
  orgs.push(A);
  await sql(`update organization_settings set booking_mode='hybrid' where organization_id='${A.orgId}'`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
    values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);
  const U = A.users;
  console.log(`\n=== Reservar Veiculo walkthrough (${BASE}) org=${A.orgId} ===\n`);

  // ---- static scoping check of the new stylesheet: every rule is under .fm-theme
  const css = readFileSync(path.join(ROOT, "apps/web/app/trips/new/reservar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...css.matchAll(/(?:^|})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
  const unscoped = selectors.filter((s) => s.split(",").some((p) => !p.trim().startsWith(".fm-theme")));
  record("reservar.css: every selector is scoped under .fm-theme", unscoped.length === 0, unscoped.slice(0, 5));

  // ---- unauthenticated
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(BASE + "/trips/new", { waitUntil: "domcontentloaded", timeout: 90000 });
  record("Unauthenticated visitor is redirected to /login", new URL(anon.url()).pathname.startsWith("/login"), anon.url());

  // ---- DESKTOP 1440x900, NO carpool on the route
  const d = await newPage(U.rider, { width: 1440, height: 900 });
  await openForm(d);
  record("Desktop: new look scoped (fm-theme wrapper present on /trips/new)", (await d.locator('[data-testid="fm-theme"]').count()) === 1);
  record("Desktop: sidebar visible, bottom nav hidden", (await d.locator(".fm-sidebar").isVisible()) && !(await d.locator(".fm-bottom-nav").isVisible()));
  record("Desktop: nav marks 'Reservar Veículo' as the current page", /Reservar Veículo/.test(await d.locator('.fm-sidebar a[aria-current="page"]').innerText()));
  record("Desktop: h1 is Reservar Veículo", (await d.locator("h1").innerText()).trim() === "Reservar Veículo");
  const sideHrefs = await d.locator(".fm-sidebar a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  record("Employee sidebar: CTA + Inicio (/dashboard, Lote 1A), Buscar Carona, Reservar, Minhas Viagens; no manager-only items", ["/trips/new", "/carpool", "/trips", "/dashboard"].every((h) => sideHrefs.includes(h)) && !sideHrefs.some((h) => ["/gate", "/analytics", "/fleet", "/settings", "/settings/users"].includes(h)), sideHrefs);
  record("Desktop topbar: theme toggle, language toggle, bell, user menu, sign-out", (await d.locator('.fm-topbar button[aria-label="Tema"]').count()) === 1 && (await d.locator('.fm-topbar button[aria-label="Idioma"]').count()) === 1 && (await d.locator('.fm-topbar button[aria-label="Menu da conta"]').count()) === 1 && (await d.locator('.fm-topbar form button[aria-label]').count()) === 1 && (await d.locator('.fm-topbar button[aria-haspopup]').count()) >= 3);
  const fab = d.locator('button[aria-label="Assistente Fleet"]');
  record("Chat assistant button present on /trips/new", (await fab.count()) === 1);
  await fab.click();
  await d.waitForSelector('[role="dialog"], textarea, input[placeholder]', { timeout: 15000 }).catch(() => {});
  record("Chat assistant opens on /trips/new", (await d.locator('[role="dialog"]').count()) >= 1, await d.locator('[role="dialog"]').count());
  await fab.click();
  const strongBorder = await d.evaluate(() => getComputedStyle(document.querySelector('input[name="origin"]')).borderTopColor);
  record("Input edge contrast on white >= 3:1", 1.05 / (lum(strongBorder) + 0.05) >= 3, strongBorder);
  record("Desktop: step header shows the 4 art steps (Viagem, Veículo, Carona, Confirmação), 'Viagem' current", JSON.stringify(await stepState(d)) === JSON.stringify(["Viagem:current", "Veículo:todo", "Carona:todo", "Confirmação:todo"]), await stepState(d));
  record("Desktop: no horizontal scroll", (await hscroll(d)) <= 0);
  const ph = await d.evaluate(() => getComputedStyle(document.querySelector('input[name="destination"]'), "::placeholder").color);
  record("Placeholder contrast on white >= 4.5:1", 1.05 / (lum(ph) + 0.05) >= 4.5, ph);
  const allEmpty = await bodyText(d);
  record("Empty state: shows hint, no carpool block, no invented elements", (await d.locator('[data-testid="carpool-first"]').count()) === 0 && !INVENTED.test(allEmpty) && (await d.locator(".fm-theme main img:not([data-testid=\"route-map-img\"])").count()) === 0, allEmpty.match(INVENTED)?.[0]);
  // keyboard focus is visible
  await d.focus('input[name="origin"]');
  await d.keyboard.press("Tab");
  const focusOutline = await d.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + " " + s.outlineWidth; });
  record("Keyboard focus is visible (outline on focused field)", /solid 3px/.test(focusOutline), focusOutline);
  await shot(d, "01-desktop-empty");

  await fillAndSearch(d, { origin: RIDER_ORIGIN, destination: RIDER_DEST });
  await d.waitForSelector('[data-testid="host-offer-step"]', { timeout: 120000 });
  const noCarpoolTxt = await bodyText(d);
  record("No-carpool state: carpool block does NOT appear at all (no banner either)", (await d.locator('[data-testid="carpool-first"]').count()) === 0 && (await d.locator("#rv-carpool-title").count()) === 0 && !/Não encontramos caronas/i.test(noCarpoolTxt));
  record("No-carpool state: recommended vehicle + host offer step (Yes/No) shown", (await d.locator(".rv-plate").count()) >= 1 && /Veículo recomendado/.test(noCarpoolTxt) && /Recomendado/.test(await d.locator('[data-testid="vehicle-card-recommended"]').innerText()) && (await d.locator('input[name="offerChoice"][value="yes"]').count()) === 1 && (await d.locator('input[name="offerChoice"][value="no"]').isChecked()));
  record("No-carpool state: step header = Viagem done, Veículo current", JSON.stringify(await stepState(d)) === JSON.stringify(["Viagem:done", "Veículo:current", "Carona:todo", "Confirmação:todo"]), await stepState(d));
  record("Other eligible vehicle listed as a card with a Selecionar button", (await d.locator('[data-testid="vehicle-card"]').count()) === 1 && (await d.locator('[data-testid="vehicle-card"] button:has-text("Selecionar")').count()) === 1);
  record("Requests-reservation button present", (await d.locator('button:has-text("Solicitar reserva")').count()) === 1);
  record("No invented elements on result (map/photo/rating/match %/image)", !INVENTED.test(noCarpoolTxt) && (await d.locator(".fm-theme main img:not([data-testid=\"route-map-img\"])").count()) === 0, noCarpoolTxt.match(INVENTED)?.[0]);
  await d.check('input[name="offerChoice"][value="yes"]');
  await d.waitForSelector('input[name="offerSeats"]');
  const s0 = await d.inputValue('input[name="offerSeats"]');
  await d.click('button[aria-label="Diminuir vagas"]');
  await d.click('button[aria-label="Aumentar vagas"]');
  record("Seats input has an accessible name and the label click does not change the value", (await d.getByRole("spinbutton", { name: /Vagas a oferecer/ }).count()) === 1 && (await (async () => { const before = await d.inputValue('input[name="offerSeats"]'); await d.click("#rv-offer-seats-label"); return (await d.inputValue('input[name="offerSeats"]')) === before; })()));
  record("Host offer: seats stepper works and stays within 1..max", (await d.inputValue('input[name="offerSeats"]')) === s0, s0);
  await shot(d, "02-desktop-no-carpool-vehicle-host-offer");

  // ---- MOBILE 390x844, NO carpool on the route
  const m = await newPage(U.rider2, { width: 390, height: 844, mobile: true });
  await openForm(m);
  record("Mobile: bottom nav visible, sidebar hidden", (await m.locator(".fm-bottom-nav").isVisible()) && !(await m.locator(".fm-sidebar").isVisible()));
  record("Mobile: hamburger menu + chat button present", (await m.locator('button[aria-label="Abrir menu"]').count()) === 1 && (await m.locator('button[aria-label="Assistente Fleet"]').count()) === 1);
  await m.click('button[aria-label="Abrir menu"]');
  const mHrefs = await m.locator(".fm-mobilenav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  record("Mobile hamburger lists the nav + CTA for the employee", ["/trips/new", "/carpool", "/trips"].every((h) => mHrefs.includes(h)), mHrefs);
  record("Mobile: touch targets >= 44px with the menu open", (await smallTargets(m)).length === 0, await smallTargets(m));
  await shot(m, "mobile-00-menu-open", false);
  await m.click('button[aria-label="Fechar menu"]');
  const fabBox = await m.locator('button[aria-label="Assistente Fleet"]').boundingBox();
  const navBox = await m.locator(".fm-bottom-nav").boundingBox();
  record("Mobile: chat button sits above the bottom bar (no overlap)", fabBox.y + fabBox.height <= navBox.y, { fabBottom: fabBox.y + fabBox.height, navTop: navBox.y });
  record("Mobile: no horizontal scroll (form)", (await hscroll(m)) <= 0, await hscroll(m));
  record("Mobile: touch targets >= 44px (form)", (await smallTargets(m)).length === 0, await smallTargets(m));
  await shot(m, "mobile-01-form", false);
  await fillAndSearch(m, { origin: RIDER_ORIGIN, destination: RIDER_DEST });
  await m.waitForSelector('[data-testid="host-offer-step"]', { timeout: 120000 });
  await m.waitForTimeout(400);
  await m.check('input[name="offerChoice"][value="yes"]');
  await m.waitForSelector('input[name="offerSeats"]');
  record("Mobile: no horizontal scroll (vehicle + host step)", (await hscroll(m)) <= 0, await hscroll(m));
  record("Mobile: touch targets >= 44px (vehicle + host step)", (await smallTargets(m)).length === 0, await smallTargets(m));
  await m.locator('[data-testid="host-offer-step"]').scrollIntoViewIfNeeded();
  await shot(m, "mobile-02-no-carpool-host-offer", false);

  // ---- end to end vehicle reservation (host publishes an offer with 2 seats through the real flow)
  const h = await newPage(U.host, { width: 1280, height: 900 });
  await openForm(h);
  await fillAndSearch(h, { origin: HOST_ORIGIN, destination: HOST_DEST });
  await h.waitForSelector('[data-testid="host-offer-step"]', { timeout: 120000 });
  await h.waitForTimeout(500);
  await h.check('input[name="offerChoice"][value="yes"]');
  await h.fill('input[name="offerSeats"]', "2");
  await h.click('button:has-text("Solicitar reserva")');
  await h.waitForURL((u) => u.pathname === "/trips", { timeout: 90000 });
  const hostRows = await sql(`select tr.id, (select count(*) from reservations r where r.trip_request_id=tr.id) res, o.status offer_status, o.seats_available from trip_requests tr left join carpool_offers o on o.trip_request_id=tr.id where tr.requester_id='${U.host.id}'`);
  record("End to end: vehicle reservation created from the new screen (redirect to /trips, row + offer with 2 seats)", hostRows.length === 1 && Number(hostRows[0].res) >= 1 && hostRows[0].offer_status === "active" && hostRows[0].seats_available === 2, hostRows);

  // ---- COMPATIBLE carpool on the route (desktop)
  await openForm(d);
  await fillAndSearch(d, { origin: RIDER_ORIGIN, destination: RIDER_DEST });
  try { await d.waitForSelector('[data-testid="carpool-offer-card"]', { timeout: 120000 }); } catch (e) { console.log("DEBUG-SEARCHLOG:", JSON.stringify(await sql(`select source, offers_evaluated, prefilter_candidates, precise_route_calls, compatible_count, outcome, latency_ms from carpool_search_log where organization_id='${A.orgId}' order by created_at`))); console.log("DEBUG-OFFER:", JSON.stringify(await sql(`select o.status offer_status, o.seats_available, tr.departure_at, tr.origin, tr.destination, tr.allow_carpool, (select string_agg(r.status::text, ',') from reservations r where r.trip_request_id=tr.id) res_status, now() db_now from carpool_offers o join trip_requests tr on tr.id=o.trip_request_id where o.organization_id='${A.orgId}'`)), "RIDER_DEP", String(typeof dep!=="undefined"?dep:"n/a")); console.log("DEBUG-BODY:", (await d.locator("body").innerText()).split(String.fromCharCode(10)).join(" | ").slice(0, 1800)); throw e; }
  await d.waitForTimeout(800);
  const cardTxt = await d.locator('[data-testid="carpool-offer-card"]').first().innerText();
  record("Compatible state: 1 offer card with departure, detour, seats, Solicitar carona", (await d.locator('[data-testid="carpool-offer-card"]').count()) === 1 && /\d{2}:\d{2}/.test(cardTxt) && /\+[\d.]+ km/.test(cardTxt) && /vagas?/.test(cardTxt) && /Solicitar carona/.test(cardTxt), cardTxt.replace(/\n/g, " | "));
  record("Compatible state: vehicle list is shown TOGETHER with the carpool block (no 'continue' gating any more)", (await d.locator(".rv-plate").count()) >= 1 && (await d.locator('[data-testid="host-offer-step"]').count()) === 1 && (await d.locator('button:has-text("Continuar com veículo")').count()) === 0);
  record("Compatible state: step header has 4 steps, Carona current (Veículo is the next step)", JSON.stringify(await stepState(d)) === JSON.stringify(["Viagem:done", "Veículo:todo", "Carona:current", "Confirmação:todo"]), await stepState(d));
  const all = await bodyText(d);
  record("Compatible state: privacy (no host name) and no invented elements", !all.includes(U.host.fullName) && !INVENTED.test(all) && (await d.locator(".fm-theme main img:not([data-testid=\"route-map-img\"])").count()) === 0, all.match(INVENTED)?.[0]);
  record("Compatible state: places confirmation shown", /origem/i.test(await d.locator('[data-testid="carpool-places"]').innerText()));
  await shot(d, "03-desktop-carpool-compatible");

  await d.waitForSelector(".rv-plate", { timeout: 30000 });
  const yCarpool = (await d.locator('[data-testid="carpool-first"]').boundingBox()).y;
  const yVehicle = (await d.locator(".rv-plate").first().boundingBox()).y;
  record("Carpool block is rendered BEFORE the vehicle list (higher on the page)", yCarpool < yVehicle, { yCarpool, yVehicle });
  record("Step header = Viagem done, Carona current (Veículo is the next step)", JSON.stringify(await stepState(d)) === JSON.stringify(["Viagem:done", "Veículo:todo", "Carona:current", "Confirmação:todo"]), await stepState(d));
  await shot(d, "04-desktop-carpool-then-vehicle");

  await d.click('[data-testid="carpool-offer-card"] button:has-text("Solicitar carona")');
  await d.waitForSelector('[data-testid="carpool-offer-card"] a[href="/trips"]', { timeout: 90000 });
  const reqs = await sql(`select id, status from carpool_ride_requests where rider_id='${U.rider.id}'`);
  record("Carpool request works: one PENDING request + success state with link to /trips", reqs.length === 1 && reqs[0].status === "PENDING", reqs);
  await shot(d, "05-desktop-carpool-request-sent");

  // ---- MOBILE compatible state
  await openForm(m);
  await fillAndSearch(m, { origin: RIDER_ORIGIN, destination: RIDER_DEST });
  await m.waitForSelector('[data-testid="carpool-offer-card"]', { timeout: 120000 });
  await m.waitForTimeout(800);
  record("Mobile: compatible card shown, no horizontal scroll", (await m.locator('[data-testid="carpool-offer-card"]').count()) === 1 && (await hscroll(m)) <= 0, await hscroll(m));
  record("Mobile: touch targets >= 44px (carpool state)", (await smallTargets(m)).length === 0, await smallTargets(m));
  await m.locator('[data-testid="carpool-first"]').scrollIntoViewIfNeeded();
  await shot(m, "mobile-03-carpool-compatible", false);
  await m.evaluate(() => window.scrollTo(0, 0));
  await shot(m, "mobile-04-carpool-compatible-top", false);

  // ---- needs precision (city-only destination)
  await openForm(d);
  await fillAndSearch(d, { origin: RIDER_ORIGIN, destination: "São Paulo" });
  await d.waitForSelector('[data-testid="carpool-needs-precision"], [data-testid="carpool-unavailable"]', { timeout: 120000 });
  const np = await bodyText(d);
  record("Needs-precision state: asks for a precise place and the vehicle list is already visible", /apenas uma cidade/.test(np) && (await d.locator(".rv-plate").count()) >= 1);
  await shot(d, "06-desktop-needs-precision");
  record("Needs-precision: there is no 'continue without carpool' button any more", (await d.locator('button:has-text("Continuar sem buscar carona")').count()) === 0);

  // ---- no vehicle available / validation: plan error path is exercised by a far destination with 99 passengers
  await openForm(d);
  await fillAndSearch(d, { origin: RIDER_ORIGIN, destination: FAR_DEST, passengers: 99 });
  await d.waitForSelector(".rv-error, .fm-banner-danger, .rv-plate", { timeout: 120000 });
  record("Capacity too high: friendly 'no options' state with reasons (no crash)", (await d.locator(".rv-error").count()) === 1 || (await d.locator(".fm-banner-danger").count()) === 1, (await d.locator(".rv-error, .fm-banner-danger").first().innerText()).slice(0, 80));
  await shot(d, "07-desktop-no-options");

  // ---- OUTAGE (bad Google key server)
  try {
    const o = await newPage(U.rider3, { width: 1440, height: 900, base: BASE2 });
    await openForm(o, BASE2);
    await fillAndSearch(o, { origin: RIDER_ORIGIN, destination: RIDER_DEST });
    await o.waitForSelector('[data-testid="carpool-unavailable"]', { timeout: 120000 });
    await o.waitForSelector(".rv-plate", { timeout: 60000 });
    const ob = await bodyText(o);
    record("Provider outage: banner with the existing unavailable text and the vehicle flow untouched", /serviço de mapas do Google está indisponível/.test(ob) && (await o.locator('[data-testid="carpool-offer-card"]').count()) === 0 && (await o.locator('button:has-text("Solicitar reserva")').count()) === 1);
    await shot(o, "08-desktop-outage");
  } catch (e) {
    record("Outage state (second server)", false, String(e).slice(0, 300));
  }

  // ---- manager and administrator keep their nav items
  const mg = await newPage(U.mgr, { width: 1440, height: 900 });
  await mg.goto(BASE + "/trips/new", { waitUntil: "domcontentloaded", timeout: 90000 });
  const mgH = await mg.locator(".fm-sidebar a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  record("Fleet manager sidebar: Painel, Gate, Analytics, Frota, Settings + CTA", ["/dashboard", "/gate", "/analytics", "/fleet", "/settings", "/trips/new", "/carpool", "/trips"].every((h) => mgH.includes(h)) && !mgH.includes("/settings/users"), mgH);
  const ad = await newPage(U.adm, { width: 1440, height: 900 });
  await ad.goto(BASE + "/carpool", { waitUntil: "domcontentloaded", timeout: 90000 });
  const adH = await ad.locator(".fm-sidebar a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  record("Administrator sidebar on /carpool: Team (/settings/users) + manager items", ["/settings/users", "/dashboard", "/settings"].every((h) => adH.includes(h)), adH);
  record("/carpool keeps the chat assistant", (await ad.locator('button[aria-label="Assistente Fleet"]').count()) === 1);
  // ---- scoping: another route keeps the old look
  await d.goto(BASE + "/account", { waitUntil: "domcontentloaded" });
  record("Other screens are unaffected (/account has no fm-theme wrapper; /trips joined the theme in Lote 1A)", (await d.locator('[data-testid="fm-theme"]').count()) === 0);
  await mg.goto(BASE + "/settings", { waitUntil: "domcontentloaded" });
  record("Other screens: /settings (manager session) is now the Lote 1B FleetMind screen (has the fm-theme wrapper)", (await mg.locator('[data-testid="fm-theme"]').count()) === 1);
  const carpoolPage = await newPage(U.rider3, { width: 1440, height: 900 });
  await carpoolPage.goto(BASE + "/carpool", { waitUntil: "domcontentloaded" });
  record("/carpool still renders in the same shell (nav marks Buscar Carona)", /Buscar Carona/.test(await carpoolPage.locator('.fm-sidebar a[aria-current="page"]').innerText()));
} catch (e) {
  record("FATAL (unexpected exception)", false, String(e && e.stack ? e.stack : e));
} finally {
  await browser.close().catch(() => {});
  if (process.env.KEEP !== "1") await cleanupOrgs(orgs);
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== Summary ===");
  for (const r of failed) console.log("FAIL - " + r.name);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  process.exitCode = failed.length ? 1 : 0;
}
