// Lote 1A: Home (SCR-USR-001, employee /dashboard), Minhas Reservas e Viagens (SCR-USR-004, /trips),
// Checklists (SCR-USR-005, pickup/return) and the employee reservation detail, in the FleetMind v2.0 look.
// Real-browser walk-through (Playwright; live Supabase through `next start` on BASE_URL), disposable org via the
// carpool-c5-lib helpers, removed in `finally`; the cleanup query must report zero rows.
// Screenshots -> resultado_de_testes/design-v2/implemented-lote1a/ (mobile = viewport only)
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASE, PASSWORD, T, record, results, sql, provisionOrg, cleanupOrgs, ROOT, SVC, URL_ } from "./carpool-c5-lib.mjs";

const OUT = path.join(ROOT, "resultado_de_testes", "design-v2", "implemented-lote1a");
mkdirSync(OUT, { recursive: true });
const ASSET = path.join(ROOT, "testing", "live-demo", "assets", "car-damage.jpg");
const WEB = path.join(ROOT, "apps", "web", "app");

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
  page.on("pageerror", (e) => page.__errors.push(new URL(page.url()).pathname + " " + String(e).slice(0, 160)));
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
      await page.waitForTimeout(400);
      return;
    } catch (e) {
      if (i === 1) throw e;
    }
  }
}
async function submitToTrips(page, timeout = 60000) {
  try {
    await Promise.all([page.waitForURL((u) => u.pathname === "/trips", { timeout }), page.click('.ck-form button[type="submit"]')]);
  } catch (e) {
    console.log("    [submit did not reach /trips] url=" + page.url() + " alert=" + (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(" | "));
    console.log("    [db] inspections=" + JSON.stringify(await sql(`select reservation_id, has_new_damage from inspections where organization_id='${globalThis.__O}'`).catch(() => null)) + " photos=" + JSON.stringify(await sql(`select angle, storage_path from inspection_photos where organization_id='${globalThis.__O}'`).catch((e) => String(e).slice(0, 200))));
    throw e;
  }
}
const text = (page) => page.evaluate(() => document.body.innerText);
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const hasFm = (page) => page.locator('[data-testid="fm-theme"]').count().then((n) => n === 1);
const sideHrefs = (page) => page.$$eval(".fm-sidebar .fm-nav a", (as) => as.map((a) => a.getAttribute("href")));
const bottomHrefs = (page) => page.$$eval(".fm-bottom-nav a", (as) => as.map((a) => a.getAttribute("href")));
const legacyHrefs = (page) => page.$$eval("aside a, nav a", (as) => as.map((a) => a.getAttribute("href")));
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".fm-theme a, .fm-theme button, .fm-theme input, .fm-theme select, .fm-theme textarea, .fm-theme summary")]
      .filter((e) => {
        if (e.closest(".fm-sr-only") || e.closest(".fm-chat") || e.closest(".tp-gantt") || e.type === "hidden") return false;
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        if (e.closest('[style*="display: none"]')) return false;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        // inline link inside running text / hidden file inputs do not count; checkbox/radio: the label is the target
        if (e.type === "file" || e.classList.contains("sr-only")) return false;
        const box = e.type === "radio" || e.type === "checkbox" ? (e.closest("label") ?? e).getBoundingClientRect() : r;
        return box.height < 43.5 || box.width < 43.5;
      })
      .map((e) => (e.getAttribute("aria-label") || e.getAttribute("name") || e.textContent || e.tagName).trim().slice(0, 30) + ":" + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)),
  );
const lum = (rgb) => {
  const [r, g, b] = rgb.match(/[0-9]+(?:[.][0-9]+)?/g).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Contrast of the visible text of the given selectors against the nearest opaque background. */
async function contrast(page, selectors) {
  const rows = await page.evaluate((sels) => {
    const out = [];
    for (const sel of sels) {
      for (const el of [...document.querySelectorAll(sel)].slice(0, 4)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || !el.textContent.trim()) continue;
        let bg = el;
        let color = "rgba(0, 0, 0, 0)";
        while (bg) {
          color = getComputedStyle(bg).backgroundColor;
          if (!/rgba?\(.*,\s*0\)$/.test(color) && color !== "transparent") break;
          bg = bg.parentElement;
        }
        out.push({ sel, fg: getComputedStyle(el).color, bg: color });
      }
    }
    return out;
  }, selectors);
  return rows.map((x) => ({ sel: x.sel, ratio: (Math.max(lum(x.fg), lum(x.bg)) + 0.05) / (Math.min(lum(x.fg), lum(x.bg)) + 0.05) })).filter((x) => x.ratio < 4.5).map((x) => x.sel + ":" + x.ratio.toFixed(2));
}
const INVENTED = /match\s?\d|★|co₂|co2|rating|avalia(ç|c)ão|\d+,\d\s?t\b|árvores|uso recente/i;
const BAD = ["application error", "something went wrong", "unhandled runtime", "internal server error", "permission denied"];

