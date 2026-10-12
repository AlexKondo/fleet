// Click feedback: within 100ms of a sidebar click the link is marked pending, the top bar/dim state is on; cleared after arrival.
import { chromium } from "playwright";
import { BASE, PASSWORD, record, results, provisionOrg, cleanupOrgs } from "./carpool-c5-lib.mjs";
const browser = await chromium.launch({ headless: true });
const orgs = [];
try {
  const A = await provisionOrg("nf", [["emp", "employee"]]); orgs.push(A);
  for (const [label, vp] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "pt-BR", hasTouch: vp.width < 600, isMobile: vp.width < 600 });
    const page = await ctx.newPage();
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.fill('input[name="email"]', A.users.emp.email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/", { timeout: 90000 }), page.click('button[type="submit"]')]);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    const sel = label === "desktop" ? '.fm-nav a[href="/trips"]' : '.fm-bottom-nav a[href="/trips"]';
    // install an in-page probe so the measurement is not limited by Playwright round trips
    await page.evaluate((s) => {
      window.__fb = { t0: 0, markAt: -1 };
      window.addEventListener("click", (e) => { window.__fb.t0 = e.timeStamp; }, false);
      const root = document.querySelector(".fm-theme");
      new MutationObserver(() => {
        if (window.__fb.markAt < 0 && root.hasAttribute("data-nav-pending") && document.querySelector(s + "[data-pending]")) {
          window.__fb.markAt = performance.now();
        }
      }).observe(root, { attributes: true, subtree: true, attributeFilter: ["data-nav-pending", "data-pending"] });
    }, sel);
    await page.click(sel);
    await page.waitForURL((u) => u.pathname === "/trips", { timeout: 30000 });
    const fb0 = await page.evaluate(() => window.__fb).catch(() => null);
    const fb = fb0 && { pendingMs: Math.round((fb0.markAt - fb0.t0) * 10) / 10, ...fb0 };
    // fresh document after a hard navigation would lose the probe; client navigation keeps it
    record(`${label}: clicked link is marked pending within 100ms of the click`, fb && fb0.markAt >= 0 && fb.pendingMs >= -2 && fb.pendingMs <= 100, fb);
    await page.waitForFunction(() => !document.querySelector(".fm-theme").hasAttribute("data-nav-pending"), null, { timeout: 15000 });
    record(`${label}: pending state cleared after arriving`, (await page.locator("[data-pending]").count()) === 0);
    await ctx.close();
  }
} catch (e) { record("FATAL", false, String(e).slice(0, 300)); }
finally { await browser.close(); await cleanupOrgs(orgs); }
const failed = results.filter((r) => r.ok === false || r.pass === false).length;
console.log(`\n${failed ? "FAILED" : "ALL OK"} (${results.length} checks)`);
