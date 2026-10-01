// C7b / pack 07 "API key leakage": a provider failure with an INVALID Google key (and, in the same run, the geocoder
// failing for every request) must never put the key into HTML, server-action / RSC responses, the browser console
// or the server log.
//
//   node testing/live-demo/start-server.mjs --port 3102 --bad-key > <SERVER_LOG> 2>&1     (the fake key is
//        "AIzaInvalidKeyForOutageSimulation": unique, so any occurrence anywhere is a leak)
//   SERVER_LOG=<SERVER_LOG> BASE_URL=http://localhost:3102 node testing/live-demo/c7b-keyleak.mjs
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { BASE, record, results, sql, provisionOrg, cleanupOrgs, login, fillTrip, waitHydrated } from "./carpool-c5-lib.mjs";

const FAKE = "AIzaInvalidKeyForOutageSimulation";
const SERVER_LOG = process.env.SERVER_LOG;
const dep = new Date(Date.now() + 24 * 3600000);
dep.setHours(10, 0, 0, 0);
const orgs = [];
const browser = await chromium.launch({ headless: true });
const seen = []; // every same-origin response body + console line
try {
  const A = await provisionOrg("kl", [["rider", "employee"], ["host", "employee"]]);
  orgs.push(A);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => seen.push("console:" + m.text()));
  page.on("pageerror", (e) => seen.push("pageerror:" + String(e)));
  page.on("response", async (r) => {
    try {
      const url = r.url();
      if (!url.startsWith(BASE)) return;
      const ct = r.headers()["content-type"] ?? "";
      if (/(text|json|javascript|x-component)/.test(ct)) seen.push(`${r.request().method()} ${url.replace(BASE, "")} ${r.status()}\n` + (await r.text()));
      seen.push("headers:" + JSON.stringify(r.headers()));
    } catch { /* body not available */ }
  });
  await login(page, A.users.rider);
  await fillTrip(page, { departure: dep, origin: "Avenida Paulista, 1578, São Paulo", destination: "Aeroporto de Congonhas, São Paulo", passengers: 1 });
  await page.waitForSelector('[data-testid="carpool-unavailable"]', { timeout: 90000 });
  record("provider failure (invalid key): the outage banner is shown, the vehicle flow stays available", (await page.locator("text=Veículo recomendado").count()) > 0);
  seen.push("html:" + (await page.content()));
  seen.push("text:" + (await page.evaluate(() => document.body.innerText)));
  await page.waitForTimeout(1500);

  const blob = seen.join("\n");
  const hits = (needle) => blob.split(needle).length - 1;
  record("the (fake) API key appears NOWHERE in the HTML / server-action responses / RSC payloads / headers / console", hits(FAKE) === 0, { occurrences: hits(FAKE), bytesScanned: blob.length });
  record("no 'key=' query string of a provider URL appears in anything the browser received", !/maps\.googleapis\.com[^"'\s]*key=/i.test(blob), {});
  record("no Google-key-shaped token (AIza + 35 chars) anywhere in what the browser received", !/AIza[0-9A-Za-z_-]{35}/.test(blob), {});
  if (SERVER_LOG && existsSync(SERVER_LOG)) {
    const log = readFileSync(SERVER_LOG, "utf8");
    record("the (fake) API key appears nowhere in the server log (errors / warnings / request lines)", !log.includes(FAKE) && !/maps\.googleapis\.com[^\s]*key=/i.test(log), { logBytes: log.length, occurrences: log.split(FAKE).length - 1 });
    const googleLines = log.split("\n").filter((l) => /googleapis/i.test(l)).slice(0, 5);
    console.log("  server log lines mentioning googleapis (first 5, key-free by the check above):", googleLines.map((l) => l.slice(0, 160)));
  } else {
    record("server log available for the scan (SERVER_LOG)", false, "set SERVER_LOG to the file the --bad-key server writes to");
  }
  await ctx.close();
} finally {
  await cleanupOrgs(orgs);
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
void [sql, waitHydrated];
