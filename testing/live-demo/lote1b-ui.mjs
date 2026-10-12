// Lote 1B: Command Center 360 (SCR-FM-001, manager /dashboard), Veículos (SCR-FM-002, /fleet and /fleet/vehicles/[id]),
// Portaria (SCR-SEC-001, /gate), Relatórios (SCR-FM-009, /analytics), Caronas do gestor (SCR-FM-004, /analytics/carpool),
// Usuários e Permissões (SCR-ADM-002, /settings/users) and Políticas (SCR-ADM-003, /settings) in the FleetMind v2.0 look.
// Real-browser walk-through (Playwright headless; live Supabase through `next start` on BASE_URL), disposable org via the
// carpool-c5-lib helpers, removed in `finally`; the cleanup queries must report zero rows.
// Screenshots -> resultado_de_testes/design-v2/implemented-lote1b/ (mobile = viewport only)
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASE, PASSWORD, T, record, results, sql, provisionOrg, cleanupOrgs, ROOT } from "./carpool-c5-lib.mjs";

const OUT = path.join(ROOT, "resultado_de_testes", "design-v2", "implemented-lote1b");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const orgs = [];
const D = { width: 1440, height: 900 };
const M = { width: 390, height: 844 };

async function shot(page, name, full) {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage: full });
  console.log("    screenshot: " + path.relative(ROOT, file).replace(/\\/g, "/"));
}
async function newPage(user, vp, { locale = "pt-BR" } = {}) {
  const mobile = vp.width < 600;
  const context = await browser.newContext({ viewport: vp, locale, timezoneId: "America/Sao_Paulo", hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e).slice(0, 200)));
  let ok = false;
  for (let i = 0; i < 2 && !ok; i++) {
    try {
      await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.fill('input[name="email"]', user.email);
      await page.fill('input[name="password"]', PASSWORD);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 }), page.click('button[type="submit"]')]);
      ok = true;
    } catch (e) {
      if (i === 1) throw e;
    }
  }
  return page;
}
/** goto with one retry on the (cold-compile) first-navigation timeout. */
async function go(page, url) {
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(500);
      return;
    } catch (e) {
      if (i === 1) throw e;
    }
  }
}
const text = (page) => page.evaluate(() => document.body.innerText);
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const hasFm = (page) => page.locator('[data-testid="fm-theme"]').count().then((n) => n === 1);
const sideHrefs = (page) => page.$$eval(".fm-sidebar .fm-nav a", (as) => as.map((a) => a.getAttribute("href")));
const bottomHrefs = (page) => page.$$eval(".fm-bottom-nav a", (as) => as.map((a) => a.getAttribute("href")));
const path_ = (page) => new URL(page.url()).pathname;
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".fm-theme a, .fm-theme button, .fm-theme input, .fm-theme select, .fm-theme textarea, .fm-theme summary")]
      .filter((e) => {
        if (e.closest(".fm-sr-only") || e.closest(".fm-chat") || e.closest(".gantt-scroll") || e.type === "hidden") return false;
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        if (e.closest('[style*="display: none"]') || e.closest("[hidden]")) return false;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (e.type === "file" || e.classList.contains("sr-only")) return false;
        const box = e.type === "radio" || e.type === "checkbox" ? (e.closest("label") ?? e).getBoundingClientRect() : r;
        return box.height < 43.5 || box.width < 43.5;
      })
      .map((e) => (e.getAttribute("aria-label") || e.getAttribute("name") || e.textContent || e.tagName).trim().slice(0, 30) + ":" + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)),
  );
const lumArr = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** Contrast of every visible text node against the EFFECTIVE background (all translucent ancestor layers composited over white;
 *  any CSS colour syntax is normalised through a canvas). WCAG AA: 4.5:1 normal text, 3:1 large text. */
async function lowContrast(page, scope = ".fm-content") {
  const rows = await page.evaluate((sc) => {
    const out = [];
    const root = document.querySelector(sc);
    if (!root) return out;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.closest("[hidden], .fm-sr-only, .fm-chat, [aria-hidden='true'], option") || parseFloat(cs.opacity) < 1) continue;
      const layers = [];
      for (let e = el; e; e = e.parentElement) layers.push(getComputedStyle(e).backgroundColor);
      let bg = [255, 255, 255];
      for (const l of layers.reverse()) { const [r2, g2, b2, a2] = rgba(l); if (a2 > 0) bg = [r2 * a2 + bg[0] * (1 - a2), g2 * a2 + bg[1] * (1 - a2), b2 * a2 + bg[2] * (1 - a2)]; }
      const [fr, fg, fb, fa] = rgba(cs.color);
      const fgc = [fr * fa + bg[0] * (1 - fa), fg * fa + bg[1] * (1 - fa), fb * fa + bg[2] * (1 - fa)];
      out.push({ t: n.textContent.trim().slice(0, 24), fg: fgc, bg, size: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 700 });
    }
    return out;
  }, scope);
  return rows
    .map((x) => ({ ...x, ratio: (Math.max(lumArr(x.fg), lumArr(x.bg)) + 0.05) / (Math.min(lumArr(x.fg), lumArr(x.bg)) + 0.05) }))
    .filter((x) => x.ratio < (x.size >= 24 || (x.size >= 18.66 && x.bold) ? 3 : 4.5))
    .map((x) => `${x.t}:${x.ratio.toFixed(2)}`);
}
const INVENTED = /match\s?\d|★|\bco₂\b|\bco2\b|rating|avalia(ç|c)ão|árvores|unidade\s+iracem|r\$\s?\d/i;
const BAD = ["application error", "something went wrong", "unhandled runtime", "internal server error", "permission denied"];
const SECONDS = /\b\d{1,2}:\d{2}:\d{2}\b/;

