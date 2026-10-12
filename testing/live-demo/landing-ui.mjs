// Landing page per role after login: employee -> /dashboard (new Home), manager/admin -> /dashboard, security -> /gate, maintenance -> /trips.
import { chromium } from "playwright";
import { BASE, PASSWORD, record, results, provisionOrg, cleanupOrgs } from "./carpool-c5-lib.mjs";
const browser = await chromium.launch({ headless: true });
const orgs = [];
try {
  const A = await provisionOrg("land", [["emp", "employee"], ["mgr", "fleet_manager"], ["adm", "administrator"], ["sec", "security"], ["mnt", "maintenance_operator"]]);
  orgs.push(A);
  const expect = { emp: "/dashboard", mgr: "/dashboard", adm: "/dashboard", sec: "/gate", mnt: "/trips" };
  for (const [k, want] of Object.entries(expect)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    for (let i = 0; i < 2; i++) {
      try {
        await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.fill('input[name="email"]', A.users[k].email);
        await page.fill('input[name="password"]', PASSWORD);
        await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/", { timeout: 90000 }), page.click('button[type="submit"]')]);
        break;
      } catch (e) { if (i === 1) throw e; }
    }
    await page.waitForLoadState("domcontentloaded");
    record(`Landing after login: ${k} -> ${want}`, new URL(page.url()).pathname === want, page.url());
    if (k === "emp") record("Employee landing is the new Home (FleetMind look)", (await page.locator(".fm-theme").count()) > 0);
    await ctx.close();
  }
} catch (e) {
  record("FATAL", false, String(e).slice(0, 300));
} finally {
  await browser.close();
  await cleanupOrgs(orgs);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