try {
  // ------------------------------------------------------------------ static: every selector scoped
  for (const f of ["apps/web/app/dashboard/home.css", "apps/web/app/trips/trips.css", "apps/web/app/reservations/[id]/checklist.css", "apps/web/app/carpool/fm-shared.css"]) {
    const css = readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/(?:^|})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter(Boolean).filter((s) => !/^(to|from|[0-9.]+%)$/.test(s));
    const unscoped = selectors.filter((s) => s.split(",").some((p) => !p.trim().startsWith(".fm-theme")));
    record(`${f}: every selector is scoped under .fm-theme`, unscoped.length === 0, unscoped.slice(0, 5));
  }

  // ------------------------------------------------------------------ data
  const A = await provisionOrg("la", [
    ["emp", "employee"], ["emp0", "employee"], ["host", "employee"], ["empP", "employee"], ["empA", "employee"], ["empR", "employee"], ["empX", "employee"],
    ["mgr", "fleet_manager"], ["adm", "administrator"], ["sec", "security"], ["mnt", "maintenance_operator"],
  ]);
  orgs.push(A);
  const U = A.users;
  const O = A.orgId;
  globalThis.__O = O;
  console.log(`\n=== Lote 1A walkthrough (${BASE}) org=${O} ===\n`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${O}', 1, 15, 15, 5, 15, 30)`);
  await sql(`insert into safety_equipment_items (organization_id, name) values ('${O}','Triangulo-LA'),('${O}','Extintor-LA')`);
  await sql(`update profiles set driver_authorized=true where organization_id='${O}' and id <> '${U.empX.id}'`);
  const cats = {};
  cats.ICE = (await sql(`select id from vehicle_categories where organization_id='${O}'`))[0].id;
  for (const e of ["HEV", "PHEV", "BEV"]) cats[e] = (await sql(`insert into vehicle_categories (organization_id, name, passenger_capacity, energy_type) values ('${O}', 'LA ${e}', 5, '${e}') returning id`))[0].id;
  let vn = 10;
  const veh = async (energy, status = "available", odo = 1000) => {
    vn += 1;
    const fuel = energy === "BEV" ? "null" : "70";
    const batt = energy === "BEV" || energy === "PHEV" ? "60" : "null";
    return (await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, battery_level_percent, estimated_range_km, next_service_odometer_km, name)
      values ('${O}','LA${vn}${T.slice(-3).toUpperCase()}','${cats[energy]}','${status}',${odo},${fuel},${batt},400,20000,'Carro ${energy} ${vn}') returning id, plate`))[0];
  };
  const trip = async (who, origin, dest, startExpr, endExpr) =>
    (await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${O}','${U[who].id}',${startExpr},${endExpr},'${origin}','${dest}',20,1,'LA teste') returning id`))[0].id;
  const resv = async (v, t, status, startExpr, endExpr) =>
    (await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${O}','${v.id}','${t}','${status}',${startExpr},${endExpr}) returning id`))[0].id;
  const NOW_START = "now() - interval '1 hour'";
  const NOW_END = "now() + interval '6 hours'";
  const mk = async (who, energy, vstatus, rstatus, label, startExpr = NOW_START, endExpr = NOW_END) => {
    const v = await veh(energy, vstatus);
    const t = await trip(who, "Valinhos", label, startExpr, endExpr);
    const id = await resv(v, t, rstatus, startExpr, endExpr);
    return { v, t, id };
  };
  // emp: next reservation (pickup-ready ICE) + history
  const R1 = await mk("emp", "ICE", "reserved", "confirmed", "Sao-Paulo-R1");
  const vHist = R1.v;
  const tDone = await trip("emp", "Valinhos", "Iracemapolis-Done", "now() - interval '5 days'", "now() - interval '5 days' + interval '4 hours'");
  await resv(vHist, tDone, "completed", "now() - interval '5 days'", "now() - interval '5 days' + interval '4 hours'");
  const tCanc = await trip("emp", "Valinhos", "Campinas-Cancelada", "now() - interval '3 days'", "now() - interval '3 days' + interval '4 hours'");
  await resv(vHist, tCanc, "cancelled", "now() - interval '3 days'", "now() - interval '3 days' + interval '4 hours'");
  const RPEND = await mk("emp", "ICE", "available", "pending_approval", "Santos-Pendente", "now() + interval '2 days'", "now() + interval '2 days' + interval '5 hours'");
  const RHEV = await mk("emp", "HEV", "reserved", "confirmed", "HEV-pickup");
  const RPHEV = await mk("emp", "PHEV", "reserved", "confirmed", "PHEV-pickup");
  const RBEV = await mk("emp", "BEV", "reserved", "confirmed", "BEV-pickup-dano");
  const RBEVu = await mk("emp", "BEV", "in_use", "confirmed", "BEV-return");
  const RHEVu = await mk("emp", "HEV", "in_use", "confirmed", "HEV-return");
  const RPHEVu = await mk("emp", "PHEV", "in_use", "confirmed", "PHEV-return");
  const RACTIVE = RBEVu;
  // host with an offer + requests (pending / accepted / rejected) by distinct riders
  const H = await mk("host", "ICE", "reserved", "confirmed", "Campinas-Host", "now() + interval '1 day'", "now() + interval '1 day' + interval '8 hours'");
  const [offer] = await sql(`insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) values ('${O}','${H.t}','${U.host.id}','active',3,2,1) returning id`);
  const loc = (l) => `'${JSON.stringify({ label: l, coordinates: { lat: -23.5, lng: -46.6 } })}'::jsonb`;
  const rr = async (who, st, reason) =>
    sql(`insert into carpool_ride_requests (organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location, requested_departure_at, status, status_reason, policy_version, match_additional_distance_km, match_additional_time_min) values ('${O}','${offer.id}','${U[who].id}',1,${loc("Av. Paulista, 1000")},${loc("Av. Brigadeiro, 77")},now() + interval '1 day','${st}',${reason ? `'${reason}'` : "null"},1,1.4,3)`);
  await rr("empP", "PENDING");
  await rr("empA", "ACCEPTED");
  await sql(`insert into trip_participants (organization_id, trip_request_id, passenger_id, passenger_count, status) values ('${O}','${H.t}','${U.empA.id}',1,'accepted')`);
  await rr("empR", "REJECTED", "Sem espaco para bagagem");
  await sql(`insert into reservation_messages (organization_id, reservation_id, sender_id, message_type, body) values ('${O}','${R1.id}','${U.emp.id}','text','MSG-LA-1')`);

  // ------------------------------------------------------------------ warm up (cold compile) with the main employee
  let emp = await newPage(U.emp, D);
  for (const u of ["/dashboard", "/trips", `/reservations/${R1.id}`, `/reservations/${R1.id}/pickup`, `/reservations/${RACTIVE.id}/return`, "/carpool", "/trips/new"]) await go(emp, u);

  // ================================================================== HOME (desktop)
  console.log("\n--- Home / desktop ---");
  await go(emp, "/dashboard");
  record("Home: employee /dashboard renders inside .fm-theme", await hasFm(emp) && (await emp.locator('[data-testid="employee-home"]').count()) === 1);
  let t = await text(emp);
  record("Home: greeting with the real first name + sub line", /Olá, C5UI!/.test(t) && /Para onde você quer ir hoje\?/.test(t), t.split("\n").slice(0, 8).join(" | "));
  const quick = await emp.$$eval('[data-testid="home-quick-actions"] a', (as) => as.map((a) => a.getAttribute("href")));
  record("Home: quick actions = Reservar (/trips/new), Buscar Carona (/carpool), Minhas Reservas (/trips)", JSON.stringify(quick) === JSON.stringify(["/trips/new", "/carpool", "/trips"]), quick);
  const nextDesk = emp.locator('[data-testid="home-next-reservation"]');
  const nextTxt = await nextDesk.innerText();
  record("Home: next reservation card shows the real vehicle plate, route and status", nextTxt.includes(R1.v.plate) && /Sao-Paulo-R1/.test(nextTxt) && /Aprovada/.test(nextTxt), nextTxt.replace(/\n/g, " | "));
  const nextHrefs = await nextDesk.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  record("Home: next reservation actions = details + Iniciar checklist (pickup) only", nextHrefs.includes(`/reservations/${R1.id}`) && nextHrefs.includes(`/reservations/${R1.id}/pickup`) && !nextHrefs.some((h) => h.endsWith("/return")), nextHrefs);
  record("Home: dates have no seconds", !/d{2}:d{2}:d{2}/.test(nextTxt), nextTxt.slice(0, 80));
  globalThis.__pickupLabel = (await nextDesk.locator('a[href$="/pickup"]').innerText()).trim();
  record("Home: 'Veículos mais reservados' is a real count (the vehicle with 2 own reservations is listed)", /Veículos mais reservados por você/.test(t) && (await emp.locator('[data-testid="home-used-vehicles"]').innerText()).includes(vHist.plate), "");
  record("Home: fleet vehicle cards kept (energy / odometer / location)", (await emp.locator('[data-testid="home-vehicle"]').count()) >= 5 && /combustível/i.test(t) && /bateria/i.test(t) && /odômetro/i.test(t));
  record("Home: attention list kept", /Precisa de Atenção/.test(t));
  record("Home: no invented elements (match %, rating, CO2, map, driver photo, voice card)", !INVENTED.test(t) && (await emp.locator(".fm-theme img, .fm-theme iframe, .fm-theme canvas").count()) === 0 && (await emp.locator('[data-testid="fm-assistant-panel"]').count()) === 1, t.match(INVENTED)?.[0]);
  // "Reservar igual" (art06): the sidebar "Falar com o FleetMind" panel is now a real, intentional element on every FmShell page
  // (its mic and example phrases open the existing chat assistant); it replaces the old "no voice card" assertion.
  record("Home: no unexpected error text", !BAD.some((b) => t.toLowerCase().includes(b)) && emp.__errors.length === 0, emp.__errors);
  const sh = await sideHrefs(emp);
  record("Home: employee sidebar = Início, Buscar Carona, Reservar, Minhas Reservas (no manager items); CTA present", ["/dashboard", "/carpool", "/trips/new", "/trips"].every((h) => sh.includes(h)) && !sh.some((h) => ["/gate", "/analytics", "/fleet", "/settings", "/settings/users"].includes(h)) && (await emp.locator(".fm-sidebar a.fm-cta").count()) === 1, sh);
  record("Home: shell widgets (chat button, bell, theme + language toggles, user menu) present", (await emp.locator('button[aria-label="Assistente Fleet"]').count()) === 1 && (await emp.locator('button[aria-label^="Notificações"], button[aria-label="Falta de upload da CNH"]').count()) >= 1 && (await emp.locator('.fm-topbar button[aria-label*="Tema"], .fm-topbar button[aria-label*="tema"]').count()) >= 1 && (await emp.locator(".fm-topbar-right button").count()) >= 4);
  await shot(emp, "home-desktop", true);
  await emp.click('button[aria-label="Assistente Fleet"]');
  await emp.waitForTimeout(800);
  record("Home: chat assistant opens", (await emp.locator('[role="dialog"]').count()) >= 1);
  await emp.keyboard.press("Escape");
  record("Home: desktop has no horizontal scroll", (await hscroll(emp)) <= 0, await hscroll(emp));
  const st1 = await smallTargets(emp);
  record("Home: desktop touch targets >= 44px", st1.length === 0, st1.slice(0, 8));
  const cr1 = await contrast(emp, [".fm-subtitle", ".hm-muted", ".hm-plate", ".fm-pill", ".hm-action-text small", ".hm-action-text strong", ".hm-link", ".fm-chip", ".hm-vehicle-data dt", ".fm-nav a", ".hm-alert"]);
  record("Home: text contrast >= 4.5:1 on the sampled elements", cr1.length === 0, cr1);

  // focus ring is visible on keyboard focus
  await emp.keyboard.press("Tab");
  await emp.focus(".hm-action");
  const outline = await emp.$eval(".hm-action", (e) => getComputedStyle(e).outlineStyle + " " + getComputedStyle(e).outlineWidth);
  record("Home: visible keyboard focus ring", /solid 3px/.test(outline), outline);

  // ================================================================== HOME (mobile)
  console.log("\n--- Home / mobile ---");
  const empM = await newPage(U.emp, M);
  await go(empM, "/dashboard");
  record("Home mobile: no horizontal scroll", (await hscroll(empM)) <= 0, await hscroll(empM));
  const bh = await bottomHrefs(empM);
  record("Home mobile: bottom nav visible (Início, Buscar Carona, Reservar, Reservas)", (await empM.locator(".fm-bottom-nav").isVisible()) && ["/dashboard", "/carpool", "/trips/new", "/trips"].every((h) => bh.includes(h)), bh);
  record("Home mobile: next reservation shown in the mobile slot, desktop aside hidden", (await empM.locator('[data-testid="home-next-reservation-mobile"]').isVisible()) && !(await empM.locator('[data-testid="home-next-reservation"]').isVisible()));
  const st2 = await smallTargets(empM);
  record("Home mobile: touch targets >= 44px", st2.length === 0, st2.slice(0, 8));
  const topbar = await empM.evaluate(() => { const b = document.querySelector(".fm-topbar"); const r = b.getBoundingClientRect(); return { h: Math.round(r.height), text: b.innerText.replace(/s+/g, " "), hasMobileNav: !!b.querySelector(".fm-mobilenav button[aria-expanded]"), legacyBrand: /FLEET./.test(document.body.innerText) }; });
  record("Home mobile: ONE-row FleetMind top bar (brand + toggles + bell + menu), no legacy 'FLEET.' toolbar", topbar.h <= 64 && /FleetMind/.test(topbar.text) && topbar.hasMobileNav && !topbar.legacyBrand, topbar);
  await empM.waitForFunction(() => { const b = [...document.querySelectorAll(".fm-mobilenav button[aria-expanded]")].pop(); return b && Object.keys(b).some((k) => k.startsWith("__reactProps")); }, null, { timeout: 60000 });
  await empM.locator(".fm-mobilenav button[aria-expanded]").last().click();
  await empM.waitForSelector(".fm-mobilepanel");
  const panel = await empM.evaluate(() => { const p = document.querySelector(".fm-mobilepanel"); const r = p.getBoundingClientRect(); return { top: Math.round(r.top), links: [...p.querySelectorAll("a")].map((a) => a.getAttribute("href")), small: [...p.querySelectorAll("a,button")].filter((e) => e.getBoundingClientRect().height < 43.5).length }; });
  record("Home mobile: hamburger panel opens under the bar with every nav link and 44px targets", panel.top >= 56 && ["/dashboard", "/carpool", "/trips/new", "/trips"].every((h) => panel.links.includes(h)) && panel.small === 0, panel);
  await shot(empM, "home-mobile-menu-open", false);
  await empM.locator(".fm-mobilenav button[aria-expanded]").last().click();
  const clear = async (page) => { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(300); return page.evaluate(() => { const last = document.querySelector(".fm-content").lastElementChild.getBoundingClientRect().bottom; const nav = document.querySelector(".fm-bottom-nav").getBoundingClientRect().top; const fab = document.querySelector(".fm-chat button.fixed")?.getBoundingClientRect().top ?? nav; return { last: Math.round(last), nav: Math.round(nav), fab: Math.round(fab) }; }); };
  const cl = await clear(empM);
  record("Home mobile: at the end of the page the last content sits above the bottom nav AND the chat button", cl.last <= Math.min(cl.nav, cl.fab), cl);
  await shot(empM, "home-mobile", false);
  await shot(empM, "home-mobile-full", true);

  // ---- i18n
  for (const [loc, rx] of [["en-US", /Hello, C5UI!/], ["es", /¡Hola, C5UI!/], ["zh-CN", /你好，C5UI！/]]) {
    await emp.context().addCookies([{ name: "fleet-locale", value: loc, url: BASE }]);
    await go(emp, "/dashboard");
    const tt = await text(emp);
    await go(emp, "/trips");
    const tt2 = await text(emp);
    record(`i18n ${loc}: Home greeting and /trips title are translated`, rx.test(tt) && !/Minhas Reservas e Viagens/.test(tt2), tt2.split("\n").slice(0, 3).join(" | "));
    if (loc === "en-US") await shot(emp, "home-en-us-trips", false);
  }
  await emp.context().addCookies([{ name: "fleet-locale", value: "pt-BR", url: BASE }]);

  // ================================================================== HOME empty + trips empty
  console.log("\n--- Empty states ---");
  const emp0 = await newPage(U.emp0, D);
  await go(emp0, "/dashboard");
  t = await text(emp0);
  record("Home empty: 'no upcoming reservation' + CTA to /trips/new; no used-vehicles / carpool blocks", /Você não tem nenhuma reserva futura\./.test(t) && (await emp0.locator('a.fm-btn[href="/trips/new"]').count()) >= 1 && (await emp0.locator('[data-testid="home-used-vehicles"], [data-testid="home-carpools"]').count()) === 0);
  await shot(emp0, "home-empty-desktop", true);
  await go(emp0, "/trips");
  t = await text(emp0);
  record("Trips empty: empty text + CTA, tabs all zero", (await emp0.locator('[data-testid="trips-empty"]').count()) === 1 && /\(0\)/.test(t));
  await shot(emp0, "trips-empty-desktop", true);

  // ================================================================== TRIPS (desktop)
  console.log("\n--- Trips / desktop ---");
  await go(emp, "/trips");
  record("Trips: /trips renders inside .fm-theme", await hasFm(emp));
  t = await text(emp);
  record("Trips: title + subtitle (art copy) and 'Nova reserva'", /Minhas Reservas e Viagens/.test(t) && /Gerencie suas reservas de veículos/.test(t) && (await emp.locator('a.tp-new[href="/trips/new"]').count()) === 1);
  const tabs = await emp.$$eval('[data-testid="trips-tabs"] a', (as) => as.map((a) => a.textContent.trim()));
  console.log("    tabs: " + JSON.stringify(tabs));
  // counts: upcoming = R1 (confirmed ready) + pending + HEV + PHEV + BEV (reserved) = 5 ; active = 3 in_use ; done 1 ; cancelled 1 ; carpools 0 ; all = 10
  record("Trips: tab counts are the real counts (all 10, upcoming 5, in progress 3, carpools 0, done 1, cancelled 1)", /Todas \(10\)/.test(tabs[0]) && /Próximas \(5\)/.test(tabs[1]) && /Em andamento \(3\)/.test(tabs[2]) && /Caronas \(0\)/.test(tabs[3]) && /Concluídas \(1\)/.test(tabs[4]) && /Canceladas \(1\)/.test(tabs[5]), tabs);
  record("Trips: sections upcoming / in progress / history + schedule (Gantt) all present on 'Todas'", (await emp.locator('[data-testid="trips-upcoming"]').count()) === 1 && (await emp.locator('[data-testid="trips-active"]').count()) === 1 && (await emp.locator('[data-testid="trips-history"]').count()) === 1 && (await emp.locator('[data-testid="trips-schedule"]').count()) === 1);
  record("Trips: 10 reservation cards", (await emp.locator('[data-testid="trip-card"]').count()) === 10, await emp.locator('[data-testid="trip-card"]').count());
  const startLinks = await emp.$$eval('[data-testid="trip-card"] a', (as) => as.map((a) => a.getAttribute("href")));
  record("Trips: 'Iniciar checklist' only on pickup-ready reservations, 'Registrar devolução' only on in-use ones", startLinks.filter((h) => h.endsWith("/pickup")).length === 4 && startLinks.filter((h) => h.endsWith("/return")).length === 3, { pickup: startLinks.filter((h) => h.endsWith("/pickup")).length, ret: startLinks.filter((h) => h.endsWith("/return")).length });
  globalThis.__tripsPickupLabel = (await emp.locator('[data-testid="trip-card"] a[href$="/pickup"]').first().innerText()).trim();
  record("Trips: dates have no seconds", !/d{2}:d{2}:d{2}/.test(await emp.locator('[data-testid="trip-card"]').first().innerText()));
  record("Trips: status pills use the real status words", /Aprovada/.test(t) && /Aguardando|Pendente/i.test(t) && /Concluída/.test(t) && /Cancelada/.test(t));
  for (const [tab, sel, n] of [["done", '[data-testid="trip-card"]', 1], ["cancelled", '[data-testid="trip-card"]', 1], ["upcoming", '[data-testid="trip-card"]', 5], ["active", '[data-testid="trip-card"]', 3]]) {
    await go(emp, `/trips?tab=${tab}`);
    record(`Trips: filter tab=${tab} shows only its ${n} card(s), aria-current on the tab, no Gantt`, (await emp.locator(sel).count()) === n && (await emp.locator(`.tp-tab[data-tab="${tab}"][aria-current="page"]`).count()) === 1 && (await emp.locator('[data-testid="trips-schedule"]').count()) === 0);
  }
  await go(emp, "/trips?tab=carpools");
  record("Trips: tab=carpools with none -> 'Nenhum item nesta aba.'", (await emp.locator('[data-testid="trips-tab-empty"]').count()) === 1);
  await go(emp, "/trips?tab=bogus");
  record("Trips: unknown tab falls back to 'Todas'", (await emp.locator('.tp-tab[data-tab="all"][aria-current="page"]').count()) === 1);
  await go(emp, "/trips");
  record("Trips: desktop no horizontal scroll", (await hscroll(emp)) <= 0, await hscroll(emp));
  const st3 = await smallTargets(emp);
  record("Trips: desktop touch targets >= 44px", st3.length === 0, st3.slice(0, 8));
  const cr2 = await contrast(emp, [".fm-subtitle", ".tp-meta", ".tp-plate", ".tp-kind", ".tp-tab", ".tp-count", ".fm-pill", ".tp-date small", ".tp-date strong"]);
  record("Trips: text contrast >= 4.5:1", cr2.length === 0, cr2);
  record("Trips: no invented elements", !INVENTED.test(await text(emp)));
  await shot(emp, "trips-desktop", true);
  await go(emp, "/trips?tab=upcoming");
  await shot(emp, "trips-desktop-filtered", false);

  // ---- trips mobile
  await go(empM, "/trips");
  record("Trips mobile: no horizontal scroll (the tab bar scrolls inside itself)", (await hscroll(empM)) <= 0, await hscroll(empM));
  const st4 = await smallTargets(empM);
  record("Trips mobile: touch targets >= 44px", st4.length === 0, st4.slice(0, 8));
  record("Trips mobile: bottom nav with Reservas current", (await empM.locator('.fm-bottom-nav a[aria-current="page"]').getAttribute("href")) === "/trips");
  await shot(empM, "trips-mobile", false);
  await shot(empM, "trips-mobile-full", true);

  // ---- carpool requests
  console.log("\n--- Trips / carpool requests ---");
  const pP = await newPage(U.empP, D);
  await go(pP, "/trips");
  record("Trips (rider PENDING): request listed with status 'Pendente' + 'Cancelar solicitação'", (await pP.locator('[data-testid="my-carpool-requests"]').count()) === 1 && /Pendente|Aguardando/i.test(await pP.locator('[data-testid="my-carpool-request-status"]').first().innerText()) && (await pP.locator('[data-testid="my-carpool-request"] button:has-text("Cancelar solicitação")').count()) === 1, await pP.locator('[data-testid="my-carpool-request-status"]').first().innerText());
  record("Trips (rider): the 'Caronas' tab counts the request", /Caronas \(1\)/.test((await pP.$$eval('[data-testid="trips-tabs"] a', (as) => as.map((a) => a.textContent.trim()))).join(" ")));
  await shot(pP, "trips-carpool-pending", true);
  await go(pP, "/trips?tab=carpools");
  record("Trips (rider): tab=carpools shows the request and no reservation card", (await pP.locator('[data-testid="my-carpool-request"]').count()) === 1 && (await pP.locator('[data-testid="trip-card"]').count()) === 0);
  await pP.click('[data-testid="my-carpool-request"] button:has-text("Cancelar solicitação")');
  await pP.waitForFunction(() => document.querySelector('[data-testid="my-carpool-request"]')?.getAttribute("data-status") === "CANCELLED", null, { timeout: 30000 }).catch(() => {});
  const cancelled = (await sql(`select status from carpool_ride_requests where rider_id='${U.empP.id}'`))[0].status;
  record("Trips (rider): cancelling works (DB CANCELLED, the card is updated, no cancel button left)", cancelled === "CANCELLED" && (await pP.locator('[data-testid="my-carpool-request"][data-status="CANCELLED"]').count()) === 1 && (await pP.locator('[data-testid="my-carpool-request"] button').count()) === 0, cancelled);
  await shot(pP, "trips-carpool-cancelled", true);

  const pA = await newPage(U.empA, D);
  await go(pA, "/trips");
  record("Trips (rider ACCEPTED): shown once as 'Aceita', not repeated in the joined-carpools list; cancel offered", /Aceita/.test(await pA.locator('[data-testid="my-carpool-request-status"]').first().innerText()) && (await pA.locator('[data-testid="my-carpool-request"]').count()) === 1 && (await pA.locator('[data-testid="trips-carpools"]').count()) === 0 && (await pA.locator('[data-testid="my-carpool-request"] button:has-text("Cancelar solicitação")').count()) === 1);
  await shot(pA, "trips-carpool-accepted", true);
  const pR = await newPage(U.empR, D);
  await go(pR, "/trips");
  const rtxt = await pR.locator('[data-testid="my-carpool-request"]').innerText();
  record("Trips (rider REJECTED): 'Recusada' + the host's reason, no cancel button", /Recusada/.test(rtxt) && /Sem espaco para bagagem/.test(rtxt) && (await pR.locator('[data-testid="my-carpool-request"] button').count()) === 0, rtxt.replace(/\n/g, " | "));
  await shot(pR, "trips-carpool-rejected", true);
  const pRM = await newPage(U.empR, M);
  await go(pRM, "/trips");
  record("Trips mobile (carpool request): no horizontal scroll, touch targets ok", (await hscroll(pRM)) <= 0 && (await smallTargets(pRM)).length === 0, await smallTargets(pRM));
  await shot(pRM, "trips-carpool-mobile", false);

  // ================================================================== CHECKLISTS
  console.log("\n--- Checklists ---");
  // ---- pickup ICE: fields + e2e
  const openCk = async (page, kind, id) => {
    await go(page, `/reservations/${id}/${kind}`);
    await page.waitForFunction(() => { const f = document.querySelector('[data-testid="checklist-form"]'); return Boolean(f) && Object.keys(f).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")); }, null, { timeout: 60000 });
  };
  const fields = (page) => page.evaluate(() => ({
    odometer: !!document.querySelector('input[name="odometerKm"]'),
    fuel: !!document.querySelector('select[name="fuelLevelPercent"]'),
    battery: !!document.querySelector('input[name="batteryLevelPercent"]'),
    location: !!document.querySelector('select[name="currentLocationId"]'),
    equip: document.querySelectorAll('input[name^="equip_"]').length,
    photos: document.querySelectorAll('.ck-photos input[type="file"]').length,
  }));
  await openCk(emp, "pickup", R1.id);
  record("Pickup: renders inside .fm-theme with the vehicle card (plate, category, route)", (await hasFm(emp)) && (await emp.locator('[data-testid="checklist-page"]').innerText()).includes(R1.v.plate) && /Sao-Paulo-R1/.test(await text(emp)));
  let f = await fields(emp);
  record("Pickup ICE: odometer + fuel, NO battery, 2 equipment items, no photo block (no damage)", f.odometer && f.fuel && !f.battery && !f.location && f.equip === 2 && f.photos === 0, f);
  const legend = await emp.evaluate(() => { const fs = document.querySelector("fieldset.ck-fieldset"); const l = fs.querySelector("legend").getBoundingClientRect(); const f = fs.getBoundingClientRect(); return { offset: Math.round(l.top - f.top) }; });
  record("Pickup: fieldset legend sits inside the card (not on the border)", legend.offset >= 12, legend);
  const ckCr = await contrast(emp, [".fm-label", ".ck-hint", ".ck-plate", ".ck-route", ".fm-chip", ".fm-subtitle", ".ck-check span"]);
  record("Pickup: text contrast >= 4.5:1", ckCr.length === 0, ckCr);
  record("Pickup: desktop no horizontal scroll + touch targets", (await hscroll(emp)) <= 0 && (await smallTargets(emp)).length === 0, { h: await hscroll(emp), small: (await smallTargets(emp)).slice(0, 8) });
  await shot(emp, "pickup-ice-desktop", true);
  const empM2 = await newPage(U.emp, M);
  await openCk(empM2, "pickup", R1.id);
  record("Pickup mobile: no horizontal scroll, touch targets >= 44px, bottom nav", (await hscroll(empM2)) <= 0 && (await smallTargets(empM2)).length === 0 && (await empM2.locator(".fm-bottom-nav").isVisible()), { h: await hscroll(empM2), small: await smallTargets(empM2) });
  await shot(empM2, "pickup-ice-mobile", false);
  await shot(empM2, "pickup-ice-mobile-full", true);
  // submit without choosing fuel: native validation blocks it (still on the page)
  await emp.click('.ck-form button[type="submit"]');
  await emp.waitForTimeout(500);
  record("Pickup: submitting without the required fuel is blocked by the form (stays on the checklist)", new URL(emp.url()).pathname.endsWith("/pickup"));
  await emp.fill('input[name="odometerKm"]', "1010");
  await emp.selectOption('select[name="fuelLevelPercent"]', { index: 2 });
  await emp.uncheck('input[name^="equip_"] >> nth=1'); // one equipment missing
  await emp.check('input[name="isDirtyExterior"]');
  await submitToTrips(emp, 60000);
  let ins = (await sql(`select type, odometer_km, fuel_level_percent, battery_level_percent, has_new_damage, missing_safety_equipment, is_dirty_exterior from inspections where reservation_id='${R1.id}'`))[0];
  const vst = (await sql(`select status from vehicles where id='${R1.v.id}'`))[0].status;
  record("Pickup ICE e2e: submit saved the inspection (odometer, fuel, 1 missing equipment, dirty exterior) and the vehicle is in use; redirected to /trips", ins && ins.type === "pickup" && ins.odometer_km === 1010 && ins.fuel_level_percent !== null && ins.battery_level_percent === null && ins.missing_safety_equipment.length === 1 && ins.is_dirty_exterior === true && vst === "in_use", { ins, vst });

  // ---- return ICE (same reservation)
  await openCk(emp, "return", R1.id);
  f = await fields(emp);
  record("Return ICE: odometer + parked-where select + fuel, NO battery, equipment kept, no photo block", f.odometer && f.location && f.fuel && !f.battery && f.equip === 2 && f.photos === 0, f);
  const retTxt = await text(emp);
  record("Return: shows the odometer-at-pickup hint and a 'Registrar nova avaria' style damage checkbox", /Odômetro na retirada: 1.000 km/.test(retTxt) && (await emp.locator('.ck-check[data-tone="warn"]').count()) === 1, retTxt.match(/Odômetro na retirada[^\n]*/)?.[0]);
  await shot(emp, "return-ice-desktop", true);
  await openCk(empM2, "return", R1.id);
  record("Return mobile: no horizontal scroll, touch targets", (await hscroll(empM2)) <= 0 && (await smallTargets(empM2)).length === 0, await smallTargets(empM2));
  await shot(empM2, "return-ice-mobile", false);
  const locs = await emp.$$eval('select[name="currentLocationId"] option', (o) => o.length);
  console.log("    location options: " + locs);
  const locRows = await sql(`select id from vehicle_locations where organization_id='${O}' limit 1`);
  let locId = locRows[0]?.id;
  if (!locId) locId = (await sql(`insert into vehicle_locations (organization_id, name) values ('${O}','LA Garagem') returning id`))[0].id;
  await go(emp, `/reservations/${R1.id}/return`); // reload so the new location is listed
  await emp.waitForSelector('[data-testid="checklist-form"]');
  await emp.waitForTimeout(800);
  await emp.fill('input[name="odometerKm"]', "1100");
  await emp.selectOption('select[name="currentLocationId"]', locId);
  await emp.selectOption('select[name="fuelLevelPercent"]', { index: 1 });
  await submitToTrips(emp, 60000);
  const rsv = (await sql(`select status from reservations where id='${R1.id}'`))[0].status;
  const vst2 = (await sql(`select status, odometer_km from vehicles where id='${R1.v.id}'`))[0];
  record("Return ICE e2e: reservation completed, odometer updated, vehicle leaves in_use", rsv === "completed" && vst2.odometer_km === 1100 && vst2.status !== "in_use", { rsv, vst2 });

  // ---- HEV / PHEV / BEV pickup fields
  await openCk(emp, "pickup", RHEV.id);
  f = await fields(emp);
  record("Pickup HEV: odometer + fuel, NO battery", f.odometer && f.fuel && !f.battery, f);
  await shot(emp, "pickup-hev-desktop", false);
  await openCk(emp, "pickup", RPHEV.id);
  f = await fields(emp);
  record("Pickup PHEV: odometer + fuel + battery", f.odometer && f.fuel && f.battery, f);
  await shot(emp, "pickup-phev-desktop", true);
  await openCk(emp, "pickup", RBEV.id);
  f = await fields(emp);
  record("Pickup BEV: odometer + battery, NO fuel", f.odometer && !f.fuel && f.battery, f);
  // damage flow: checkbox reveals notes + photos, submit without photo is refused, with photo it saves
  record("Pickup BEV: photo block hidden until damage is ticked", (await fields(emp)).photos === 0);
  await emp.check('.ck-check[data-tone="warn"] input');
  await emp.waitForSelector(".ck-photos");
  f = await fields(emp);
  record("Pickup BEV damage: notes textarea + 7 photo fields (6 standard angles + damage) appear", (await emp.locator('textarea[name="damageNotes"]').count()) === 1 && f.photos === 7, f);
  await emp.fill('input[name="odometerKm"]', "1020");
  await emp.fill('input[name="batteryLevelPercent"]', "80");
  await emp.fill('textarea[name="damageNotes"]', "Risco na porta LA");
  await shot(emp, "pickup-bev-damage-desktop", true);
  await emp.click('.ck-form button[type="submit"]');
  await emp.waitForSelector('.ck-msg[role="alert"]');
  const alertTxt = await emp.locator('.ck-msg[role="alert"]').first().innerText();
  record("Damage flow: submitting damage WITHOUT a photo is refused with the evidence-required message (nothing saved)", /foto da avaria é obrigatória/i.test(alertTxt) && (await sql(`select count(*)::int c from inspections where reservation_id='${RBEV.id}'`))[0].c === 0, alertTxt);
  await shot(emp, "pickup-bev-damage-error", false);
  // React resets the uncontrolled fields after a form action returns (pre-existing behaviour): refill before the retry
  await emp.fill('input[name="odometerKm"]', "1020");
  await emp.fill('input[name="batteryLevelPercent"]', "80");
  await emp.fill('textarea[name="damageNotes"]', "Risco na porta LA");
  await emp.locator('.ck-photos input[type="file"]').last().setInputFiles(ASSET);
  await emp.waitForTimeout(400);
  record("Damage flow: remove button label comes from the dictionary ('Remover foto')", (await emp.locator('.ck-remove[aria-label="Remover foto"]').count()) === 1);
  record("Damage flow: the captured photo shows a thumbnail with a >=44px remove button", (await emp.locator(".ck-remove").count()) === 1 && (await emp.locator(".ck-remove").evaluate((b) => b.getBoundingClientRect().width >= 43.5 && b.getBoundingClientRect().height >= 43.5)));
  await submitToTrips(emp, 90000);
  const bi = (await sql(`select has_new_damage, damage_notes, battery_level_percent, fuel_level_percent from inspections where reservation_id='${RBEV.id}'`))[0];
  const photos = (await sql(`select count(*)::int c from inspection_photos where organization_id='${O}' and inspection_id in (select id from inspections where reservation_id='${RBEV.id}')`))[0].c;
  record("Damage flow e2e: BEV pickup with damage saved (damage flag, notes, battery, no fuel) and the photo stored", bi && bi.has_new_damage === true && /Risco na porta LA/.test(bi.damage_notes) && Number(bi.battery_level_percent) === 80 && bi.fuel_level_percent === null && photos >= 1, { bi, photos });

  // ---- returns by powertrain
  await openCk(emp, "return", RHEVu.id);
  f = await fields(emp);
  record("Return HEV: odometer + fuel, NO battery", f.odometer && f.fuel && !f.battery && f.location, f);
  await openCk(emp, "return", RPHEVu.id);
  f = await fields(emp);
  record("Return PHEV: odometer + fuel + battery", f.odometer && f.fuel && f.battery && f.location, f);
  await openCk(emp, "return", RBEVu.id);
  f = await fields(emp);
  record("Return BEV: odometer + battery, NO fuel", f.odometer && !f.fuel && f.battery && f.location, f);
  await emp.check('.ck-check[data-tone="warn"] input');
  await emp.waitForSelector(".ck-photos");
  record("Return BEV: ticking new damage reveals notes + photo block", (await emp.locator('textarea[name="damageNotes"]').count()) === 1 && (await fields(emp)).photos === 7);
  await shot(emp, "return-bev-damage-desktop", true);
  const empM3 = await newPage(U.emp, M);
  await openCk(empM3, "return", RBEVu.id);
  await empM3.check('.ck-check[data-tone="warn"] input');
  await empM3.waitForSelector(".ck-photos");
  record("Return BEV damage mobile: no horizontal scroll + touch targets >= 44px", (await hscroll(empM3)) <= 0 && (await smallTargets(empM3)).length === 0, { h: await hscroll(empM3), small: await smallTargets(empM3) });
  await shot(empM3, "return-bev-damage-mobile", false);

  // ---- error state: a driver who is not authorized gets the server error inside the new alert (nothing saved)
  const RX = await mk("empX", "ICE", "reserved", "confirmed", "Sem-autorizacao");
  const pX = await newPage(U.empX, D);
  await openCk(pX, "pickup", RX.id);
  await pX.fill('input[name="odometerKm"]', "1010");
  await pX.selectOption('select[name="fuelLevelPercent"]', { index: 2 });
  await pX.click('.ck-form button[type="submit"]');
  await pX.waitForSelector('.ck-msg[role="alert"]');
  const xTxt = await pX.locator('.ck-msg[role="alert"]').innerText();
  record("Error state: unauthorized driver -> the server message is shown in the alert, form stays, nothing saved", /sem autoriza/i.test(xTxt) && (await sql(`select count(*)::int c from inspections where reservation_id='${RX.id}'`))[0].c === 0, xTxt);
  await shot(pX, "pickup-error-driver-unauthorized", false);

  // ---- blocked / forbidden
  console.log("\n--- Blocked / forbidden ---");
  await go(pA, `/reservations/${RHEV.id}/pickup`);
  const blockedTxt = await text(pA);
  record("Blocked: another employee opening someone else's pickup gets no checklist (RLS hides the reservation -> not found), nothing about the vehicle leaks", (await pA.locator('[data-testid="checklist-form"]').count()) === 0 && !blockedTxt.includes(RHEV.v.plate), pA.url());
  await go(pA, "/trips?tripActionError=checklist_not_authorized");
  record("Blocked: the 'not authorized' redirect target renders its alert inside the new /trips", /permiss/i.test(await pA.locator('.fm-banner[role="alert"]').first().innerText()));
  await shot(pA, "blocked-not-authorized", false);
  await go(emp, `/reservations/${RPEND.id}/pickup`);
  record("Blocked: pickup of a reservation that is not ready -> /trips alert 'pickup_wrong_status'", /pickup_wrong_status/.test(emp.url()) && (await emp.locator('.fm-banner-danger[role="alert"]').count()) === 1, emp.url());
  await shot(emp, "blocked-pickup-wrong-status", false);
  await go(emp, `/reservations/${RPEND.id}/return`);
  record("Blocked: return of a reservation that is not in use -> /trips alert 'return_wrong_status'", /return_wrong_status/.test(emp.url()) && (await emp.locator('.fm-banner-danger[role="alert"]').count()) === 1, emp.url());
  await go(emp, `/reservations/${H.id}`);
  record("Forbidden: a co-worker's reservation detail bounces to /trips", new URL(emp.url()).pathname === "/trips");

  // ================================================================== DETAIL (employee)
  console.log("\n--- Reservation detail (employee) ---");
  const pHost = await newPage(U.host, D);
  await go(pHost, `/reservations/${H.id}`);
  record("Detail (host employee): inside .fm-theme with the carpool host section, requests and the message thread", (await hasFm(pHost)) && (await pHost.locator('[data-testid="carpool-host-section"]').count()) === 1 && (await pHost.locator('textarea').count()) >= 1);
  t = await text(pHost);
  record("Detail: shows the route, plate, status pills and the host's accepted rider", /Campinas-Host/.test(t) && t.includes(H.v.plate) && (await pHost.locator('[data-testid="carpool-participants"]').count()) === 1 && (await pHost.locator('[data-testid="carpool-participants"]').innerText()).includes(U.empA.fullName));
  record("Detail: desktop no horizontal scroll + touch targets", (await hscroll(pHost)) <= 0, { h: await hscroll(pHost), small: (await smallTargets(pHost)).slice(0, 8) });
  const stH = await smallTargets(pHost);
  record("Detail (host): touch targets >= 44px", stH.length === 0, stH.slice(0, 10));
  const rdStyle = await pHost.evaluate(() => { const bad = [...document.querySelectorAll(".rd h2, .rd h3, .rd button, .rd span")].filter((e) => e.offsetParent && (getComputedStyle(e).textTransform === "uppercase" || parseFloat(getComputedStyle(e).letterSpacing) > 0.5)).map((e) => e.tagName + ":" + e.textContent.trim().slice(0, 20)); const card = getComputedStyle(document.querySelector('[data-testid="carpool-host-section"]')); return { bad: bad.slice(0, 5), radius: card.borderTopLeftRadius, bg: card.backgroundColor }; });
  record("Detail: host carpool panel + message thread use the v2 look (no tracked caps, 16px card radius, white card)", rdStyle.bad.length === 0 && rdStyle.radius === "16px" && rdStyle.bg === "rgb(255, 255, 255)", rdStyle);
  const rdCr = await contrast(pHost, [".rd label", ".rd li", ".rd h2", ".rd h3", ".rd button", ".rd .text-xs"]);
  record("Detail: shared widgets text contrast >= 4.5:1", rdCr.length === 0, rdCr);
  await shot(pHost, "detail-host-desktop", true);
  await go(emp, `/reservations/${RPEND.id}`);
  record("Detail (employee): cancel button + pending status; no pickup/return buttons", (await hasFm(emp)) && (await emp.locator('.rd-actions button:has-text("Cancelar")').count()) === 1 && (await emp.locator('.rd-actions a').count()) === 0);
  await shot(emp, "detail-pending-desktop", true);
  await go(emp, `/reservations/${RHEV.id}`);
  const rdLinks = await emp.$$eval(".rd-actions a", (as) => as.map((a) => a.getAttribute("href")));
  const detLabel = (await emp.locator('.rd-actions a[href$="/pickup"]').innerText()).trim();
  record("Pickup label is the same dictionary text on Home, Trips and the detail page", detLabel === globalThis.__pickupLabel && globalThis.__tripsPickupLabel === detLabel, { detLabel, home: globalThis.__pickupLabel, trips: globalThis.__tripsPickupLabel });
  record("Detail (employee, pickup-ready): 'Iniciar retirada' link to pickup; messages thread present", rdLinks.includes(`/reservations/${RHEV.id}/pickup`) && (await emp.locator("textarea").count()) >= 1, rdLinks);
  await shot(emp, "detail-pickup-ready-desktop", true);
  const rdMob = await newPage(U.emp, M);
  await go(rdMob, `/reservations/${RHEV.id}`);
  record("Detail mobile: no horizontal scroll + touch targets", (await hscroll(rdMob)) <= 0 && (await smallTargets(rdMob)).length === 0, { h: await hscroll(rdMob), small: await smallTargets(rdMob) });
  await shot(rdMob, "detail-mobile", false);
  // keep the pending reservation for the manager checks; cancel is exercised afterwards

  // ================================================================== ROLE REGRESSION
  console.log("\n--- Role regression ---");
  const mgr = await newPage(U.mgr, D);
  await go(mgr, "/dashboard");
  t = await text(mgr);
  record("Manager /dashboard: same content (approvals, tasks, attention, fleet block/unblock), now in the Lote 1B FleetMind look (.fm-theme)", (await hasFm(mgr)) && /Reservas Aguardando Aprovação/i.test(t) && (await mgr.locator('button:has-text("Aprovar")').count()) >= 1 && /Precisa de Atenção/i.test(t) && /Painel de Veículos/i.test(t) && (await mgr.locator('button:has-text("Bloquear")').count()) >= 1);
  await go(mgr, `/reservations/${R1.id}`);
  record("Manager /reservations/[id]: unchanged AppShell page (no .fm-theme), thread visible, no employee-only actions", !(await hasFm(mgr)) && (await mgr.locator("textarea").count()) >= 1 && /MSG-LA-1/.test(await text(mgr)));
  await go(mgr, "/trips");
  const mh = await sideHrefs(mgr);
  record("Manager /trips (new shell): nav keeps Painel, Movimentações, Analytics, Frota, Configurações (+ rider items)", ["/dashboard", "/gate", "/analytics", "/fleet", "/settings", "/trips", "/trips/new", "/carpool"].every((h) => mh.includes(h)) && !mh.includes("/settings/users"), mh);
  await go(mgr, `/reservations/${RHEV.id}/pickup`);
  record("Manager can still open a pickup checklist of another employee (privileged) inside the new shell", (await hasFm(mgr)) && new URL(mgr.url()).pathname.endsWith("/pickup"));
  const adm = await newPage(U.adm, D);
  await go(adm, "/dashboard");
  record("Administrator /dashboard same content (approvals visible), now in the Lote 1B FleetMind look (.fm-theme)", (await hasFm(adm)) && /Reservas Aguardando Aprovação/i.test(await text(adm)));
  await go(adm, "/trips");
  const ah = await sideHrefs(adm);
  record("Administrator /trips nav keeps Equipe (/settings/users)", ah.includes("/settings/users") && ah.includes("/dashboard"), ah);
  const sec = await newPage(U.sec, D);
  await go(sec, "/dashboard");
  record("Security /dashboard same content (attention + vehicle panel), now in the Lote 1B FleetMind look (.fm-theme)", (await hasFm(sec)) && /Precisa de Atenção/i.test(await text(sec)));
  await go(sec, "/trips");
  const sh2 = await sideHrefs(sec);
  record("Security /trips nav: Movimentações (/gate) + Minhas Reservas, no Painel", sh2.includes("/gate") && sh2.includes("/trips") && !sh2.includes("/dashboard"), sh2);
  await go(sec, `/reservations/${RHEV.id}/pickup`);
  record("Security can open a pickup checklist (privileged) in the new shell", (await hasFm(sec)) && new URL(sec.url()).pathname.endsWith("/pickup"));
  await go(sec, `/reservations/${R1.id}`);
  record("Security /reservations/[id] unchanged AppShell page (no .fm-theme)", !(await hasFm(sec)));
  const mnt = await newPage(U.mnt, D);
  await go(mnt, "/dashboard");
  t = await text(mnt);
  record("Maintenance operator /dashboard same content (tasks section + vehicles), now in the Lote 1B FleetMind look (.fm-theme)", (await hasFm(mnt)) && /Precisa de Atenção/i.test(t) && /Painel de Veículos/i.test(t) && /tarefas/i.test(t) && !/Reservas Aguardando Aprovação/i.test(t));
  record("Page errors: none on any page", [emp, empM, pP, pA, pR, mgr, adm, sec, mnt, pHost].every((p) => p.__errors.length === 0), [emp, empM, pP, pA, pR, mgr, adm, sec, mnt, pHost].flatMap((p) => p.__errors));

  // scoping: other screens are NOT in the theme
  for (const [who, u, themed] of [[emp, "/account", false], [mgr, "/settings", true], [mgr, "/fleet", true], [mgr, "/analytics", true]]) {
    await go(who, u);
    // Lote 1B restyled /settings, /fleet and /analytics into the FleetMind look; /account stays outside
    record(`Scoping: ${u} ${themed ? "is in .fm-theme (Lote 1B)" : "stays outside .fm-theme"}`, themed ? await hasFm(who) : !(await hasFm(who)));
  }
  await go(emp, "/carpool");
  record("Scoping: /carpool and /trips/new still use the theme (previous lots intact)", await hasFm(emp));

  // ---- cancelling a reservation from the new detail still works (employee)
  await go(emp, `/reservations/${RPEND.id}`);
  await emp.click('.rd-actions button:has-text("Cancelar")');
  await emp.waitForTimeout(2500);
  const cst = (await sql(`select status from reservations where id='${RPEND.id}'`))[0].status;
  record("Detail (employee): cancelling the pending reservation works (DB cancelled)", cst === "cancelled", cst);
} catch (e) {
  record("FATAL", false, String(e && e.stack ? e.stack : e));
} finally {
  await browser.close().catch(() => {});
  // photos uploaded by the damage flow live in Storage (not removable with SQL): delete them through the Storage API
  async function rmPrefix(prefix) {
    const r = await fetch(`${URL_}/storage/v1/object/list/vehicle-photos`, { method: "POST", headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 1000 }) });
    for (const it of (await r.json().catch(() => [])) ?? []) {
      if (it.id) await fetch(`${URL_}/storage/v1/object/vehicle-photos/${prefix}/${it.name}`, { method: "DELETE", headers: { apikey: SVC, Authorization: "Bearer " + SVC } });
      else await rmPrefix(`${prefix}/${it.name}`);
    }
  }
  for (const o of orgs) await rmPrefix(o.orgId).catch((e) => console.log("storage cleanup failed", String(e).slice(0, 100)));
  await cleanupOrgs(orgs);
  const extra = orgs.length
    ? await sql(`select (select count(*) from inspections where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) inspections,
      (select count(*) from safety_equipment_items where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) equipment,
      (select count(*) from vehicle_locations where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) locations,
      (select count(*) from vehicle_categories where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) categories,
      (select count(*) from reservations where organization_id in (${orgs.map((o) => `'${o.orgId}'`).join(",")})) reservations,
      (select count(*) from storage.objects where bucket_id='vehicle-photos' and (${orgs.map((o) => `name like '${o.orgId}/%'`).join(" or ")})) storage_photos`).catch((e) => [{ error: String(e) }])
    : [];
  record("Cleanup (extra tables): inspections / equipment / locations / categories / reservations are zero", extra.length > 0 && Object.values(extra[0]).every((v) => Number(v) === 0), extra[0]);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) console.log("FAILED:\n" + failed.map((r) => " - " + r.name).join("\n"));
  process.exit(failed.length ? 1 : 0);
}
