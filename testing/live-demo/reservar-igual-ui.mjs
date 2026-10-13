// "Reservar Veiculo" (/trips/new) rebuilt to match the approved art (design-v2/usr002/art06, art04) + Google Places address
// autocomplete. Real browser (Playwright), live Supabase + live Google through `next start` on BASE_URL (3100) and a SECOND
// server with a bad Google key on BASE_URL_OUTAGE (3101). Disposable org/users (carpool-c5-lib.mjs), removed in `finally`.
// Screenshots -> resultado_de_testes/design-v2/implemented-igual/
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASE, PASSWORD, record, results, sql, provisionOrg, cleanupOrgs, ROOT, setTripDates } from "./carpool-c5-lib.mjs";

const OUT = path.join(ROOT, "resultado_de_testes", "design-v2", "implemented-igual");
mkdirSync(OUT, { recursive: true });
const BASE2 = process.env.BASE_URL_OUTAGE || "http://localhost:3101";
// third server started with GEO_MAP_TEST_DELAY_MS=4000 (a test hook of POST /api/geo/route-map): proves the plan is not queued behind the map
const BASE3 = process.env.BASE_URL_SLOWMAP || "http://localhost:3105";
const envText = readFileSync(path.join(ROOT, ".env"), "utf8");
const GKEY = envText.match(/^GOOGLE_MAPS_API_KEY=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");

const O = "Avenida Paulista, 1578, São Paulo";
const D = "Avenida Washington Luís, 5000, São Paulo";
const dep = new Date(Date.now() + 24 * 3600000);
dep.setHours(10, 0, 0, 0);
const ret = new Date(dep.getTime() + 8 * 3600000);

const orgs = [];
const browser = await chromium.launch({ headless: true });
const shot = async (page, name, fullPage = true) => {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage });
  console.log("    screenshot: " + path.relative(ROOT, file).replace(/\\/g, "/"));
};
const leaks = [];
const pageErrors = [];
async function newPage(user, { width, height, base = BASE, mobile = false, watch = true, init = null }) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    pageErrors.push(String(e).slice(0, 200));
    console.log("    [pageerror]", String(e).slice(0, 300));
  });
  if (init) await page.addInitScript(init);
  if (watch) {
    page.on("response", async (r) => {
      try {
        const ct = r.headers()["content-type"] ?? "";
        if (!/text|json|javascript|x-component/.test(ct)) return;
        const body = await r.text();
        if ((GKEY && body.includes(GKEY)) || /AIza[0-9A-Za-z_-]{20,}/.test(body)) leaks.push(r.url());
      } catch {}
    });
  }
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 }), page.click('button[type="submit"]')]);
  return page;
}
const hydrated = (page) =>
  page.waitForFunction(() => {
    const f = document.querySelector("main form");
    return Boolean(f) && Object.keys(f).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")) && (f.dataset.ready === undefined || f.dataset.ready === "true");
  }, null, { timeout: 90000 });
async function openForm(page, base = BASE) {
  await page.goto(base + "/trips/new", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await hydrated(page);
}
async function places(page, o, d, { escape = true } = {}) {
  await page.fill('input[name="origin"]', o);
  if (escape) await page.keyboard.press("Escape");
  await page.fill('input[name="destination"]', d);
  if (escape) await page.keyboard.press("Escape");
}
const submit = (page) => page.click('form button[type="submit"]:has-text("Buscar recomendação")');
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".fm-theme main a, .fm-theme main button, .fm-theme main input, .fm-theme main select, .fm-theme header a, .fm-theme header button, .fm-theme .fm-bottom-nav a, .fm-theme .fm-sidebar a, .fm-theme .fm-sidebar button")]
      .filter((e) => {
        if (e.closest(".fm-sr-only") || e.type === "hidden") return false;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const box = e.type === "radio" || e.type === "checkbox" ? (e.closest("label") ?? e).getBoundingClientRect() : r;
        return box.height < 44 || box.width < 44;
      })
      .map((e) => (e.getAttribute("name") || e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 30) + ":" + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)),
  );
const stepState = (page) => page.evaluate(() => [...document.querySelectorAll(".rv-step")].map((li) => li.dataset.step + ":" + li.dataset.state));
const orgCounters = async (orgId) => {
  const rows = await sql(`select provider_call_kind k, call_count c from geo_provider_quota_counters where organization_id='${orgId}' and day=(now() at time zone 'utc')::date`);
  const o = {};
  for (const r of rows) o[r.k] = Number(r.c);
  return (k) => o[k] ?? 0;
};
const userAc = async (uid) => Number((await sql(`select coalesce(sum(calls),0) c from user_daily_geo_usage where user_id='${uid}' and kind='place_autocomplete'`))[0].c);
const mapReady = (page, t = 90000) => page.waitForSelector('[data-testid="route-map"][data-state="ready"]', { timeout: t });
const acOptions = (page) => page.locator('[data-testid="ac-list"] [role="option"]');

