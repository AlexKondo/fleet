// Sidebar navigation timing on BASE_URL: click -> URL change, and click -> main heading visible. Disposable org.
import { chromium } from "playwright";
import { BASE, PASSWORD, provisionOrg, cleanupOrgs } from "./carpool-c5-lib.mjs";
const browser = await chromium.launch({ headless: true });
const orgs = [];
const out = [];
try {
  const A = await provisionOrg("nav", [["emp", "employee"], ["mgr", "fleet_manager"]]);
  orgs.push(A);
  for (const who of ["emp", "mgr"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.fill('input[name="email"]', A.users[who].email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/", { timeout: 90000 }), page.click('button[type="submit"]')]);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    const links = await page.$$eval(".fm-sidebar nav a, aside a", (as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim() })).filter((l) => l.href && l.href.startsWith("/")));
    const seen = new Set();
    for (const l of links) {
      if (seen.has(l.href)) continue; seen.add(l.href);
      for (let round = 1; round <= 2; round++) {
        await page.goto(BASE + (who === "emp" ? "/dashboard" : "/dashboard"), { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        const t0 = Date.now();
        await page.click(`a[href="${l.href}"]`);
        await page.waitForURL((u) => u.pathname === l.href.split("?")[0], { timeout: 30000 }).catch(() => {});
        const tUrl = Date.now() - t0;
        await page.waitForSelector("h1", { timeout: 30000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        const tDone = Date.now() - t0;
        out.push(`${who} ${l.href} round${round}: url=${tUrl}ms done=${tDone}ms`);
      }
    }
    await ctx.close();
  }
} catch (e) { out.push("ERROR " + String(e).slice(0, 300)); }
finally { await browser.close(); await cleanupOrgs(orgs); }
console.log(out.join("\n"));
