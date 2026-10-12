import { chromium } from "playwright";
import { BASE, PASSWORD, provisionOrg, cleanupOrgs } from "./carpool-c5-lib.mjs";
const browser = await chromium.launch({ headless: true });
const orgs = []; const out = [];
try {
  const A = await provisionOrg("nd", [["emp", "employee"]]); orgs.push(A);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.fill('input[name="email"]', A.users.emp.email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/", { timeout: 90000 }), page.click('button[type="submit"]')]);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const reqs = [];
  let T0 = 0;
  page.on("request", (r) => { if (T0) reqs.push({ ev: "req ", url: r.url().replace(BASE, "").slice(0, 60), at: Date.now() - T0 }); });
  page.on("requestfinished", (r) => { if (T0) reqs.push({ ev: "done", url: r.url().replace(BASE, "").slice(0, 60), at: Date.now() - T0 }); });
  for (const href of ["/trips", "/carpool", "/trips/new"]) {
    reqs.length = 0;
    await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" }).catch(() => {});
    reqs.length = 0;
    const t0 = Date.now(); T0 = t0;
    await page.click(`a[href="${href}"]`);
    await page.waitForURL((u) => u.pathname === href, { timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    out.push(`--- click ${href}: ${Date.now() - t0}ms`);
    for (const r of reqs.sort((a, b) => a.at - b.at)) out.push(`   +${String(r.at).padStart(5)}ms ${r.ev} ${r.url}`);
    T0 = 0;
  }
  const h = await (await page.request.get(BASE + "/trips")).headers();
  out.push("headers x-vercel-id: " + h["x-vercel-id"] + " | server-timing: " + (h["server-timing"] || "none"));
} catch (e) { out.push("ERROR " + String(e).slice(0, 300)); }
finally { await browser.close(); await cleanupOrgs(orgs); }
console.log(out.join("\n"));
