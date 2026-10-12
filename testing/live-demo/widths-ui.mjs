// Responsive sweep: every themed screen at intermediate desktop/tablet widths. Reports horizontal overflow and screenshots.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BASE, PASSWORD, sql, provisionOrg, cleanupOrgs, ROOT } from "./carpool-c5-lib.mjs";
const OUT = path.join(ROOT, "resultado_de_testes", "design-v2", "widths");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const orgs = [];
const WIDTHS = [820, 1076, 1280, 1440];
const rows = [];
try {
  const A = await provisionOrg("wid", [["emp", "employee"], ["mgr", "fleet_manager"], ["adm", "administrator"], ["sec", "security"]]);
  orgs.push(A);
  const U = A.users, O = A.orgId;
  await sql(`update profiles set driver_authorized=true where organization_id='${O}'`);
  const v1 = A.vehicles[0];
  const [t1] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${O}','${U.emp.id}',now() - interval '1 hour', now() + interval '6 hours','Valinhos','Sao Paulo',20,1,'Reuniao') returning id`);
  const [r1] = await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${O}','${v1.id}','${t1.id}','confirmed', now() - interval '1 hour', now() + interval '6 hours') returning id`);
  const pages = {
    emp: [["home", "/dashboard"], ["trips", "/trips"], ["reservar", "/trips/new"], ["carpool", "/carpool"], ["detail", `/reservations/${r1.id}`], ["pickup", `/reservations/${r1.id}/pickup`]],
    mgr: [["cc", "/dashboard"], ["fleet", "/fleet"], ["vehicle", `/fleet/vehicles/${v1.id}`], ["analytics", "/analytics"], ["carpoolkpi", "/analytics/carpool"], ["settings", "/settings"]],
    adm: [["users", "/settings/users"]],
    sec: [["gate", "/gate"]],
  };
  for (const [who, list] of Object.entries(pages)) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 815 }, locale: "pt-BR" });
      const page = await ctx.newPage();
      await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.fill('input[name="email"]', U[who].email);
      await page.fill('input[name="password"]', PASSWORD);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/", { timeout: 90000 }), page.click('button[type="submit"]')]);
      for (const [name, url] of list) {
        await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        const m = await page.evaluate(() => {
          const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          // narrow text boxes: elements with text whose width < 90px and that wrap into many lines (per-word wrapping)
          let cramped = 0;
          for (const el of document.querySelectorAll(".fm-theme p, .fm-theme small, .fm-theme strong, .fm-theme span, .fm-theme a, .fm-theme dd, .fm-theme li")) {
            const r = el.getBoundingClientRect(); const t = (el.textContent || "").trim();
            if (t.length > 14 && r.width > 0 && r.width < 80 && r.height > 60 && el.children.length === 0) cramped++;
          }
          return { over, cramped };
        });
        rows.push(`${who}/${name}@${w}: overflow=${m.over} cramped=${m.cramped}`);
        await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
      }
      await ctx.close();
    }
  }
} catch (e) { rows.push("ERROR " + String(e).slice(0, 300)); }
finally { await browser.close(); await cleanupOrgs(orgs); }
console.log(rows.join("\n"));
console.log("BAD:", rows.filter((r) => /overflow=([1-9]\d*)|cramped=([1-9]\d*)/.test(r)).length);