try {
  // ------------------------------------------------------------------ static: every selector scoped
  for (const f of ["apps/web/app/fm-ops.css"]) {
    const css = readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/(?:^|})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter(Boolean).filter((s) => !/^(to|from|[0-9.]+%)$/.test(s));
    const unscoped = selectors.filter((s) => s.split(",").some((p) => !p.trim().startsWith(".fm-theme")));
    record(`${f}: every selector is scoped under .fm-theme`, unscoped.length === 0, unscoped.slice(0, 5));
  }

  // ------------------------------------------------------------------ data
  const A = await provisionOrg("lb", [
    ["adm", "administrator"], ["mgr", "fleet_manager"], ["sec", "security"], ["mnt", "maintenance_operator"],
    ["emp", "employee"], ["emp2", "employee"], ["emp3", "employee"],
  ]);
  orgs.push(A);
  const U = A.users;
  const O = A.orgId;
  console.log(`\n=== Lote 1B walkthrough (${BASE}) org=${O} ===\n`);
  await sql(`update profiles set driver_authorized=true where organization_id='${O}'`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${O}', 1, 15, 15, 5, 15, 30)`);
  await sql(`insert into safety_equipment_items (organization_id, name) values ('${O}','Triangulo-LB'),('${O}','Extintor-LB')`);
  const cats = { ICE: (await sql(`select id from vehicle_categories where organization_id='${O}'`))[0].id };
  for (const e of ["HEV", "PHEV", "BEV"]) cats[e] = (await sql(`insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('${O}', 'LB ${e}', 5, '${e}') returning id`))[0].id;
  const [loc1] = await sql(`insert into vehicle_locations (organization_id, name) values ('${O}','Sede LB') returning id`);
  let vn = 10;
  const veh = async (energy, status = "available", odo = 1000) => {
    vn += 1;
    const fuel = energy === "BEV" ? "null" : "70";
    const batt = energy === "BEV" || energy === "PHEV" ? "60" : "null";
    return (await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, battery_level_percent, estimated_range_km, next_service_odometer_km, name, current_location_id, home_location_id)
      values ('${O}','LB${vn}${T.slice(-3).toUpperCase()}','${cats[energy]}','${status}',${odo},${fuel},${batt},400,${odo + 500},'Carro ${energy} ${vn}','${loc1.id}','${loc1.id}') returning id, plate`))[0];
  };
  const trip = async (who, origin, dest, startExpr, endExpr, pax = 2) =>
    (await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${O}','${U[who].id}',${startExpr},${endExpr},'${origin}','${dest}',20,${pax},'LB justificativa ${dest}') returning id`))[0].id;
  const resv = async (v, t, status, startExpr, endExpr) =>
    (await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${O}','${v.id}','${t}','${status}',${startExpr},${endExpr}) returning id`))[0].id;
  const NOW_S = "now() - interval '1 hour'";
  const NOW_E = "now() + interval '6 hours'";
  const mk = async (who, energy, vstatus, rstatus, label, s = NOW_S, e = NOW_E) => {
    const v = await veh(energy, vstatus);
    const t = await trip(who, "Valinhos", label, s, e);
    const id = await resv(v, t, rstatus, s, e);
    return { v, t, id, label };
  };
  const vAvail = A.vehicles; // two available ICE vehicles from provisionOrg
  const P1 = await mk("emp", "ICE", "available", "pending_approval", "Santos-P1", "now() + interval '2 days'", "now() + interval '2 days' + interval '5 hours'");
  const P2 = await mk("emp2", "HEV", "maintenance", "pending_approval", "Campinas-P2-manut", "now() + interval '3 days'", "now() + interval '3 days' + interval '5 hours'");
  const C1 = await mk("emp", "ICE", "reserved", "confirmed", "SaoPaulo-C1-saida");
  const C2 = await mk("emp2", "PHEV", "awaiting_pickup", "confirmed", "Jundiai-C2-aguarda");
  const C3 = await mk("emp3", "BEV", "in_use", "confirmed", "Sorocaba-C3-viagem");
  const C4 = await mk("emp", "HEV", "returning", "confirmed", "Atibaia-C4-retorno");
  // emp already has C1 (now-1h..now+6h): this pending reservation overlaps it on another vehicle => the overlap warning
  const OV = await mk("emp", "ICE", "available", "pending_approval", "Itu-OV-sobreposta", "now() - interval '30 minutes'", "now() + interval '3 hours'");
  await veh("BEV", "charging");
  await veh("PHEV", "cleaning");
  // completed history with odometer readings (real inspection rows) => Relatórios real data
  const DONE1 = await mk("emp3", "ICE", "available", "completed", "Osasco-Concluida", "now() - interval '6 days'", "now() - interval '6 days' + interval '4 hours'");
  for (const [r, type, odo] of [[DONE1, "pickup", 5000], [DONE1, "return", 5120]]) {
    await sql(`insert into inspections (organization_id, reservation_id, vehicle_id, type, performed_by, performed_by_role, odometer_km) values ('${O}','${r.id}','${r.v.id}','${type}','${U.emp3.id}','traveler',${odo})`);
  }
  await sql(`update vehicles set odometer_km=5120 where id='${DONE1.v.id}'`);
  const [task1] = await sql(`insert into workflow_tasks (organization_id, vehicle_id, type, notes) values ('${O}','${C4.v.id}','cleaning','Limpeza-LB-1') returning id`);
  const [task2] = await sql(`insert into workflow_tasks (organization_id, vehicle_id, type, notes, assigned_to) values ('${O}','${C3.v.id}','safety','Seguranca-LB-2','${U.mnt.id}') returning id`);
  const [task3] = await sql(`insert into workflow_tasks (organization_id, vehicle_id, type, notes) values ('${O}','${C1.v.id}','repair','Reparo-LB-3') returning id`);
  const nVehicles = Number((await sql(`select count(*) c from vehicles where organization_id='${O}'`))[0].c);

  // ------------------------------------------------------------------ warm up (cold compile)
  let mgr = await newPage(U.mgr, D);
  for (const u of ["/dashboard", "/fleet", `/fleet/vehicles/${C1.v.id}`, "/gate", "/analytics", "/analytics/carpool", "/settings", "/trips"]) await go(mgr, u);
  let adm = await newPage(U.adm, D);
  for (const u of ["/settings/users", "/settings", "/settings/mobility-points"]) await go(adm, u);

  const st = (id) => sql(`select status from reservations where id='${id}'`).then((r) => r[0]?.status);
  const act = async (page, fn) => { await fn(); await page.waitForTimeout(2500); };
  const MGR_NAV = ["/dashboard", "/gate", "/analytics", "/fleet", "/settings", "/trips", "/trips/new", "/carpool"];
  const ALL_PAGES = ["/dashboard", "/fleet", "/gate", "/analytics", "/analytics/carpool", "/settings"];

  // ================================================================== SECURITY: Portaria (before the manager mutates the rows)
  console.log("\n--- Portaria / security ---");
  let sec = await newPage(U.sec, D);
  await go(sec, "/gate");
  record("Gate: /gate renders inside .fm-theme with the SCR-SEC-001 title", (await hasFm(sec)) && /Portaria – Command Center/.test(await text(sec)));
  let t = await text(sec);
  const rowsN = await sec.locator('[data-testid="gate-row"]').count();
  record("Gate: lists exactly the actionable reservations (2 departures + 2 returns), not pending ones", rowsN === 4 && !/Santos-P1|Campinas-P2/.test(t) && /SaoPaulo-C1-saida/.test(t) && /Atibaia-C4-retorno/.test(t), rowsN);
  const kp = async (id) => (await sec.locator(`[data-testid="${id}"] .fm-kpi-value`).innerText()).trim();
  record("Gate: KPI tiles are real counts (pending departures 2, distinct vehicles on a trip 1, returning 1) and no cap note below 100 rows", (await kp("gate-kpi-pickup")) === "2" && (await kp("gate-kpi-inuse")) === "1" && (await kp("gate-kpi-returning")) === "1" && (await sec.locator('[data-testid="gate-cap-note"]').count()) === 0);
  record("Gate: tabs show the real counts (Todas 4 / Saídas 2 / Retornos 2)", /Todas\s*4/.test(await sec.locator('[data-testid="gate-tab-all"]').innerText()) && /2/.test(await sec.locator('[data-testid="gate-tab-pickup"]').innerText()) && /2/.test(await sec.locator('[data-testid="gate-tab-return"]').innerText()));
  record("Gate: KPI labels say vehicles (distinct), not reservations", /Veículos em viagem/.test(await text(sec)));
  await sec.click('[data-testid="gate-tab-pickup"]');
  record("Gate: 'Saídas' tab filters to the 2 pickups", (await sec.locator('[data-testid="gate-row"]').count()) === 2 && (await sec.locator('a:has-text("Retorno do Veículo")').count()) === 0);
  await sec.click('[data-testid="gate-tab-return"]');
  record("Gate: 'Retornos' tab filters to the 2 returns", (await sec.locator('[data-testid="gate-row"]').count()) === 2 && (await sec.locator('a:has-text("Saída do Veículo")').count()) === 0);
  await sec.click('[data-testid="gate-tab-all"]');
  await sec.fill("#gate-plate-search", C3.v.plate.toLowerCase().slice(0, 5));
  record("Gate: plate search filters (partial, case-insensitive)", (await sec.locator('[data-testid="gate-row"]').count()) === 1 && (await sec.locator('[data-testid="gate-row"]').innerText()).includes(C3.v.plate));
  await sec.fill("#gate-plate-search", "ZZZ999");
  record("Gate: search with no match shows the 'no results' text", /Nenhuma reserva com essa placa/.test(await text(sec)));
  await sec.fill("#gate-plate-search", "");
  const hrefs = await sec.$$eval('[data-testid="gate-row"] a', (as) => as.map((a) => a.getAttribute("href")));
  record("Gate: row actions keep the existing routes (details / pickup / return)", hrefs.includes(`/reservations/${C1.id}`) && hrefs.includes(`/reservations/${C1.id}/pickup`) && hrefs.includes(`/reservations/${C3.id}/return`) && hrefs.includes(`/reservations/${C4.id}/return`), hrefs);
  t = await text(sec);
  record("Gate: no dates with seconds, no invented elements (no OCR/camera/voice plate, no map, no photos)", !SECONDS.test(t) && !INVENTED.test(t) && !/Fotografar|Falar placa|Ocorr/.test(t) && (await sec.locator(".fm-theme img, .fm-theme iframe, .fm-theme canvas").count()) === 0, t.match(SECONDS)?.[0]);
  record("Gate (desktop): no horizontal scroll, touch targets >= 44px, AA contrast, no JS errors", (await hscroll(sec)) <= 0 && (await smallTargets(sec)).length === 0 && (await lowContrast(sec)).length === 0 && sec.__errors.length === 0, { h: await hscroll(sec), small: await smallTargets(sec), low: (await lowContrast(sec)).slice(0, 6), err: sec.__errors });
  await shot(sec, "gate-desktop", true);
  const sh = await sideHrefs(sec);
  record("Security nav: Movimentações (/gate) + Minhas Reservas, no Painel / Frota / Analytics / Configurações / Equipe", sh.includes("/gate") && sh.includes("/trips") && !["/dashboard", "/fleet", "/analytics", "/settings", "/settings/users"].some((h) => sh.includes(h)), sh);
  record("Security: chat assistant, bell, theme and language toggles present", (await sec.locator(".fm-chat button").count()) > 0 && (await sec.locator('button[aria-label^="Notifica"]:visible').count()) > 0 && (await sec.locator(".fm-topbar button").count()) >= 3);
  for (const u of ["/fleet", "/analytics", "/analytics/carpool", "/settings", "/settings/users"]) {
    await go(sec, u);
    record(`Security cannot open ${u} (redirected away)`, !path_(sec).startsWith(u) || (u === "/settings" && false), path_(sec));
  }
  await go(sec, "/dashboard");
  t = await text(sec);
  record("Security /dashboard: no approval / reservation-management / task sections; vehicle panel kept", (await sec.locator("#pending-approvals, #active-reservations, #open-tasks").count()) === 0 && (await sec.locator("#fleet-vehicles").count()) === 1 && !/Aprovar|Rejeitar/.test(t) && (await hasFm(sec)));
  const secM = await newPage(U.sec, M);
  await go(secM, "/gate");
  record("Gate (mobile): no horizontal scroll, touch targets >= 44px, bottom nav has Movimentações", (await hscroll(secM)) <= 0 && (await smallTargets(secM)).length === 0 && (await bottomHrefs(secM)).includes("/gate"), { h: await hscroll(secM), small: await smallTargets(secM), nav: await bottomHrefs(secM) });
  const tabBox = await secM.locator('[data-testid="gate-tab-return"]').boundingBox();
  const fabBox = await secM.locator(".fm-chat button.fixed").first().boundingBox();
  const overlap = tabBox && fabBox && !(tabBox.x + tabBox.width <= fabBox.x || fabBox.x + fabBox.width <= tabBox.x || tabBox.y + tabBox.height <= fabBox.y || fabBox.y + fabBox.height <= tabBox.y);
  record("Gate (mobile): the 'Retornos' tab is not under the chat button", !overlap, { tabBox, fabBox });
  await shot(secM, "gate-mobile", false);
  await shot(secM, "gate-mobile-full", true);
  await secM.context().close();
  await sec.context().close();

  // ================================================================== MAINTENANCE
  console.log("\n--- Maintenance ---");
  const mnt = await newPage(U.mnt, D);
  await go(mnt, "/dashboard");
  t = await text(mnt);
  record("Maintenance /dashboard: task queue present (claim / complete / cancel), no approvals / reservations sections", (await mnt.locator("#open-tasks").count()) === 1 && (await mnt.locator("#pending-approvals, #active-reservations").count()) === 0 && /Limpeza-LB-1/.test(t));
  record("Maintenance /dashboard: KPI tiles = vehicles, tasks, attention only", (await mnt.locator('[data-testid="cc-kpi-pending"], [data-testid="cc-kpi-active"]').count()) === 0 && (await mnt.locator('[data-testid="cc-kpi-tasks"]').count()) === 1);
  await shot(mnt, "cc-maintenance-desktop", true);
  for (const u of ["/gate", "/fleet", "/analytics", "/settings"]) {
    await go(mnt, u);
    record(`Maintenance cannot open ${u}`, !path_(mnt).startsWith(u), path_(mnt));
  }
  await mnt.context().close();

  // ================================================================== EMPLOYEE: no manager pages
  console.log("\n--- Employee ---");
  const emp = await newPage(U.emp, D);
  for (const u of ["/fleet", "/gate", "/analytics", "/analytics/carpool", "/settings", "/settings/users", `/fleet/vehicles/${C1.v.id}`, "/settings/mobility-points"]) {
    await go(emp, u);
    record(`Employee cannot open ${u}`, path_(emp) === "/dashboard", path_(emp));
  }
  await go(emp, "/dashboard");
  record("Employee /dashboard is still the employee Home (no manager sections)", (await emp.locator('[data-testid="employee-home"]').count()) === 1 && (await emp.locator("#pending-approvals, .cc-grid, [data-testid=cc-kpis]").count()) === 0);
  const eh = await sideHrefs(emp);
  record("Employee nav regression: Início, Buscar Carona, Reservar, Minhas Reservas only", ["/dashboard", "/carpool", "/trips/new", "/trips"].every((h) => eh.includes(h)) && !["/gate", "/analytics", "/fleet", "/settings", "/settings/users"].some((h) => eh.includes(h)), eh);
  await emp.context().close();

  // ================================================================== MANAGER: Command Center (layout first, then actions)
  console.log("\n--- Command Center / manager ---");
  await go(mgr, "/dashboard");
  record("CC: /dashboard (manager) renders inside .fm-theme with the SCR-FM-001 title", (await hasFm(mgr)) && /Fleet Command Center 360°/.test(await text(mgr)));
  const kv = async (id) => (await mgr.locator(`[data-testid="${id}"] .fm-kpi-value`).innerText()).trim();
  record(`CC: KPI tiles are real counts (vehicles ${nVehicles}, pending approvals 3, active reservations 7, open tasks 3)`, (await kv("cc-kpi-vehicles")) === String(nVehicles) && (await kv("cc-kpi-pending")) === "3" && (await kv("cc-kpi-active")) === "7" && (await kv("cc-kpi-tasks")) === "3", { v: await kv("cc-kpi-vehicles"), p: await kv("cc-kpi-pending"), a: await kv("cc-kpi-active"), t: await kv("cc-kpi-tasks") });
  t = await text(mgr);
  record("CC: status legend counts vehicles per real status (Disponível, Em Uso, Manutenção...)", /Disponível\s*\n?\s*\d/.test(t) && /Em Uso/.test(t) && /Manutenção/.test(t));
  record("CC: overlap warning + conflict badge kept (same requester, two vehicles)", /sobrepostos em veículos diferentes/.test(t) && /sobreposição de horário/.test(t));
  record("CC: all manager sections present (attention, approvals, tasks, Gantt+table, vehicle panel)", (await mgr.locator("#attention, #pending-approvals, #open-tasks, #active-reservations, #fleet-vehicles").count()) === 5 && (await mgr.locator(".cc-table-wrap table").count()) === 1);
  record("CC: no dates with seconds, no invented elements (no map, rating, savings, CO2, photos)", !SECONDS.test(t) && !INVENTED.test(t) && (await mgr.locator(".fm-theme img, .fm-theme iframe, .fm-theme canvas").count()) === 0, t.match(SECONDS)?.[0] ?? t.match(INVENTED)?.[0]);
  const lc = await lowContrast(mgr);
  record("CC (desktop): no horizontal scroll, touch targets >= 44px, AA contrast, no JS errors", (await hscroll(mgr)) <= 0 && (await smallTargets(mgr)).length === 0 && lc.length === 0 && mgr.__errors.length === 0, { h: await hscroll(mgr), small: (await smallTargets(mgr)).slice(0, 8), low: lc.slice(0, 8), err: mgr.__errors });
  await shot(mgr, "cc-desktop", true);
  await shot(mgr, "cc-desktop-viewport", false);
  const mh = await sideHrefs(mgr);
  record("Theme toggle is not shown on the light-only Lote 1B screens (language toggle kept)", (await mgr.locator('.fm-topbar button[aria-label*="tema" i], .fm-topbar button[aria-label*="theme" i]').count()) === 0 && (await mgr.locator(".fm-topbar").innerText()).length >= 0);
  record("Manager nav regression: Painel, Movimentações, Analytics, Frota, Configurações (+ rider items), no Equipe", MGR_NAV.every((h) => mh.includes(h)) && !mh.includes("/settings/users"), mh);
  record("CC: chat assistant, bell, theme/language toggles present", (await mgr.locator(".fm-chat button").count()) > 0 && (await mgr.locator('button[aria-label^="Notifica"]:visible').count()) > 0 && (await mgr.locator(".fm-topbar button").count()) >= 3);
  // mobile
  const mgrM = await newPage(U.mgr, M);
  await go(mgrM, "/dashboard");
  record("CC (mobile 390): no horizontal scroll, touch targets >= 44px, bottom nav (Painel, Movimentações, Frota, Reservas)", (await hscroll(mgrM)) <= 0 && (await smallTargets(mgrM)).length === 0, { h: await hscroll(mgrM), small: (await smallTargets(mgrM)).slice(0, 8) });
  const mb = await bottomHrefs(mgrM);
  record("CC (mobile): bottom nav lists the manager destinations", ["/dashboard", "/gate", "/fleet", "/trips"].every((h) => mb.includes(h)), mb);
  const wrapScroll = await mgrM.evaluate(() => { const w = document.querySelector(".cc-table-wrap"); return w ? w.scrollWidth > w.clientWidth : null; });
  record("CC (mobile): the wide reservations table scrolls inside its own card (not the page)", wrapScroll === true);
  await shot(mgrM, "cc-mobile", false);
  await shot(mgrM, "cc-mobile-full", true);
  await mgrM.context().close();

  // ---------------- manager actions (each one must still work)
  console.log("\n--- Command Center / actions ---");
  const pend = (label) => mgr.locator("#pending-approvals li", { hasText: label });
  const p2 = await pend("Campinas-P2-manut").innerText();
  record("CC: reservation on a maintenance vehicle shows 'Veículo indisponível' and no Aprovar", /Veículo indisponível/.test(p2) && (await pend("Campinas-P2-manut").locator('button:has-text("Aprovar")').count()) === 0);
  await act(mgr, () => pend("Santos-P1").locator('button:has-text("Aprovar")').click());
  record("CC: Aprovar works (DB confirmed)", (await st(P1.id)) === "confirmed", await st(P1.id));
  await go(mgr, "/dashboard");
  await pend("Itu-OV-sobreposta").locator('input[name="reason"]').fill("Motivo teste LB");
  await act(mgr, () => pend("Itu-OV-sobreposta").locator('button:has-text("Rejeitar")').click());
  record("CC: Rejeitar with a reason works (DB cancelled)", (await st(OV.id)) === "cancelled", await st(OV.id));
  await go(mgr, "/dashboard");
  const row = (label) => mgr.locator(".cc-table-wrap tbody tr", { hasText: label });
  await row("SaoPaulo-C1-saida").locator('button:has-text("Trocar")').click();
  const swapSel = row("SaoPaulo-C1-saida").locator('select[name="vehicleId"]');
  await swapSel.selectOption({ index: 1 });
  const vBefore = (await sql(`select vehicle_id v from reservations where id='${C1.id}'`))[0].v;
  await act(mgr, () => row("SaoPaulo-C1-saida").locator('form button:has-text("Trocar")').click());
  const vAfter = (await sql(`select vehicle_id v from reservations where id='${C1.id}'`))[0].v;
  record("CC: Trocar veículo works (reservation moved to another vehicle)", vAfter !== vBefore, { vBefore, vAfter });
  await go(mgr, "/dashboard");
  await row("Jundiai-C2-aguarda").locator('button:has-text("Transferir")').click();
  await row("Jundiai-C2-aguarda").locator('select[name="requesterId"]').selectOption({ label: U.emp3.fullName });
  await act(mgr, () => row("Jundiai-C2-aguarda").locator('form button:has-text("Transferir")').click());
  const owner = (await sql(`select requester_id r from trip_requests where id='${C2.t}'`))[0].r;
  record("CC: Transferir reserva works (requester changed)", owner === U.emp3.id, owner);
  await go(mgr, "/dashboard");
  // INTENDED rule (migration 0050): a confirmed reservation whose vehicle is already in use / returning cannot be cancelled by the manager
  await act(mgr, () => row("Atibaia-C4-retorno").locator('button:has-text("Cancelar")').click());
  const errBanner = mgr.locator('[role="alert"].cc-banner');
  await errBanner.first().waitFor({ timeout: 15000 }).catch(() => {});
  record("CC: cancelling a reservation whose vehicle is returning shows the error banner and leaves the reservation confirmed (rule from migration 0050)", (await errBanner.count()) >= 1 && /Não foi possível|erro|falh/i.test(await errBanner.first().innerText()) && (await st(C4.id)) === "confirmed", { n: await errBanner.count(), banner: await errBanner.first().innerText().catch(() => null), status: await st(C4.id) });
  await shot(mgr, "cc-cancel-blocked-error", false);
  await go(mgr, "/dashboard");
  await act(mgr, () => row("Santos-P1").locator('button:has-text("Cancelar")').click());
  record("CC: Cancelar reserva works (DB cancelled)", (await st(P1.id)) === "cancelled", await st(P1.id));
  await go(mgr, "/dashboard");
  const card = mgr.locator(`#vehicle-${vAvail[0].id}`);
  const blockBtn = card.locator('button:has-text("Bloquear")');
  record("CC: Bloquear stays disabled until a reason is typed", await blockBtn.isDisabled());
  await card.locator('input[name="reason"]').fill("Pneu furado LB");
  await act(mgr, () => blockBtn.click());
  record("CC: Bloquear veículo works (DB blocked)", (await sql(`select status from vehicles where id='${vAvail[0].id}'`))[0].status === "blocked");
  await go(mgr, "/dashboard");
  await act(mgr, () => mgr.locator(`#vehicle-${vAvail[0].id} button:has-text("Desbloquear")`).click());
  record("CC: Desbloquear veículo works (no longer blocked; back to its pre-block status)", (await sql(`select status from vehicles where id='${vAvail[0].id}'`))[0].status !== "blocked");
  await go(mgr, "/dashboard");
  const tk = (label) => mgr.locator("#open-tasks li", { hasText: label });
  await act(mgr, () => tk("Limpeza-LB-1").locator('button:has-text("Assumir")').click());
  record("CC: Assumir tarefa works (assigned to the manager)", (await sql(`select assigned_to a from workflow_tasks where id='${task1.id}'`))[0].a === U.mgr.id);
  await go(mgr, "/dashboard");
  await act(mgr, () => tk("Seguranca-LB-2").locator('button:has-text("Concluir")').click());
  record("CC: Concluir tarefa works (DB done)", (await sql(`select status s from workflow_tasks where id='${task2.id}'`))[0].s === "done");
  await go(mgr, "/dashboard");
  await act(mgr, () => tk("Reparo-LB-3").locator('button:has-text("Cancelar")').click());
  record("CC: Cancelar tarefa works (DB cancelled)", (await sql(`select status s from workflow_tasks where id='${task3.id}'`))[0].s === "cancelled");
  await go(mgr, "/dashboard?myTasks=1");
  record("CC: 'Minhas e disponíveis' filter link keeps working", (await mgr.locator('#open-tasks a[aria-current="true"]').innerText()).includes("Minhas") && (await mgr.locator("#open-tasks").count()) === 1);
  await go(mgr, "/dashboard");
  const ganttState = () => mgr.evaluate(() => { const g = document.querySelector(".cc-gantt"); const inner = g?.querySelector(".gantt-scroll > div"); return { label: [...(g?.querySelectorAll("span") ?? [])].map((x) => x.textContent).find((x) => /Semana|Mês|Trimestre/.test(x ?? "")), width: inner ? Math.round(inner.getBoundingClientRect().width) : 0, cols: g?.querySelectorAll(".gantt-scroll .absolute.border-l").length ?? 0 }; });
  const gz0 = await ganttState();
  await mgr.getByRole("button", { name: "Diminuir zoom" }).first().click();
  await mgr.waitForTimeout(2000);
  const gz1 = await ganttState();
  record("CC: Gantt zoom actually changes the grid (label and timeline width/columns differ after 'Diminuir zoom')", mgr.__errors.length === 0 && (gz0.label !== gz1.label || gz0.width !== gz1.width || gz0.cols !== gz1.cols), { before: gz0, after: gz1 });
  await mgr.getByRole("button", { name: "Aumentar zoom" }).first().click();
  await mgr.waitForTimeout(2000);
  const gz2 = await ganttState();
  record("CC: Gantt 'Aumentar zoom' goes back (grid differs from the zoomed-out state)", gz2.label !== gz1.label || gz2.width !== gz1.width || gz2.cols !== gz1.cols, { zoomedOut: gz1, back: gz2 });

  // ================================================================== FLEET
  console.log("\n--- Veículos / manager ---");
  await go(mgr, "/fleet");
  t = await text(mgr);
  record("Fleet: /fleet renders in .fm-theme; KPI total + status legend + propulsion tiles are real counts", (await hasFm(mgr)) && (await mgr.locator('[data-testid="fleet-kpi-total"] .fm-kpi-value').innerText()) === String(nVehicles) && (await mgr.locator('[data-testid="fleet-kpi-BEV"] .fm-kpi-value').innerText()) === "2" && (await mgr.locator('[data-testid="fleet-kpi-ICE"]').count()) === 1);
  record("Fleet: tabs Veículos/Categorias/Localizações with counts", /Veículos\s*\n?\s*13|Veículos\s+\d+/.test(t) && (await mgr.locator('[role="tab"]').count()) === 3);
  record("Fleet: vehicle cards (status, odometer, location) + Ver Agenda / Editar / Excluir", (await mgr.locator("ul > li", { hasText: "Ver Agenda" }).count()) === nVehicles && /Odômetro/.test(t) && /Ver Agenda/.test(t));
  record("Fleet: no invented elements (photos, driver, utilization %, map, costs)", !INVENTED.test(t) && !/Exportar|Motorista atual|Utilização \(/.test(t) && (await mgr.locator(".fm-theme iframe, .fm-theme canvas").count()) === 0);
  record("Fleet: no horizontal scroll, touch targets >= 44px, AA contrast", (await hscroll(mgr)) <= 0 && (await smallTargets(mgr)).length === 0 && (await lowContrast(mgr)).length === 0, { h: await hscroll(mgr), small: (await smallTargets(mgr)).slice(0, 8), low: (await lowContrast(mgr)).slice(0, 6) });
  await shot(mgr, "fleet-desktop", true);
  await mgr.fill('input[type="search"]', C3.v.plate);
  record("Fleet: plate search filters the cards", (await mgr.locator("ul > li", { hasText: "Ver Agenda" }).count()) === 1);
  await mgr.fill('input[type="search"]', "");
  await mgr.selectOption('select[aria-label="Status"]', "maintenance");
  record("Fleet: status filter works (1 vehicle in maintenance)", (await mgr.locator("ul > li", { hasText: "Ver Agenda" }).count()) === 1);
  await mgr.locator('button:has-text("Limpar")').click();
  record("Fleet: 'Limpar' restores the full list", (await mgr.locator("ul > li", { hasText: "Ver Agenda" }).count()) === nVehicles);
  await mgr.locator("li", { hasText: C3.v.plate }).first().locator('button:has-text("Editar")').click();
  record("Fleet: Editar opens the inline edit form (Salvar present) and closes again", (await mgr.locator('li:has(button:has-text("Fechar")) form').count()) >= 1);
  await mgr.locator('li:has(button:has-text("Fechar")) button:has-text("Fechar")').first().click();
  // categories + locations + add vehicle
  await mgr.getByRole("tab", { name: /Categorias/ }).click();
  await mgr.locator('button:has-text("Adicionar Categoria")').click();
  await mgr.fill('input[name="name"]:visible', "Categoria LB nova");
  await act(mgr, () => mgr.locator('form:has(input[name="passengerCapacity"]) button[type="submit"]').click());
  record("Fleet: add category works (DB row)", Number((await sql(`select count(*) c from vehicle_categories where organization_id='${O}' and name='Categoria LB nova'`))[0].c) === 1);
  await go(mgr, "/fleet");
  await mgr.getByRole("tab", { name: /Localiza/ }).click();
  await mgr.locator('button:has-text("Adicionar Localização")').click();
  await mgr.fill('form:has(input[name="name"]) input[name="name"]:visible', "Local LB novo");
  await act(mgr, () => mgr.locator('form:has(input[name="name"]):visible button[type="submit"]').first().click());
  record("Fleet: add location works (DB row)", Number((await sql(`select count(*) c from vehicle_locations where organization_id='${O}' and name='Local LB novo'`))[0].c) === 1);
  await go(mgr, "/fleet");
  await mgr.locator('button:has-text("Adicionar Veículo")').click();
  await mgr.fill('input[name="plate"]', "ZZB9X99");
  await mgr.selectOption('select[name="categoryId"]', { index: 1 });
  await mgr.fill('input[name="odometerKm"]', "321");
  const locSel = mgr.locator('select[name="locationId"]');
  if (await locSel.count()) await locSel.selectOption({ index: 1 });
  await act(mgr, () => mgr.locator('form:has(input[name="plate"]) button[type="submit"]').click());
  const newV = await sql(`select id from vehicles where organization_id='${O}' and plate='ZZB9X99'`);
  record("Fleet: add vehicle works (DB row)", newV.length === 1, newV);
  if (newV.length === 1) {
    await go(mgr, "/fleet");
    await act(mgr, () => mgr.locator("li", { hasText: "ZZB9X99" }).first().locator('button:has-text("Excluir")').click());
    record("Fleet: Excluir vehicle works (row gone)", (await sql(`select id from vehicles where id='${newV[0].id}'`)).length === 0);
  }
  // detail
  await go(mgr, `/fleet/vehicles/${C3.v.id}`);
  t = await text(mgr);
  record("Vehicle detail: head with real data (plate, category, odometer, location), status badge, real schedule bar", (await mgr.locator('[data-testid="vehicle-detail-head"]').count()) === 1 && t.includes(C3.v.plate) && /odômetro/i.test(t) && /Sede LB/.test(t) && /Sorocaba-C3-viagem/.test(t));
  record("Vehicle detail: no horizontal scroll, touch targets, contrast", (await hscroll(mgr)) <= 0 && (await smallTargets(mgr)).length === 0 && (await lowContrast(mgr)).length === 0, { small: await smallTargets(mgr), low: (await lowContrast(mgr)).slice(0, 6) });
  await shot(mgr, "vehicle-detail-desktop", true);
  await Promise.all([mgr.waitForURL((u) => u.pathname === "/fleet", { timeout: 30000 }).catch(() => {}), mgr.locator(".fm-ops-actions a").first().click()]);
  await mgr.waitForTimeout(800);
  record("Vehicle detail: back button returns to /fleet", path_(mgr) === "/fleet");
  const mgrM2 = await newPage(U.mgr, M);
  await go(mgrM2, "/fleet");
  record("Fleet (mobile): no horizontal scroll, touch targets >= 44px", (await hscroll(mgrM2)) <= 0 && (await smallTargets(mgrM2)).length === 0, { h: await hscroll(mgrM2), small: (await smallTargets(mgrM2)).slice(0, 8) });
  await shot(mgrM2, "fleet-mobile", false);
  await go(mgrM2, `/fleet/vehicles/${C3.v.id}`);
  record("Vehicle detail (mobile): no horizontal scroll, touch targets >= 44px", (await hscroll(mgrM2)) <= 0 && (await smallTargets(mgrM2)).length === 0, { h: await hscroll(mgrM2), small: await smallTargets(mgrM2) });
  await shot(mgrM2, "vehicle-detail-mobile", false);

  // ================================================================== REPORTS + CARPOOL (manager)
  console.log("\n--- Relatórios / Caronas ---");
  await go(mgr, "/analytics");
  t = await text(mgr);
  const rk = async (id) => (await mgr.locator(`[data-testid="${id}"] .fm-kpi-value`).innerText()).trim();
  record("Reports: real numbers only (1 completed trip, 120 km average, underused vehicles, carpool 0%)", (await rk("reports-kpi-trips")) === "1" && /120/.test(await rk("reports-kpi-avgkm")) && Number(await rk("reports-kpi-underused")) >= 1 && (await rk("reports-kpi-carpool")) === "0%", { trips: await rk("reports-kpi-trips"), avg: await rk("reports-kpi-avgkm") });
  record("Reports: cost / savings / sustainability omitted with an explicit 'não são exibidos' note; no invented charts", /não são exibidos/.test(t) && !INVENTED.test(t) && !/Custo total|Custo por km/.test(t) && (await mgr.locator(".fm-theme canvas, .fm-theme iframe").count()) === 0);
  record("Reports: all legacy sections kept (subutilizados, manutenção preditiva, utilização, km por viagem, destinos, carpooling)", ["Veículos Subutilizados", "Manutenção Preditiva", "Utilização por Veículo", "Km por Viagem", "Destinos Mais Frequentes", "Potencial de Carpooling"].every((h) => t.includes(h)));
  record("Reports: link to carpool indicators kept (data-testid carpool-kpi-link)", (await mgr.locator('[data-testid="carpool-kpi-link"]').getAttribute("href")) === "/analytics/carpool");
  record("Reports (desktop): no horizontal scroll, touch targets >= 44px, AA contrast, no seconds", (await hscroll(mgr)) <= 0 && (await smallTargets(mgr)).length === 0 && (await lowContrast(mgr)).length === 0 && !SECONDS.test(t), { small: (await smallTargets(mgr)).slice(0, 6), low: (await lowContrast(mgr)).slice(0, 6) });
  await shot(mgr, "reports-desktop", true);
  await go(mgrM2, "/analytics");
  record("Reports (mobile): no horizontal scroll, touch targets >= 44px", (await hscroll(mgrM2)) <= 0 && (await smallTargets(mgrM2)).length === 0, { h: await hscroll(mgrM2), small: (await smallTargets(mgrM2)).slice(0, 6) });
  await shot(mgrM2, "reports-mobile", false);
  await mgr.locator('[data-testid="carpool-kpi-link"]').click();
  await mgr.waitForTimeout(2000);
  t = await text(mgr);
  record("Carpool (manager): /analytics/carpool opens from the link, in .fm-theme, KPI testids render", path_(mgr) === "/analytics/carpool" && (await hasFm(mgr)) && (await mgr.locator('[data-testid="carpool-kpi-page"]').count()) === 1 && (await mgr.locator('[data-testid^="kpi-"]').count()) >= 20);
  record("Carpool (manager): empty org shows zeros / dashes, not invented figures", (await mgr.locator('[data-testid="kpi-requests-total"] [data-value]').getAttribute("data-value")) === "0" && !INVENTED.test(t));
  await mgr.click('[data-testid="kpi-range-90"]');
  await mgr.waitForTimeout(2000);
  record("Carpool (manager): 7/30/90 range filter works", new URL(mgr.url()).searchParams.get("range") === "90" && (await mgr.locator('[data-testid="kpi-range-90"]').getAttribute("aria-current")) === "true");
  record("Carpool (manager): no horizontal scroll, touch targets, AA contrast", (await hscroll(mgr)) <= 0 && (await smallTargets(mgr)).length === 0 && (await lowContrast(mgr)).length === 0, { small: (await smallTargets(mgr)).slice(0, 6), low: (await lowContrast(mgr)).slice(0, 6) });
  await shot(mgr, "carpool-mgr-desktop", true);
  await go(mgrM2, "/analytics/carpool");
  record("Carpool (mobile): no horizontal scroll, touch targets", (await hscroll(mgrM2)) <= 0 && (await smallTargets(mgrM2)).length === 0, { h: await hscroll(mgrM2), small: (await smallTargets(mgrM2)).slice(0, 6) });
  await shot(mgrM2, "carpool-mgr-mobile", false);
  await mgrM2.context().close();

  // ================================================================== SETTINGS (manager) + USERS (admin)
  console.log("\n--- Políticas / Usuários ---");
  await go(mgr, "/settings");
  t = await text(mgr);
  record("Settings: renders in .fm-theme with every real parameter (autonomia, recarga, abastecimento, limpeza, tolerâncias, modo de reserva, revisão, retirada antecipada, checklist, assistente, política de carona)", (await hasFm(mgr)) && ["Margem de segurança de autonomia", "Horas mín. de recarga", "Tolerância de saída", "Modo de Reserva", "Janela de revisão", "Retirada Antecipada", "Itens do Checklist", "Uso do Assistente", "Política de carona", "Pontos de Mobilidade"].every((x) => t.includes(x)), t.slice(0, 200));
  record("Settings: summary tiles show the real values (20%, v1, 2 checklist items)", (await mgr.locator('[data-testid="settings-summary"]').innerText()).includes("20%") && (await mgr.locator('[data-testid="settings-summary"]').innerText()).includes("v1"));
  record("Settings: no invented 'unidades' / map / KPIs of other products", !/Unidades|Integrações|142 veículos|LPR/.test(t) && !INVENTED.test(t));
  record("Settings (desktop): no horizontal scroll, touch targets >= 44px, AA contrast, no seconds", (await hscroll(mgr)) <= 0 && (await smallTargets(mgr)).length === 0 && (await lowContrast(mgr)).length === 0 && !SECONDS.test(t), { small: (await smallTargets(mgr)).slice(0, 8), low: (await lowContrast(mgr)).slice(0, 6) });
  await shot(mgr, "settings-desktop", true);
  await mgr.fill('input[name="rangeSafetyBufferPercent"]', "25");
  await act(mgr, () => mgr.locator('button:has-text("Salvar Configurações")').click());
  record("Settings: saving the organization parameters works (DB 25)", Number((await sql(`select range_safety_buffer_percent v from organization_settings where organization_id='${O}'`))[0].v) === 25);
  await go(mgr, "/settings");
  await mgr.fill('[data-testid="carpool-policy-section"] input[name="departureWindowMinutes"]', "20");
  await act(mgr, () => mgr.locator('[data-testid="carpool-policy-section"] button:has-text("Publicar nova versão")').click());
  record("Settings: publishing a new carpool policy version works (v2 in DB)", Number((await sql(`select max(policy_version) v from carpool_policy_settings where organization_id='${O}'`))[0].v) === 2 && (await mgr.locator('[data-testid="carpool-policy-saved"]').count()) === 1);
  await mgr.fill('input[name="name"][placeholder*="Extintor"]', "Item LB novo");
  await act(mgr, () => mgr.locator('button:has-text("Adicionar Item")').click());
  record("Settings: adding a checklist item works (DB)", Number((await sql(`select count(*) c from safety_equipment_items where organization_id='${O}' and name='Item LB novo'`))[0].c) === 1);
  await go(mgr, "/settings");
  await act(mgr, () => mgr.locator("li", { hasText: "Item LB novo" }).locator('button:has-text("Remover")').click());
  record("Settings: removing a checklist item works (DB)", Number((await sql(`select count(*) c from safety_equipment_items where organization_id='${O}' and name='Item LB novo'`))[0].c) === 0);
  await mgr.getByRole("link", { name: /Pontos de Mobilidade/ }).click();
  await mgr.waitForTimeout(2000);
  record("Mobility points: opens from /settings, in .fm-theme, has a single h1 page title, no horizontal scroll", path_(mgr) === "/settings/mobility-points" && (await hasFm(mgr)) && (await mgr.locator("h1").count()) === 1 && /Pontos de Mobilidade/.test(await mgr.locator("h1").innerText()) && (await hscroll(mgr)) <= 0);
  await shot(mgr, "mobility-points-desktop", true);
  await go(mgr, "/settings/users");
  record("Manager cannot open /settings/users (administrator only; redirected to /settings)", path_(mgr) === "/settings", path_(mgr));
  await mgr.context().close();

  await go(adm, "/settings/users");
  t = await text(adm);
  record("Users: /settings/users renders in .fm-theme with the SCR-ADM-002 title and the real member table", (await hasFm(adm)) && /Usuários, Perfis e Permissões/.test(t) && (await adm.locator("tbody tr").count()) === 7);
  record("Users: summary tiles are real (7 users, 7 authorized drivers, 0 without CNH, roles distribution)", (await adm.locator('[data-testid="users-kpi-total"] .fm-kpi-value').innerText()) === "7" && (await adm.locator('[data-testid="users-kpi-authorized"] .fm-kpi-value').innerText()) === "7" && /Colaborador\s*3/.test(await adm.locator('[data-testid="users-kpi-roles"]').innerText()));
  record("Users: no invented columns (último acesso, unidades, matriz de permissões, bloqueado)", !/Último acesso|Unidades de acesso|Matriz|Bloqueado temporário/i.test(t) && !INVENTED.test(t));
  const ah = await sideHrefs(adm);
  record("Administrator nav includes Equipe (/settings/users) + all manager items", [...MGR_NAV, "/settings/users"].every((h) => ah.includes(h)), ah);
  record("Users (desktop): no horizontal scroll, touch targets >= 44px, AA contrast, no JS errors", (await hscroll(adm)) <= 0 && (await smallTargets(adm)).length === 0 && (await lowContrast(adm)).length === 0 && adm.__errors.length === 0, { h: await hscroll(adm), small: (await smallTargets(adm)).slice(0, 8), low: (await lowContrast(adm)).slice(0, 6), err: adm.__errors });
  const clipped = await adm.evaluate(() => { const w = document.querySelector(".us-wrap .overflow-x-auto"); const th = [...document.querySelectorAll(".us-wrap th")].map((x) => { const r = x.getBoundingClientRect(); const wr = w.getBoundingClientRect(); return r.right > wr.right + 1; }); const lab = [...document.querySelectorAll(".us-wrap td label")].map((l) => l.getBoundingClientRect().height); return { overflowing: w.scrollWidth > w.clientWidth, thClipped: th.some(Boolean), labelMaxH: Math.max(...lab) }; });
  record("Users (desktop 1440): 'Autorizado a dirigir' stays on one line and every column header is visible (no in-card scroll needed)", clipped.labelMaxH <= 48 && !clipped.thClipped && !clipped.overflowing, clipped);
  await shot(adm, "users-desktop", true);
  const urow = (name) => adm.locator("tbody tr", { hasText: name });
  record("Users: own row has the role select disabled and no 'Remover'", (await urow("lb adm").locator('select[name="role"]').isDisabled()) && (await urow("lb adm").locator('button:has-text("Remover")').count()) === 0);
  await urow("lb emp3").locator('select[name="role"]').selectOption("security");
  await adm.waitForTimeout(2500);
  record("Users: role change works (emp3 -> security in DB)", (await sql(`select role r from profiles where id='${U.emp3.id}'`))[0].r === "security");
  await urow("lb emp3").locator('select[name="role"]').selectOption("employee");
  await adm.waitForTimeout(2500);
  record("Users: role change back works", (await sql(`select role r from profiles where id='${U.emp3.id}'`))[0].r === "employee");
  await urow("lb emp3").locator('input[name="driverAuthorized"]').uncheck();
  await adm.waitForTimeout(2500);
  record("Users: driver authorization toggle works (DB false)", (await sql(`select driver_authorized d from profiles where id='${U.emp3.id}'`))[0].d === false);
  await urow("lb emp3").locator('input[name="licenseCategory"]').fill("D");
  await urow("lb emp3").locator('input[name="licenseCategory"]').blur();
  await adm.waitForTimeout(2500);
  record("Users: CNH category edit autosaves (DB D)", (await sql(`select drivers_license_category c from profiles where id='${U.emp3.id}'`))[0].c === "D");
  await adm.fill('input[type="search"]', "emp2");
  record("Users: member search filters the table", (await adm.locator("tbody tr").count()) === 1);
  await adm.fill('input[type="search"]', "");
  await adm.locator('button:has-text("Adicionar Usuário")').first().click();
  const dlg = adm.locator('[role="dialog"]');
  record("Users: invite dialog opens (dim overlay + white panel)", await dlg.isVisible());
  await shot(adm, "users-invite-dialog", false);
  const inviteEmail = `c5ui-lb-new-${T}@fleet-test.invalid`;
  await dlg.locator('input[name="fullName"]').fill("C5UI lb convidado");
  await dlg.locator('input[name="email"]').fill(inviteEmail);
  await dlg.locator('input[name="password"]').fill(PASSWORD);
  await dlg.locator('select[name="role"]').selectOption("employee");
  await act(adm, () => dlg.locator('button[type="submit"]').click());
  const invited = await sql(`select id from profiles where organization_id='${O}' and full_name='C5UI lb convidado'`);
  if (invited[0]) U.convidado = { id: invited[0].id, email: inviteEmail, fullName: "C5UI lb convidado" };
  record("Users: invite works (profile created in the org)", invited.length === 1, invited);
  await go(adm, "/settings/users");
  await act(adm, () => urow("lb convidado").locator('button:has-text("Remover")').click());
  record("Users: removing a user works (profile gone)", (await sql(`select id from profiles where full_name='C5UI lb convidado' and organization_id='${O}'`)).length === 0);
  if (U.convidado) delete U.convidado;
  const admM = await newPage(U.adm, M);
  await go(admM, "/settings/users");
  record("Users (mobile): no horizontal scroll (table scrolls inside its card), touch targets >= 44px", (await hscroll(admM)) <= 0 && (await smallTargets(admM)).length === 0, { h: await hscroll(admM), small: (await smallTargets(admM)).slice(0, 8) });
  await shot(admM, "users-mobile", false);
  await go(admM, "/settings");
  record("Settings (mobile): no horizontal scroll, touch targets >= 44px", (await hscroll(admM)) <= 0 && (await smallTargets(admM)).length === 0, { h: await hscroll(admM), small: (await smallTargets(admM)).slice(0, 8) });
  await shot(admM, "settings-mobile", false);
  await admM.context().close();

  // ================================================================== EMPTY STATES (second disposable org with no vehicles)
  console.log("\n--- Empty states ---");
  const B = await provisionOrg("lc", [["mgr", "fleet_manager"], ["sec", "security"]]);
  orgs.push(B);
  await sql(`delete from vehicles where organization_id='${B.orgId}'`);
  const mgrB = await newPage(B.users.mgr, D);
  for (const u of ALL_PAGES) await go(mgrB, u);
  await go(mgrB, "/dashboard");
  t = await text(mgrB);
  record("Empty org: /dashboard shows the empty vehicle text and zero KPIs, no errors", /Nenhum veículo|ainda não/i.test(t) && (await mgrB.locator('[data-testid="cc-kpi-vehicles"] .fm-kpi-value').innerText()) === "0" && !BAD.some((b) => t.toLowerCase().includes(b)));
  await shot(mgrB, "cc-empty-desktop", true);
  await go(mgrB, "/fleet");
  record("Empty org: /fleet shows the empty state with hint", (await mgrB.locator('[data-testid="fleet-kpi-total"] .fm-kpi-value').innerText()) === "0" && /Adicionar/.test(await text(mgrB)));
  await shot(mgrB, "fleet-empty-desktop", false);
  await go(mgrB, "/gate");
  record("Empty org: /gate shows the empty movements text", /Nenhuma movimentação em aberto/.test(await text(mgrB)));
  await shot(mgrB, "gate-empty-desktop", false);
  await go(mgrB, "/analytics");
  t = await text(mgrB);
  record("Empty org: /analytics shows 'sem dados' instead of KPI numbers / charts", /sem dados/.test(t) && (await hscroll(mgrB)) <= 0);
  await shot(mgrB, "reports-empty-desktop", false);
  await mgrB.context().close();

  // ================================================================== i18n + theme isolation
  console.log("\n--- i18n / theme ---");
  const loc = await newPage(U.sec, D);
  for (const [lc, rx] of [["en-US", /Gatehouse – Command Center/], ["es", /Portería – Command Center/], ["zh-CN", /门岗 – 指挥中心/]]) {
    await loc.context().addCookies([{ name: "fleet-locale", value: lc, url: BASE }]);
    await go(loc, "/gate");
    record(`i18n (${lc}): gate title/KPIs/tabs translated, no leftover Portuguese`, rx.test(await text(loc)) && !/Saídas pendentes|Buscar veículo pela placa|Pendentes\b/.test(await text(loc)), (await text(loc)).slice(0, 120));
    if (lc === "en-US") await shot(loc, "gate-en-us", false);
  }
  await loc.context().close();
  const mgrE = await newPage(U.mgr, D);
  await mgrE.context().addCookies([{ name: "fleet-locale", value: "en-US", url: BASE }]);
  for (const [u, rx] of [["/dashboard", /Pending approvals/], ["/fleet", /Total vehicles/], ["/analytics", /Reports and Utilization/], ["/settings", /Organization policies/]]) {
    await go(mgrE, u);
    record(`i18n (en-US) ${u}: new texts translated`, rx.test(await text(mgrE)));
  }
  await shot(mgrE, "settings-en-us", false);
  await go(mgrE, "/dashboard");
  await shot(mgrE, "cc-en-us", false);
  await mgrE.context().close();
  const dk = await newPage(U.mgr, D);
  await dk.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
  await go(dk, "/dashboard");
  await dk.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const bg = await dk.evaluate(() => getComputedStyle(document.querySelector('[data-testid="fm-theme"]')).backgroundColor);
  record("Theme: the FleetMind scope keeps its light surface even when the app theme is dark (no unreadable mix)", bg === "rgb(244, 247, 251)", bg);
  await dk.context().close();
  // scoping: other screens untouched (account pages keep the legacy shell, no .fm-theme)
  const empS = await newPage(U.emp2, D);
  await go(empS, "/account/profile");
  record("Scoping: /account/profile still uses the legacy shell (no .fm-theme leaked)", (await empS.locator('[data-testid="fm-theme"]').count()) === 0);
  await empS.context().close();
} catch (e) {
  record("FATAL", false, String(e && e.stack ? e.stack : e));
} finally {
  await browser.close().catch(() => {});
  await cleanupOrgs(orgs);
  const extra = orgs.length
    ? await sql(`select (select count(*) from inspections where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) inspections,
      (select count(*) from safety_equipment_items where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) equipment,
      (select count(*) from vehicle_locations where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) locations,
      (select count(*) from vehicle_categories where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) categories,
      (select count(*) from workflow_tasks where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) tasks,
      (select count(*) from reservations where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) reservations`).catch((e) => [{ error: String(e) }])
    : [];
  record("Cleanup (extra tables): inspections / equipment / locations / categories / tasks / reservations are zero", extra.length > 0 && Object.values(extra[0]).every((v) => Number(v) === 0), extra[0]);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) console.log("FAILED:\n" + failed.map((r) => " - " + r.name).join("\n"));
  process.exit(failed.length ? 1 : 0);
}
