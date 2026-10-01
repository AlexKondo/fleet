// C7b / L5: proves the unauthenticated flows never read a table with the public anon key, so revoking anon's table
// privileges (supabase/migrations-pending/0069_l5_revoke_anon_table_privileges.sql) cannot break them.
//
// The app server must be started with the fetch logger (it records every server-side request to Supabase as
// {method, path, bearer: anon|service|user|none}, never a key value):
//   node testing/live-demo/start-server.mjs --port 3101 --fetch-log <FILE>
//   FETCH_LOG=<FILE> BASE_URL=http://localhost:3101 node testing/live-demo/c7b-unauth-flows.mjs
// (The signup form is only LOADED, not submitted: it joins the single real organization, which tests must not touch.
//  Its submit path uses the service-role client only - signUpOrganization.ts.)
import { chromium } from "playwright";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { BASE, T, record, results, sql, provisionOrg, cleanupOrgs, login } from "./carpool-c5-lib.mjs";

const LOG = process.env.FETCH_LOG;
if (!LOG) { console.error("FETCH_LOG must point to the fetch logger file of the running server"); process.exit(2); }
// a login page makes no Supabase request, so the logger may never have created the file: start from an empty one
if (!existsSync(LOG)) writeFileSync(LOG, "");
const readLog = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const orgs = [];
try {
  const startCount = readLog().length;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const page = await ctx.newPage();
  const visits = [];
  const visit = async (p, expectPath) => {
    const res = await page.goto(BASE + p, { waitUntil: "load", timeout: 90000 });
    await sleep(800);
    const finalPath = new URL(page.url()).pathname;
    const ok = (res?.status() ?? 0) < 400 && (expectPath ? finalPath === expectPath : true);
    visits.push([p, finalPath, res?.status()]);
    record(`unauthenticated GET ${p} -> ${finalPath} (${res?.status()})`, ok);
  };
  await visit("/login", "/login");
  await visit("/signup", "/signup");
  await visit("/forgot-password", "/forgot-password");
  await visit("/reset-password", "/forgot-password");
  await visit("/trips", "/login");
  await visit("/", "/login");
  await visit("/analytics/carpool", "/login");

  // wrong-password login attempt (real server action -> Auth API)
  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.fill('input[name="email"]', `nobody-${T}@fleet-test.invalid`);
  await page.fill('input[name="password"]', "wrong-password-123");
  await page.click('button[type="submit"]');
  await sleep(2500);
  record("wrong-password login stays on /login with an error (no crash)", new URL(page.url()).pathname === "/login");

  // forgot-password submission for a non-existent address (no real mail target)
  await page.goto(BASE + "/forgot-password", { waitUntil: "load" });
  await page.fill('input[name="email"]', `nobody-${T}@fleet-test.invalid`);
  await page.click('button[type="submit"]');
  await sleep(3500);
  record("forgot-password submission completes without a server error", !/something went wrong|application error/i.test(await page.locator("body").innerText()));

  const unauth = readLog().slice(startCount);
  const rest = unauth.filter((e) => e.path.startsWith("/rest/v1/"));
  const anonRest = rest.filter((e) => e.bearer === "anon" || e.bearer === "none");
  console.log(`server-side Supabase requests during the unauthenticated flows: total=${unauth.length}, /rest/v1 = ${rest.length}, of which with the anon key = ${anonRest.length}`);
  console.log("  by path/bearer:", JSON.stringify(Object.entries(unauth.reduce((a, e) => { const k = `${e.method} ${e.path.replace(/\/[0-9a-f-]{36}/g, "/:id")} [${e.bearer}]`; a[k] = (a[k] ?? 0) + 1; return a; }, {}))));
  record("L5: NO unauthenticated flow reads or writes a table/RPC through PostgREST with the anon key", anonRest.length === 0, anonRest.slice(0, 5));
  record("unauthenticated flows only talk to the Auth API (and only with the anon key)", unauth.every((e) => e.path.startsWith("/auth/v1/")), [...new Set(unauth.map((e) => e.path))]);
  await ctx.close();

  // control: a normal authenticated login still produces user-JWT requests (the logger is alive)
  const A = await provisionOrg("unauth", [["u1", "employee"]]);
  orgs.push(A);
  const before = readLog().length;
  const p2 = await (await browser.newContext({ locale: "pt-BR" })).newPage();
  await login(p2, A.users.u1);
  await p2.goto(BASE + "/trips", { waitUntil: "load" });
  await sleep(1500);
  const authed = readLog().slice(before).filter((e) => e.path.startsWith("/rest/v1/"));
  record("control: after login the app's table reads use the USER jwt (never the anon key)", authed.length > 0 && authed.every((e) => e.bearer === "user" || e.bearer === "service"), { n: authed.length, bearers: [...new Set(authed.map((e) => e.bearer))] });
} finally {
  await cleanupOrgs(orgs);
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
void sql;
