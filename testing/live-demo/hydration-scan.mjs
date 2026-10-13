// Visits every themed page per role and reports page errors (React hydration #418 etc.) with the page path.
import { chromium } from "playwright";
import { BASE, PASSWORD, sql, provisionOrg, cleanupOrgs } from "./carpool-c5-lib.mjs";
const browser = await chromium.launch({ headless: true });
const orgs = []; const out = [];
try {
  const A = await provisionOrg("hyd", [["emp", "employee"], ["mgr", "fleet_manager"], ["adm", "administrator"], ["sec", "security"]]); orgs.push(A);
  const U = A.users, O = A.orgId, v1 = A.vehicles[0];
  await sql(`update profiles set driver_authorized=true where organization_id='${O}'`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${O}', 1, 15, 15, 5, 15, 30)`);
  const [t1] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${O}','${U.emp.id}',now() - interval '1 hour', now() + interval '6 hours','Valinhos','Sao Paulo',20,1,'Reuniao') returning id`);
  const [r1] = await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${O}','${v1.id}','${t1.id}','confirmed', now() - interval '1 hour', now() + interval '6 hours') returning id`);
  const pages = {
    emp: ["/dashboard", "/trips", "/trips/new", "/carpool", `/reservations/${r1.id}`, `/reservations/${r1.id}/pickup`],
    mgr: ["/dashboard", "/fleet", `/fleet/vehicles/${v1.id}`, "/analytics", "/analytics/carpool", "/settings", "/trips/new"],
    adm: ["/settings/users"], sec: ["/gate"],
  };
  for (const [who, list] of Object.entries(pages)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    const page = await ctx.newPage();
    let cur = "login"; page.on("pageerror", (e) => out.push(`ERR ${who} ${cur}: ${String(e).slice(0, 90)}`)); page.on("console", (m) => { if (m.type() === "error" && /hydrat/i.test(m.text())) out.push(`HYD ${who} ${cur}: ${m.text().replace(/
+/g, " | ").slice(0, 1400)}`); });
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.fill('input[name="email"]', U[who].email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/", { timeout: 90000 }), page.click('button[type="submit"]')]);
    for (const p of list.concat(who === "emp" ? ["/trips/new", "/carpool", "/trips/new"] : [])) { cur = p.replace(/[0-9a-f-]{36}/g, ":id"); await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 90000 }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1200); out.push(`visited ${who} ${cur}`); }
    await ctx.close();
  }
} catch (e) { out.push("ERROR " + String(e).slice(0, 200)); }
finally { await browser.close(); await cleanupOrgs(orgs); }
console.log(out.join("\n"));