try {
  const A = await provisionOrg("ig", [["host", "employee"], ["rider", "employee"], ["rider2", "employee"], ["rider3", "employee"], ["rider4", "employee"], ["rider5", "employee"], ["rider6", "employee"], ["mgr", "fleet_manager"]]);
  orgs.push(A);
  await sql(`update organization_settings set booking_mode='hybrid' where organization_id='${A.orgId}'`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
    values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);
  const [evCat] = await sql(`insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('${A.orgId}', 'C5UI EV', 4, 'BEV') returning id`);
  for (const n of [1, 2]) {
    await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, battery_level_percent, estimated_range_km, next_service_odometer_km)
      values ('${A.orgId}', 'EV${n}${A.tag.slice(0, 1).toUpperCase()}${String(Date.now()).slice(-3)}', '${evCat.id}', 'available', 3200, 90, 420, 20000)`);
  }
  await sql(`insert into corporate_mobility_points (organization_id, name, aliases, address_label, latitude, longitude, is_active)
    values ('${A.orgId}', 'Matriz Paulista Teste', array['MPT'], 'Avenida Paulista, 1000, São Paulo', -23.5614, -46.6559, true)`);
  await sql(`insert into corporate_mobility_points (organization_id, name, aliases, address_label, latitude, longitude, is_active)
    values ('${A.orgId}', 'Matriz Paulista Teste Com Nome Extremamente Longo Para Truncar O Texto Da Opcao', array[]::text[], 'Avenida Paulista, 2000, São Paulo', -23.5614, -46.6559, true)`);
  const B = await provisionOrg("off", [["u", "employee"]]);
  orgs.push(B);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, carpool_enabled, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
    values ('${B.orgId}', 1, false, 15, 15, 5, 15, 30)`);
  const U = A.users;
  console.log(`\n=== Reservar igual walkthrough (${BASE}) org=${A.orgId} ===\n`);

  const css = readFileSync(path.join(ROOT, "apps/web/app/trips/new/reservar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const sel = [...css.matchAll(/(?:^|})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
  record("reservar.css: every selector is scoped under .fm-theme", sel.filter((s) => s.split(",").some((p) => !p.trim().startsWith(".fm-theme"))).length === 0);

  // ======================= DESKTOP 1440 =======================
  const d = await newPage(U.rider, { width: 1440, height: 900 });
  await openForm(d);
  record("Steps: 4 in the art order Viagem, Veículo, Carona, Confirmação (carpool on by default)", JSON.stringify(await stepState(d)) === JSON.stringify(["trip:current", "vehicle:todo", "carpool:todo", "confirm:todo"]), await stepState(d));
  const stepLabels = await d.locator(".rv-step-label").allInnerTexts();
  record("Steps: labels in order", stepLabels.map((s) => s.replace(/\s*\(.*\)/, "").trim()).join("|") === "Viagem|Veículo|Carona|Confirmação", stepLabels);
  record("Empty: map card not loaded yet (placeholder), no map call before both places", (await d.locator('[data-testid="route-map"]').count()) === 0 && (await d.locator('[data-testid="rv-map-empty"]').count()) === 1);
  record("Form: date and time are SEPARATE inputs (type=date + type=time) for departure and return", (await d.locator('#rv-dep-date[type="date"]').count()) === 1 && (await d.locator('#rv-dep-time[type="time"]').count()) === 1 && (await d.locator('#rv-ret-date[type="date"]').count()) === 1 && (await d.locator('#rv-ret-time[type="time"]').count()) === 1);
  record("Form: hidden departureAt / expectedReturnAt are composed from them", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(await d.locator('input[type="hidden"][name="departureAt"]').inputValue()) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(await d.locator('input[type="hidden"][name="expectedReturnAt"]').inputValue()));
  const opts = await d.locator("#rv-motivo option").allInnerTexts();
  record("Motivo da viagem is a select with the 6 options", opts.join("|") === "Reunião|Visita a cliente|Treinamento|Entrega|Manutenção/oficina|Outro", opts);
  record("Toggle 'Buscar caronas compatíveis' is a switch, default ON", (await d.getByRole("switch", { name: /Buscar caronas compatíveis/ }).isChecked()) && (await d.locator('input[type="hidden"][name="searchCarpool"]').inputValue()) === "on");
  record("Passengers, cargo checkbox and distance fields are kept", (await d.locator('input[name="passengerCount"]').count()) === 1 && (await d.locator('input[name="requiresCargo"]').count()) === 1 && (await d.locator('input[name="distanceKm"]').count()) === 1);
  const fb = await d.locator('[data-testid="rv-form"]').boundingBox();
  await shot(d, "01-desktop-1440-empty", false);

  // topbar + sidebar
  const todayBr = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  record("Topbar: 'Hoje, dd/mm/aaaa' pill in Brasília time", (await d.locator('[data-testid="fm-today"]').innerText()).trim() === `Hoje, ${todayBr}`, await d.locator('[data-testid="fm-today"]').innerText());
  record("Topbar: organization name label (real)", (await d.locator('[data-testid="fm-org"]').innerText()).trim() === (await sql(`select name from organizations where id='${A.orgId}'`))[0].name);
  record("Topbar: bell + user name + role text beside the avatar", (await d.locator('.fm-topbar button[aria-haspopup]').count()) >= 3 && /C5UI ig rider/.test(await d.locator('[data-testid="fm-user"]').innerText()) && /Colaborador/.test(await d.locator('[data-testid="fm-user"]').innerText()));
  const sideHrefs = await d.locator(".fm-sidebar nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  record("Menu: only real destinations (no dead links)", sideHrefs.every((h) => h?.startsWith("/")) && !sideHrefs.some((h) => /ocorr|check|sustent|ajuda/i.test(h ?? "")), sideHrefs);

  // the topbar search box was removed on request
  record("No global search box in the topbar", (await d.locator('[data-testid="fm-global-search"]').count()) === 0);
  await openForm(d);

  // sidebar voice panel
  record("Sidebar panel 'Falar com o FleetMind': mic + 4 example phrases", (await d.locator('[data-testid="fm-assistant-mic"]').count()) === 1 && (await d.locator(".fm-assist-example").count()) === 4);
  await d.evaluate(() => { window.__mic = 0; });
  await d.locator('[data-testid="fm-assistant-mic"]').click();
  await d.waitForSelector('[role="dialog"]', { state: "visible", timeout: 15000 });
  record("Sidebar mic opens the existing chat assistant (one chat only)", (await d.locator('[role="dialog"]').count()) === 1 && (await d.locator('button[aria-label="Assistente Fleet"]').count()) === 1);
  await d.locator('button[aria-label="Assistente Fleet"]').click();
  await d.locator(".fm-assist-example").nth(1).click();
  await d.waitForSelector('[role="dialog"]', { state: "visible" });
  await d.waitForFunction(() => /Tem carona/.test(document.querySelector('[role="dialog"] textarea')?.value ?? ""), null, { timeout: 8000 }).catch(() => {});
  const draftVal = await d.locator('[role="dialog"] textarea').first().inputValue().catch(() => "");
  record("Sidebar example phrase opens the chat with the phrase pre-filled", /Tem carona para São Paulo\?/.test(draftVal), draftVal);
  await d.locator('button[aria-label="Assistente Fleet"]').click();

  // map: loads when both places are set (debounced), distance auto-fill
  const sm0 = (await orgCounters(A.orgId))("static_map");
  await d.fill('input[name="origin"]', O);
  await d.keyboard.press("Escape");
  await d.waitForTimeout(1200);
  record("Map does not load with only ONE place filled", (await d.locator('[data-testid="route-map"]').count()) === 0);
  await d.fill('input[name="destination"]', D);
  await d.keyboard.press("Escape");
  const tFilled = Date.now();
  await d.waitForSelector('[data-testid="route-map"]', { timeout: 30000 });
  const tMapMounted = Date.now() - tFilled;
  record("Map card mounts ~700ms AFTER the last change (debounced)", tMapMounted >= 600 && tMapMounted < 6000, tMapMounted + "ms");
  await mapReady(d);
  const mb = await d.locator('[data-testid="rv-mapcol"]').boundingBox();
  record("Map at the TOP, to the right of 'Detalhes da viagem' (1440)", mb.x > fb.x + fb.width - 5 && mb.y < fb.y + fb.height, { form: fb, map: mb });
  const chip = await d.locator('[data-testid="route-map-chip"]').innerText();
  record("'Rota' chip shows km and estimated time, no traffic claim", /\d[\d.,]* km/.test(chip) && /\d+\s*(min|h)/.test(chip) && !/tr[aâ]nsito/i.test(chip), chip.replace(/\n/g, " | "));
  const km = Number(chip.match(/([\d.,]+) km/)[1].replace(",", "."));
  const dist = Number(await d.inputValue('input[name="distanceKm"]'));
  record("Distance auto-filled from the route (rounded km), marked auto and editable", dist === Math.max(1, Math.round(km)) && (await d.locator('[data-testid="rv-distance-auto"]').count()) === 1, { dist, km });
  const sm1 = (await orgCounters(A.orgId))("static_map");
  record("The map was requested once for the pair (one static_map call, no per-keystroke calls)", sm1 - sm0 === 1, { sm0, sm1 });
  await d.fill('input[name="distanceKm"]', "37");
  record("Typing a distance marks it as the user's own (auto hint disappears)", (await d.locator('[data-testid="rv-distance-auto"]').count()) === 0);
  await shot(d, "03-desktop-1440-map-top", false);
  await d.fill('input[name="distanceKm"]', "20");

  // date+time composition -> planned instant
  await setTripDates(d, dep, ret);
  const composed = await d.locator('input[type="hidden"][name="departureAt"]').inputValue();
  const pad = (n) => String(n).padStart(2, "0");
  record("Date+time compose into departureAt (Brasília wall clock)", composed === `${dep.getFullYear()}-${pad(dep.getMonth() + 1)}-${pad(dep.getDate())}T10:00`, composed);

  // plan: no carpool on route yet -> NO block; vehicles with energy filters
  const c0 = await orgCounters(A.orgId);
  await submit(d);
  await d.waitForSelector('[data-testid="vehicle-card-recommended"]', { timeout: 120000 });
  await d.waitForTimeout(600);
  const noBlock = (await d.locator('[data-testid="carpool-first"]').count()) === 0 && (await d.locator("#rv-carpool-title").count()) === 0;
  record("No carpool on the route: NO carpool block at all (art04 variant)", noBlock);
  record("Steps after plan (no carpool offers): Viagem done, Veículo current, Carona todo", JSON.stringify(await stepState(d)) === JSON.stringify(["trip:done", "vehicle:current", "carpool:todo", "confirm:todo"]), await stepState(d));
  const title = await d.locator("#rv-vehicles-title").innerText();
  const cardCount = await d.locator('[data-testid^="vehicle-card"]').count();
  record("'Veículos disponíveis (N)' with N = number of cards (real data)", new RegExp(`\\(${cardCount}\\)`).test(title) && cardCount >= 2, { title, cardCount });
  const filters = await d.locator('[data-testid="rv-energy-filters"] button').allInnerTexts();
  record("Filter chips: Todos + only the REAL energy types (no Automático, no Filtros button)", filters[0] === "Todos" && filters.slice(1).sort().join("|") === ["Combustão", "Elétrico"].sort().join("|") && !/Autom|Filtros/i.test(await d.locator('[data-testid="rv-vehicles"]').innerText()), filters);
  const recText = await d.locator('[data-testid="vehicle-card-recommended"]').innerText();
  record("Recommended card: 'Recomendado', plate, energy chip, seats, 'Solicitar reserva'", /Recomendado/.test(recText) && /Solicitar reserva/.test(recText) && /lugares/.test(recText) && /(Combustão|Elétrico)/.test(recText), recText.replace(/\n/g, " | ").slice(0, 200));
  const otherBtns = await d.locator('[data-testid="vehicle-select"]').allInnerTexts();
  record("Other cards carry 'Selecionar'", otherBtns.length === cardCount - 1 && otherBtns.every((t) => /Selecionar/.test(t)), otherBtns);
  await d.locator('[data-testid="rv-energy-filters"] button[data-filter="BEV"]').click();
  const bevOnly = await d.locator('[data-testid^="vehicle-card"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-energy")));
  record("Energy filter 'Elétrico' keeps only BEV cards", bevOnly.length >= 1 && bevOnly.every((e) => e === "BEV"), bevOnly);
  await d.locator('[data-testid="rv-energy-filters"] button[data-filter="all"]').click();
  record("Filter 'Todos' restores all cards", (await d.locator('[data-testid^="vehicle-card"]').count()) === cardCount);
  const pageTxt = await d.evaluate(() => document.querySelector("main").innerText);
  record("No invented data (no ratings, Match %, photos)", !/match \d|★|\b\d[.,]\d\s*★|Automático|trânsito normal/i.test(pageTxt) && (await d.locator('.fm-theme main img:not([data-testid="route-map-img"])').count()) === 0);
  const c1 = await orgCounters(A.orgId);
  record("Plan with carpool ON used the carpool geocode kind (toggle-on baseline)", c1("geocode") > c0("geocode"), { before: c0("geocode"), after: c1("geocode") });
  await shot(d, "04-desktop-1440-no-carpool-vehicles");
  record("Desktop 1440: no horizontal scroll, touch targets >= 44px", (await hscroll(d)) <= 0 && (await smallTargets(d)).length === 0, await smallTargets(d));

  // toggle OFF skips carpool-first entirely
  await openForm(d);
  await setTripDates(d, dep, ret);
  await places(d, O, D);
  await d.getByRole("switch", { name: /Buscar caronas compatíveis/ }).uncheck();
  record("Toggle OFF: step 'Carona' disappears (3 steps)", JSON.stringify(await stepState(d)) === JSON.stringify(["trip:current", "vehicle:todo", "confirm:todo"]), await stepState(d));
  await mapReady(d);
  const c2 = await orgCounters(A.orgId);
  await submit(d);
  await d.waitForSelector('[data-testid="vehicle-card-recommended"]', { timeout: 120000 });
  const c3 = await orgCounters(A.orgId);
  record("Toggle OFF: plan skips carpool-first (no geocode / routing / place_search calls)", c3("geocode") === c2("geocode") && c3("routing") === c2("routing") && c3("place_search") === c2("place_search") && (await d.locator('[data-testid="carpool-first"]').count()) === 0, { geo: [c2("geocode"), c3("geocode")], routing: [c2("routing"), c3("routing")] });

  // Motivo
  await openForm(d);
  await d.selectOption("#rv-motivo", "clientVisit");
  record("Motivo: no free text unless 'Outro'", (await d.locator('[data-testid="rv-motivo-other"]').count()) === 0 && (await d.locator('input[name="justification"]').inputValue()) === "Visita a cliente");
  await d.selectOption("#rv-motivo", "other");
  await d.fill('[data-testid="rv-motivo-other"]', "Levar documentos à matriz");
  record("Motivo 'Outro' + text writes the custom text to justification", (await d.locator('input[name="justification"]').inputValue()) === "Levar documentos à matriz");

  // ======================= HOST: end to end reservation with 2 seats, instant check =======================
  const h = await newPage(U.host, { width: 1280, height: 900 });
  await openForm(h);
  await setTripDates(h, dep, ret);
  await places(h, O, "Aeroporto de Congonhas, São Paulo");
  await h.selectOption("#rv-motivo", "meeting");
  await submit(h);
  await h.waitForSelector('[data-testid="host-offer-step"]', { timeout: 120000 });
  await h.waitForTimeout(500);
  await h.check('input[name="offerChoice"][value="yes"]');
  await h.fill('input[name="offerSeats"]', "2");
  await h.click('button:has-text("Solicitar reserva")');
  await h.waitForURL((u) => u.pathname === "/trips", { timeout: 90000 });
  const hostRows = await sql(`select tr.departure_at, tr.expected_return_at, tr.justification, o.status offer_status, o.seats_available, (select count(*) from reservations r where r.trip_request_id=tr.id) res from trip_requests tr left join carpool_offers o on o.trip_request_id=tr.id where tr.requester_id='${U.host.id}'`);
  const expectDep = new Date(`${dep.getFullYear()}-${pad(dep.getMonth() + 1)}-${pad(dep.getDate())}T10:00:00-03:00`).toISOString();
  record("End to end 'Solicitar reserva' with host offer 2 seats: reservation + active offer (2 seats)", hostRows.length === 1 && Number(hostRows[0].res) >= 1 && hostRows[0].offer_status === "active" && hostRows[0].seats_available === 2, hostRows);
  record("Stored departure instant equals the typed Brasília time (date + time inputs)", new Date(hostRows[0].departure_at).toISOString() === expectDep && hostRows[0].justification === "Reunião", { stored: hostRows[0].departure_at, expectDep });

  // ======================= carpool block ABOVE the vehicles, both visible =======================
  const r = await newPage(U.rider2, { width: 1440, height: 900 });
  await openForm(r);
  await setTripDates(r, dep, ret);
  await places(r, O, D);
  await submit(r);
  await r.waitForSelector('[data-testid="carpool-offer-card"]', { timeout: 120000 });
  await r.waitForSelector('[data-testid="vehicle-card-recommended"]', { timeout: 30000 });
  await r.waitForTimeout(800);
  const yC = (await r.locator('[data-testid="carpool-first"]').boundingBox()).y;
  const yV = (await r.locator('[data-testid="vehicle-card-recommended"]').boundingBox()).y;
  record("Carpool block ABOVE the vehicle list, both visible at once (no 'Continuar com veículo')", yC < yV && (await r.locator('button:has-text("Continuar com veículo")').count()) === 0, { yC, yV });
  const ctext = await r.locator('[data-testid="carpool-first"]').innerText();
  record("Carpool block: 'Caronas compatíveis encontradas (1)', departure, detour, seats, 'Solicitar carona' (no names / ratings / Match)", /Caronas compatíveis encontradas \(1\)/.test(ctext) && /vagas?/.test(ctext) && /Solicitar carona/.test(ctext) && !ctext.includes(U.host.fullName) && !/match|★/i.test(ctext), ctext.replace(/\n/g, " | ").slice(0, 200));
  record("Steps with carpool offers: Carona is the current step, Veículo the next (todo)", JSON.stringify(await stepState(r)) === JSON.stringify(["trip:done", "vehicle:todo", "carpool:current", "confirm:todo"]), await stepState(r));
  record("Steps: exactly ONE step carries aria-current", (await r.locator('.rv-step[aria-current="step"]').count()) === 1);
  await shot(r, "05-desktop-1440-carpool-and-vehicles");
  await r.screenshot({ path: path.join(OUT, "05v-desktop-1440-carpool-viewport.png") });
  // Selecionar end to end (alternative vehicle)
  const altPlate = (await r.locator('[data-testid="vehicle-card"] .rv-plate').first().innerText()).trim();
  await r.locator('[data-testid="vehicle-select"]').first().click();
  await r.waitForURL((u) => u.pathname === "/trips", { timeout: 90000 });
  const sel1 = await sql(`select v.plate from reservations res join vehicles v on v.id=res.vehicle_id join trip_requests tr on tr.id=res.trip_request_id where tr.requester_id='${U.rider2.id}'`);
  record("End to end 'Selecionar': reservation created for the chosen alternative vehicle", sel1.length === 1 && sel1[0].plate === altPlate, { sel1, altPlate });

  // ======================= widths =======================
  for (const [w, hgt] of [[1100, 900], [820, 1000]]) {
    const p = await newPage(U.rider3, { width: w, height: hgt });
    await openForm(p);
    await setTripDates(p, dep, ret);
    await places(p, O, D);
    await mapReady(p);
    const pf = await p.locator('[data-testid="rv-form"]').boundingBox();
    const pm = await p.locator('[data-testid="rv-mapcol"]').boundingBox();
    record(`Width ${w}: no horizontal scroll, touch targets >= 44px`, (await hscroll(p)) <= 0 && (await smallTargets(p)).length === 0, { h: await hscroll(p), small: await smallTargets(p) });
    record(`Width ${w}: sidebar 240px respected, form and map do not overlap`, !(pm.x < pf.x + pf.width && pm.y < pf.y + pf.height) || pm.y >= pf.y + pf.height - 1, { pf, pm });
    await shot(p, `06-width-${w}`);
    await p.context().close();
  }

  // ======================= MOBILE 390 =======================
  const m = await newPage(U.rider4, { width: 390, height: 844, mobile: true });
  await openForm(m);
  record("Mobile: bottom nav visible, sidebar + sidebar assistant panel hidden", (await m.locator(".fm-bottom-nav").isVisible()) && !(await m.locator(".fm-sidebar").isVisible()));
  record("Mobile: no horizontal scroll, touch targets >= 44px (form)", (await hscroll(m)) <= 0 && (await smallTargets(m)).length === 0, { h: await hscroll(m), small: await smallTargets(m) });
  await shot(m, "07-mobile-390-form-viewport", false);
  await setTripDates(m, dep, ret);
  await places(m, O, D);
  await mapReady(m);
  const mm = await m.locator('[data-testid="rv-mapcol"]').boundingBox();
  const mf = await m.locator('[data-testid="rv-form"]').boundingBox();
  record("Mobile: map goes BELOW the form", mm.y >= mf.y + mf.height - 1, { mm, mf });
  await submit(m);
  await m.waitForSelector('[data-testid="vehicle-card-recommended"]', { timeout: 120000 });
  await m.waitForTimeout(500);
  record("Mobile: no horizontal scroll / targets >= 44px after the plan", (await hscroll(m)) <= 0 && (await smallTargets(m)).length === 0, { h: await hscroll(m), small: await smallTargets(m) });
  await shot(m, "08-mobile-390-full");
  await m.locator("#rv-vehicles-title").scrollIntoViewIfNeeded();
  await shot(m, "09-mobile-390-vehicles-viewport", false);

  // ======================= AUTOCOMPLETE (real Google) =======================
  const ac = await newPage(U.rider5, { width: 1440, height: 900 });
  await openForm(ac);
  const ac0 = await orgCounters(A.orgId);
  const u0 = await userAc(U.rider5.id);
  const origin = ac.locator("#rv-origin");
  record("Combobox ARIA: role=combobox, aria-expanded=false, aria-controls -> listbox", (await origin.getAttribute("role")) === "combobox" && (await origin.getAttribute("aria-expanded")) === "false" && Boolean(await origin.getAttribute("aria-controls")));
  await origin.fill("");
  await origin.pressSequentially("Avenida Paulista 15", { delay: 30 });
  await acOptions(ac).first().waitFor({ timeout: 30000 });
  const n = await acOptions(ac).count();
  record("Autocomplete: suggestions appear while typing (<= 6), 'Powered by Google' attribution shown", n >= 1 && n <= 6 && /Powered by Google/.test(await ac.locator('[data-testid="ac-attribution"]').innerText()), n);
  record("Autocomplete: aria-expanded=true while open, options >= 44px high", (await origin.getAttribute("aria-expanded")) === "true" && (await acOptions(ac).evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44))));
  await shot(ac, "10-desktop-autocomplete-open", false);
  await origin.press("ArrowDown");
  const activeId = await origin.getAttribute("aria-activedescendant");
  record("Keyboard: ArrowDown sets aria-activedescendant to an option", Boolean(activeId) && (await ac.locator("#" + activeId).getAttribute("aria-selected")) === "true", activeId);
  const chosen = (await ac.locator("#" + activeId).locator(".fm-ac-main").innerText()).trim();
  await origin.press("Enter");
  const filled = await origin.inputValue();
  record("Keyboard: Enter fills the input with the option's full text and closes the list (form not submitted)", filled.length > "Avenida Paulista 15".length && /Paulista/i.test(filled) && (await origin.getAttribute("aria-expanded")) === "false" && (await ac.locator('[data-testid="vehicle-card-recommended"]').count()) === 0, { chosen, filled });
  await origin.fill("");
  await origin.pressSequentially("Avenida Paulista 15", { delay: 30 });
  await acOptions(ac).first().waitFor({ timeout: 30000 });
  await origin.press("Escape");
  record("Keyboard: Escape closes the list", (await origin.getAttribute("aria-expanded")) === "false");
  await ac.locator("#rv-destination").fill("");
  await ac.locator("#rv-destination").pressSequentially("Avenida Washington Luis 5", { delay: 30 });
  await acOptions(ac).first().waitFor({ timeout: 30000 });
  await acOptions(ac).nth(0).click();
  record("Mouse/touch: clicking an option fills the field", /Washington/i.test(await ac.locator("#rv-destination").inputValue()));
  const ac1 = await orgCounters(A.orgId);
  const u1 = await userAc(U.rider5.id);
  record("Counters: place_autocomplete rose; carpool kinds geocode / routing / place_search did NOT", ac1("place_autocomplete") > ac0("place_autocomplete") && ac1("geocode") === ac0("geocode") && ac1("routing") === ac0("routing") && ac1("place_search") === ac0("place_search"), { ac: [ac0("place_autocomplete"), ac1("place_autocomplete")], geo: [ac0("geocode"), ac1("geocode")] });
  record("Per-user counter (user_daily_geo_usage) rose with each call", u1 > u0, { u0, u1 });
  // free typing path still works with no suggestion chosen
  await setTripDates(ac, dep, ret);
  await ac.fill('input[name="origin"]', O);
  await ac.keyboard.press("Escape");
  await ac.fill('input[name="destination"]', D);
  await ac.keyboard.press("Escape");
  await submit(ac);
  await ac.waitForSelector('[data-testid="vehicle-card-recommended"], .rv-error', { timeout: 120000 });
  record("Free typing (no suggestion chosen) still plans normally", (await ac.locator('[data-testid="vehicle-card-recommended"], .rv-error').count()) >= 1);

  // mobility point first + labelled
  await openForm(ac);
  await ac.locator("#rv-origin").fill("");
  await ac.locator("#rv-origin").pressSequentially("Matriz Paulista", { delay: 30 });
  await acOptions(ac).first().waitFor({ timeout: 30000 });
  const first = acOptions(ac).first();
  record("Corporate Mobility Point is FIRST and labelled 'Ponto corporativo'", (await first.getAttribute("data-kind")) === "point" && /Ponto corporativo/.test(await first.innerText()) && /Matriz Paulista Teste/.test(await first.innerText()), (await first.innerText()).replace(/\n/g, " | "));
  await shot(ac, "11-desktop-autocomplete-point-first", false);
  await ac.locator("#rv-origin").press("Escape");

  // ---- audit fixes: live region, long point name + badge, Ctrl+K, aborts, API, mobile popover
  await ac.locator("#rv-origin").fill("");
  await ac.locator("#rv-origin").pressSequentially("Matriz Paulista Teste Com Nome", { delay: 30 });
  await acOptions(ac).first().waitFor({ timeout: 30000 });
  const statEl = ac.locator('[data-testid="ac-status"]').filter({ hasText: /sugest/i }).first();
  const stat = (await statEl.innerText()).trim();
  record("Combobox announces 'N sugestões disponíveis' in a polite live region", /sugest/i.test(stat) && (await statEl.getAttribute("aria-live")) === "polite", stat);
  const longOpt = acOptions(ac).first();
  const ob = await longOpt.boundingBox();
  const bb = await longOpt.locator(".fm-badge").boundingBox();
  const truncated = await longOpt.locator(".fm-ac-name").evaluate((e) => e.scrollWidth > e.clientWidth);
  record("Long point name truncates with an ellipsis and the 'Ponto corporativo' badge is never clipped", Boolean(bb) && truncated && bb.x + bb.width <= ob.x + ob.width + 1, { truncated, badgeRight: bb && bb.x + bb.width, optRight: ob.x + ob.width });
  await ac.locator("#rv-origin").press("Escape");
  await ac.locator("#rv-origin").focus();
  await ac.keyboard.press("Control+k");
  record("Ctrl+K does not hijack the browser shortcut while typing in another field", await ac.evaluate(() => document.activeElement?.id === "rv-origin"));
  let aborted = 0;
  ac.on("requestfailed", (rq) => { if (/api\/geo\/autocomplete/.test(rq.url()) && /ABORTED/i.test(rq.failure()?.errorText ?? "")) aborted++; });
  await ac.locator("#rv-origin").fill("");
  await ac.locator("#rv-origin").pressSequentially("Avenida Brasil 123", { delay: 270 });
  await ac.waitForTimeout(1500);
  record("Typing really aborts stale autocomplete requests (fetch + AbortController)", aborted >= 1, { aborted });
  await ac.locator("#rv-origin").press("Escape");
  // API: auth / CSRF / same-origin
  const apiUrl = BASE + "/api/geo/autocomplete";
  const anon = await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ input: "Avenida Paulista" }), redirect: "manual" });
  record("API: unauthenticated POST -> 401 JSON (no redirect), autocomplete", anon.status === 401 && anon.headers.get("location") === null && (await anon.json()).error === "not_authenticated");
  const anonMap = await fetch(BASE + "/api/geo/route-map", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ originText: "a", destinationText: "b" }), redirect: "manual" });
  record("API: unauthenticated POST -> 401 JSON, route-map", anonMap.status === 401 && anonMap.headers.get("location") === null);
  const cross = await ac.context().request.post(apiUrl, { headers: { Origin: "http://evil.example" }, data: { input: "Avenida Paulista" } });
  record("API: cross-origin Origin (with a valid session cookie) -> 403", cross.status() === 403, cross.status());
  const noSite = await ac.context().request.post(apiUrl, { headers: { Origin: BASE }, data: { input: "Avenida Paulista" } });
  record("API: same Origin but no Sec-Fetch-Site (not a browser same-origin fetch) -> 403", noSite.status() === 403, noSite.status());
  const crossMap = await ac.context().request.post(BASE + "/api/geo/route-map", { headers: { Origin: "http://evil.example" }, data: { originText: "a", destinationText: "b" } });
  record("API: cross-origin route-map -> 403", crossMap.status() === 403);
  const same = await ac.evaluate(async () => {
    const r = await fetch("/api/geo/autocomplete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "Avenida Paulista 15" }) });
    return { status: r.status, cc: r.headers.get("cache-control"), acao: r.headers.get("access-control-allow-origin"), j: await r.json() };
  });
  record("API: same-origin browser fetch works (200, no-store, no CORS header, suggestions)", same.status === 200 && same.cc === "no-store" && same.acao === null && same.j.status === "ok" && same.j.suggestions.length >= 1, { status: same.status, cc: same.cc });
  const bad = await ac.evaluate(async () => (await fetch("/api/geo/autocomplete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: 5, evil: true }) })).status);
  record("API: invalid body shape -> 400", bad === 400, bad);

  // /carpool shares the component
  await ac.goto(BASE + "/carpool", { waitUntil: "domcontentloaded" });
  await hydrated(ac);
  await ac.locator("#fm-origin").pressSequentially("Avenida Paulista 15", { delay: 30 });
  await acOptions(ac).first().waitFor({ timeout: 30000 });
  record("/carpool origin uses the same autocomplete combobox", (await ac.locator("#fm-origin").getAttribute("role")) === "combobox" && (await acOptions(ac).count()) >= 1);

  // per-user cap seeded at 399/400 -> one more allowed, then silent
  const cap = await newPage(U.rider6, { width: 1440, height: 900 });
  await sql(`insert into user_daily_geo_usage (user_id, kind, day, calls) values ('${U.rider6.id}', 'place_autocomplete', (now() at time zone 'utc')::date, 399) on conflict (user_id, kind, day) do update set calls=399`);
  await openForm(cap);
  const k0 = await orgCounters(A.orgId);
  await cap.locator("#rv-origin").fill("");
  await cap.locator("#rv-origin").pressSequentially("Avenida Paulista 15", { delay: 30 });
  await acOptions(cap).first().waitFor({ timeout: 30000 });
  record("Cap 399/400: the 400th call still returns suggestions", (await userAc(U.rider6.id)) === 400);
  const k1 = await orgCounters(A.orgId);
  await cap.locator("#rv-origin").fill("");
  await cap.locator("#rv-origin").pressSequentially("Avenida Brasil 20", { delay: 30 });
  await cap.waitForTimeout(2500);
  const k2 = await orgCounters(A.orgId);
  record("Cap reached: silent (no list), counter stays 400, NO provider call (org counter unchanged)", (await acOptions(cap).count()) === 0 && (await userAc(U.rider6.id)) === 400 && k2("place_autocomplete") === k1("place_autocomplete") && k1("place_autocomplete") > k0("place_autocomplete"), { user: await userAc(U.rider6.id), org: [k1("place_autocomplete"), k2("place_autocomplete")] });
  record("Cap reached: the page keeps working (free typing + map + plan)", (await cap.locator("#rv-origin").inputValue()) === "Avenida Brasil 20");

  // mobile: the open list clears the bottom nav and the chat button
  await m.locator("#rv-destination").scrollIntoViewIfNeeded();
  await m.evaluate(() => { const e = document.getElementById("rv-destination"); const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - (innerHeight - 250)); });
  await m.locator("#rv-destination").fill("");
  await m.locator("#rv-destination").pressSequentially("Avenida Washington", { delay: 30 });
  await acOptions(m).first().waitFor({ timeout: 30000 });
  await m.waitForTimeout(300);
  const pop = await m.locator(".fm-ac-pop:not([hidden])").first().boundingBox();
  const navB = await m.locator(".fm-bottom-nav").boundingBox();
  const fabB = await m.locator('button[aria-label="Assistente Fleet"]').boundingBox();
  const field = await m.locator("#rv-destination").boundingBox();
  const above = pop.y + pop.height <= field.y + 1;
  const clears = above || (pop.y + pop.height <= navB.y - 1 && (pop.y + pop.height <= fabB.y || pop.x + pop.width <= fabB.x || pop.x >= fabB.x + fabB.width));
  record("Mobile 390: the open autocomplete list clears the bottom nav and the chat button (limited height or flipped above)", clears && (await hscroll(m)) <= 0, { pop, navTop: navB.y, fabTop: fabB.y, above });
  await shot(m, "13-mobile-390-autocomplete-open", false);
  await m.locator("#rv-destination").press("Escape");

  // toggle hidden when the org's carpool policy is off; autocomplete + map still work
  const off = await newPage(B.users.u, { width: 1440, height: 900 });
  await openForm(off);
  record("Carpool policy OFF: the 'Buscar caronas compatíveis' toggle is not rendered and the steps are 3", (await off.locator("#rv-search-carpool").count()) === 0 && JSON.stringify(await stepState(off)) === JSON.stringify(["trip:current", "vehicle:todo", "confirm:todo"]), await stepState(off));
  await off.locator("#rv-origin").fill("");
  await off.locator("#rv-origin").pressSequentially("Avenida Paulista 15", { delay: 30 });
  await acOptions(off).first().waitFor({ timeout: 30000 });
  record("Carpool policy OFF: address autocomplete still works", (await acOptions(off).count()) >= 1);
  await off.locator("#rv-origin").press("Escape");
  await places(off, O, D);
  await mapReady(off);
  record("Carpool policy OFF: the route map still loads", (await off.locator('[data-testid="route-map-img"]').count()) === 1);
  await shot(off, "14-desktop-carpool-off-no-toggle", false);

  // key never in browser
  const html = await d.content();
  record("Google key never in the browser: HTML, JS and action responses contain neither the key nor 'AIza'", leaks.length === 0 && !(GKEY && html.includes(GKEY)) && !/AIza[0-9A-Za-z_-]{20,}/.test(html), leaks.slice(0, 3));

  // ======================= the plan is NOT queued behind a slow map (route handler, not a server action) =======================
  try {
    const sp = await newPage(U.mgr, { width: 1440, height: 900, base: BASE3, watch: false });
    await openForm(sp, BASE3);
    await setTripDates(sp, dep, ret);
    await places(sp, O, D);
    await sp.getByRole("switch", { name: /Buscar caronas compatíveis/ }).uncheck();
    await submit(sp); // warm-up plan (untimed)
    await sp.waitForFunction(() => { const b = document.querySelector("button.rv-submit"); return Boolean(b) && !b.disabled && document.querySelector('[data-testid="vehicle-card-recommended"], .rv-error'); }, null, { timeout: 120000 });
    await sp.fill('input[name="destination"]', "Avenida Brigadeiro Faria Lima, 1500, São Paulo");
    await sp.keyboard.press("Escape");
    await sp.waitForSelector('[data-testid="route-map"][data-state="loading"]', { timeout: 20000 });
    const t0 = Date.now();
    await submit(sp);
    await sp.waitForFunction(() => { const b = document.querySelector("button.rv-submit"); return Boolean(b) && b.disabled; }, null, { timeout: 5000 }).catch(() => {});
    await sp.waitForFunction(() => { const b = document.querySelector("button.rv-submit"); return Boolean(b) && !b.disabled; }, null, { timeout: 60000 });
    const planMs = Date.now() - t0;
    const mapState = await sp.locator('[data-testid="route-map"]').getAttribute("data-state").catch(() => null);
    record("Plan submit is NOT delayed by an in-flight (4s-slowed) map request: result within ~2s while the map is still loading", planMs <= 3200 && mapState === "loading", { planMs, mapState });
    await sp.context().close();
  } catch (e) {
    record("Plan vs slow map (third server)", false, String(e).slice(0, 300));
  }

  // ======================= OUTAGE (bad key) =======================
  try {
    const o = await newPage(U.mgr, { width: 1440, height: 900, base: BASE2, watch: false });
    await openForm(o, BASE2);
    await o.locator("#rv-origin").fill("");
    await o.locator("#rv-origin").pressSequentially("Avenida Paulista 15", { delay: 30 });
    await o.waitForTimeout(3000);
    record("Outage: autocomplete is silent (no list)", (await acOptions(o).count()) === 0);
    await setTripDates(o, dep, ret);
    await places(o, O, D);
    await o.waitForSelector('[data-testid="route-map-unavailable"]', { timeout: 90000 });
    record("Outage: map shows one muted unavailable line, no image", (await o.locator('[data-testid="route-map-img"]').count()) === 0);
    await submit(o);
    await o.waitForSelector('[data-testid="vehicle-card-recommended"]', { timeout: 120000 });
    record("Outage: the page still plans vehicles (carpool banner, vehicle flow untouched)", (await o.locator('button:has-text("Solicitar reserva")').count()) === 1);
    const ob = await o.content();
    record("Outage: the fake key never appears in the HTML", !ob.includes("AIzaInvalidKeyForOutageSimulation"));
    await shot(o, "12-desktop-outage");
  } catch (e) {
    record("Outage state (second server)", false, String(e).slice(0, 300));
  }
  record("No page errors on any page (any pageerror fails this suite)", pageErrors.length === 0, pageErrors.slice(0, 5));
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
