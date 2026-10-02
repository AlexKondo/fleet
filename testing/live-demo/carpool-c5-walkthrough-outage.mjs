// Phase C5 real-browser walk-through #2: run against a `next dev` started with an INVALID
// GOOGLE_MAPS_API_KEY (provider outage simulation, port 3101) -> the "could not validate
// carpools now" banner appears and the normal vehicle flow still completes. Also proves that an
// organization whose policy has carpool DISABLED keeps the old UI (consent checkbox, no carpool-first, no host
// seat question); decision L3 (C7b): such an org is offered NO carpool at all and the legacy join path is refused
// by RLS for coworker trips.
import { chromium } from "playwright";
import {
  BASE, record, results, sql, provisionOrg, cleanupOrgs, login, shot, setShotIndex, fillTrip, waitHydrated,
} from "./carpool-c5-lib.mjs";

const dep = new Date(Date.now() + 24 * 3600000);
dep.setHours(10, 0, 0, 0);
const orgs = [];
const browser = await chromium.launch({ headless: true });
const body = (page) => page.evaluate(() => document.body.innerText.toLowerCase());
const has = (t, n) => t.includes(n.toLowerCase());
async function newPage(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await login(page, user);
  return page;
}

try {
  setShotIndex(40);
  const OUT = await provisionOrg("o", [["rider", "employee"]]);
  const OFF = await provisionOrg("f", [["user", "employee"]]);
  orgs.push(OUT, OFF);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, carpool_enabled, carpool_first_enabled, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes)
    values ('${OFF.orgId}', 1, false, false, 15, 15, 5, 10)`);
  console.log(`\n=== C5 walkthrough #2 (${BASE}, invalid Google key) ===\n`);

  // -------------------------------------------------------- provider outage
  const rider = await newPage(OUT.users.rider);
  await fillTrip(rider, { departure: dep, origin: "Avenida Paulista, 1578, São Paulo", destination: "Aeroporto de Congonhas, São Paulo", passengers: 1 });
  await rider.waitForSelector('[data-testid="carpool-unavailable"]', { timeout: 90000 });
  const t = await body(rider);
  record("Provider outage: banner 'serviço de mapas do Google está indisponível' is shown", has(t, "serviço de mapas do Google está indisponível"));
  record("Provider outage: no carpool card, and nothing is guessed", (await rider.locator('[data-testid="carpool-offer-card"]').count()) === 0);
  await rider.waitForSelector("text=Veículo recomendado");
  record("Provider outage: the normal vehicle flow is untouched (vehicle recommended, host seat question present)", has(await body(rider), "veículo recomendado") && (await rider.locator('[data-testid="host-offer-step"]').count()) === 1);
  await shot(rider, "outage-banner-vehicle-flow-untouched");
  await rider.click("text=Solicitar reserva");
  await rider.waitForURL((u) => u.pathname === "/trips", { timeout: 60000 });
  const res = await sql(`select r.status from reservations r join trip_requests tr on tr.id=r.trip_request_id where tr.requester_id='${OUT.users.rider.id}'`);
  record("Provider outage: the vehicle reservation is still completable (reservation created)", res.length === 1 && res[0].status === "pending_approval", res);
  const offers = await sql(`select count(*) c from carpool_offers where organization_id='${OUT.orgId}'`);
  record("Answering 'No' (default) published no carpool offer", Number(offers[0].c) === 0);
  await shot(rider, "outage-reservation-created-on-trips");
  const noMatches = await sql(`select count(*) c from carpool_ride_requests where organization_id='${OUT.orgId}'`);
  record("Outage never created a ride request / match", Number(noMatches[0].c) === 0);

  // -------------------------------------------------------- carpool disabled by policy => today's behaviour
  const user = await newPage(OFF.users.user);
  await fillTrip(user, { departure: dep, origin: "Avenida Paulista, 1578, São Paulo", destination: "Aeroporto de Congonhas, São Paulo", passengers: 1 });
  await user.waitForSelector("text=Veículo recomendado", { timeout: 90000 });
  record("Carpool disabled by policy: the OLD consent checkbox is shown (today's behaviour)", (await user.locator('input[type="checkbox"][name="allowCarpool"]').count()) === 1);
  record("Carpool disabled by policy: no carpool-first panel and no host seat question", (await user.locator('[data-testid="carpool-first"]').count()) === 0 && (await user.locator('[data-testid="host-offer-step"]').count()) === 0);
  await shot(user, "carpool-disabled-policy-old-behaviour-unchanged");
  await user.click("text=Solicitar reserva");
  await user.waitForURL((u) => u.pathname === "/trips", { timeout: 60000 });
  const res2 = await sql(`select r.status from reservations r join trip_requests tr on tr.id=r.trip_request_id where tr.requester_id='${OFF.users.user.id}'`);
  record("Carpool disabled by policy: the reservation flow works exactly as before", res2.length === 1);
  const quota = await sql(`select count(*) c from geo_provider_quota_counters where organization_id='${OFF.orgId}'`);
  record("Carpool disabled by policy: no Google call was made for the org (Cost Guard counter untouched)", Number(quota[0].c) === 0, quota[0]);
} catch (e) {
  record("FATAL (unexpected exception)", false, String(e && e.stack ? e.stack : e));
} finally {
  await browser.close().catch(() => {});
  if (process.env.KEEP !== "1") await cleanupOrgs(orgs);
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== Summary ===");
  for (const r of failed) console.log("FAIL - " + r.name);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  process.exitCode = failed.length ? 1 : 0;
}
