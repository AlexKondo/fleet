// Phase C5 real-browser walk-through #1 (Playwright against `next dev` on BASE_URL, live Supabase
// + live Google). Covers: host offer step, carpool-first card + detour, request, host accept
// (seats decrement), rider status, incompatible rider, city-only / unresolvable clarification,
// reject with reason, rider cancel, policy admin (new version used by the next search),
// host cancel -> invalidation, cron route.
// Screenshots -> resultado_de_testes/carpool-c5/
import { chromium } from "playwright";
import {
  BASE, CRON_SECRET, PASSWORD, T, SHOTS, record, results, sql, provisionOrg, cleanupOrgs, login, shot, fillTrip, localIso, ROOT, waitHydrated,
} from "./carpool-c5-lib.mjs";

const HOST_ORIGIN = "Avenida Paulista, 1578, São Paulo";
const HOST_DEST = "Aeroporto de Congonhas, São Paulo";
// Real Google detours measured for this host trip (Paulista 1578 -> Congonhas, 9.7 km / 25.5 min):
//   pickup Paulista 1578 + drop Washington Luis 5000: +2.25 km / +7.8 min  (within 5 km / 10 min -> compatible)
//   pickup Paulista 2000 + drop Washington Luis 5000: +4.7 km / +20 min    (time detour too long -> incompatible)
const RIDER_ORIGIN = "Avenida Paulista, 1578, São Paulo";
const SLOW_ORIGIN = "Avenida Paulista, 2000, São Paulo";
const RIDER_DEST = "Avenida Washington Luís, 5000, São Paulo";
const FAR_DEST = "Terminal Rodoviário de Campinas, Campinas, SP";

const dep = new Date(Date.now() + 24 * 3600000);
dep.setHours(10, 0, 0, 0);
const dep10 = new Date(dep.getTime() + 10 * 60000);

const orgs = [];
const browser = await chromium.launch({ headless: true });
const ctxs = [];
async function newPage(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  ctxs.push(context);
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => console.log("    [pageerror]", String(e).slice(0, 400)));
  page.on("console", (m) => { if (m.type() === "error") console.log("    [console.error]", m.text().slice(0, 400)); });
  await login(page, user);
  return page;
}
// innerText applies CSS text-transform (headings are uppercase) -> body text is compared lower-cased
const body = (page) => page.evaluate(() => document.body.innerText.toLowerCase());
const has = (text, needle) => text.includes(needle.toLowerCase());

try {
  const A = await provisionOrg("a", [
    ["host", "employee"], ["rider1", "employee"], ["rider2", "employee"], ["rider3", "employee"], ["rider4", "employee"], ["mgr", "fleet_manager"], ["host2", "employee"], ["rider5", "employee"],
  ]);
  orgs.push(A);
  // The migration seeds policy v1 for existing orgs; do the same for this disposable one.
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
    values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);
  const U = A.users;
  console.log(`\n=== C5 walkthrough #1 (${BASE}) org=${A.orgId} ===\n`);

  // ------------------------------------------------------------ 1. HOST: vehicle + offer step
  const host = await newPage(U.host);
  await fillTrip(host, { departure: dep, origin: HOST_ORIGIN, destination: HOST_DEST, passengers: 1 });
  await host.waitForSelector('[data-testid="host-offer-step"]', { timeout: 90000 });
  const hostBody = await body(host);
  record("Host: carpool-first ran and showed the places the system understood (confirm labels)", (await host.locator('[data-testid="carpool-places"]').count()) === 1,
    { origin: await host.locator('[data-testid="carpool-origin-label"]').textContent(), destination: await host.locator('[data-testid="carpool-destination-label"]').textContent() });
  record("Host: vehicle recommended AFTER carpool-first, host question 'Deseja disponibilizar vagas para carona?' shown", has(hostBody, "Deseja disponibilizar vagas para carona?") && has(hostBody, "Veículo recomendado"));
  record("Host: the OLD allow_carpool consent checkbox is hidden (new Yes/No step is the only carpool question)", (await host.locator('input[type="checkbox"][name="allowCarpool"]').count()) === 0 && (await host.locator('input[type="hidden"][name="allowCarpool"]').count()) === 1);
  record("Host: default answer is No (no seats published unless the host opts in)", await host.locator('input[name="offerChoice"][value="no"]').isChecked());
  await shot(host, "host-vehicle-recommended-offer-step-default-no");
  await host.check('input[name="offerChoice"][value="yes"]');
  await host.waitForTimeout(800);
  const prefilled = await host.inputValue('input[name="offerSeats"]');
  record("Host: choosing Yes prefills the maximum safe seats (capacity 5 - declared 1 = 4)", prefilled === "4", { prefilled });
  await host.fill('input[name="offerSeats"]', "2");
  await shot(host, "host-offer-step-yes-2-seats");
  await host.click("text=Solicitar reserva");
  await host.waitForURL((u) => u.pathname === "/trips", { timeout: 60000 });
  await shot(host, "host-after-reservation-trips-list");
  const [hostTrip] = await sql(`select tr.id trip_id, r.id res_id from trip_requests tr join reservations r on r.trip_request_id=tr.id where tr.requester_id='${U.host.id}'`);
  const offer = (await sql(`select id, status, seats_offered, seats_available from carpool_offers where trip_request_id='${hostTrip.trip_id}'`))[0];
  record("Reservation created AND offer published for it (2 seats, active)", offer && offer.status === "active" && offer.seats_offered === 2 && offer.seats_available === 2, offer);

  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-host-section"]');
  const st = await host.locator('[data-testid="carpool-state"]').textContent();
  const seats = await host.locator('[data-testid="carpool-seats"]').textContent();
  record("My Trip (host): carpool enabled + seats offered/available visible", /ativa/i.test(st) && /2/.test(seats), { st, seats });
  await shot(host, "host-my-trip-offer-active-2-seats");

  // ------------------------------------------------------------ 2. RIDER1: compatible card -> request
  const rider1 = await newPage(U.rider1);
  await fillTrip(rider1, { departure: dep, origin: RIDER_ORIGIN, destination: RIDER_DEST, passengers: 1 });
  await rider1.waitForSelector('[data-testid="carpool-offer-card"], [data-testid="carpool-first"]', { timeout: 90000 });
  await rider1.waitForTimeout(1500);
  const cardCount = await rider1.locator('[data-testid="carpool-offer-card"]').count();
  const r1Body = await body(rider1);
  record("Rider (compatible): carpool card appears BEFORE any vehicle option", cardCount === 1 && !has(r1Body, "Veículo recomendado"), { cardCount });
  const cardText = await rider1.locator('[data-testid="carpool-offer-card"]').textContent();
  record("Card shows host departure time, estimated detour (km/min), seats available and a Request Ride action - nothing else",
    /Saída do motorista/.test(cardText) && /Desvio estimado: \+[\d.]+ km · \+\d+ min/.test(cardText) && /vagas? dispon/.test(cardText) && /Solicitar carona/.test(cardText), cardText.replace(/\n/g, " | "));
  record("Card does NOT expose the host's name, address or coordinates", !has(r1Body, U.host.fullName) && !/paulista|congonhas|washington|1578/i.test(cardText) && !/-?\d{2}\.\d{4,}/.test(cardText), undefined);
  record("Resolved canonical labels were shown back to the rider to confirm", (await rider1.locator('[data-testid="carpool-places"]').count()) === 1,
    { origin: await rider1.locator('[data-testid="carpool-origin-label"]').textContent(), destination: await rider1.locator('[data-testid="carpool-destination-label"]').textContent() });
  await shot(rider1, "rider-compatible-card-with-detour");
  // double click = double tap: must create ONE request
  await rider1.locator('[data-testid="carpool-offer-card"] button', { hasText: "Solicitar carona" }).dblclick();
  await rider1.waitForSelector("text=Aguardando a aprovação do motorista", { timeout: 90000 });
  await shot(rider1, "rider-request-sent-pending-host-approval");
  const r1Reqs = await sql(`select id, status, pickup_location->>'label' pl, dropoff_location->>'label' dl, match_additional_distance_km d, match_additional_time_min m from carpool_ride_requests where rider_id='${U.rider1.id}'`);
  record("Double-click on Request Ride created exactly ONE request, PENDING (real outcome shown: pending host approval)", r1Reqs.length === 1 && r1Reqs[0].status === "PENDING", r1Reqs);
  record("Request stores the confirmed pickup/drop-off labels and the server-computed detour", Boolean(r1Reqs[0].pl) && Boolean(r1Reqs[0].dl) && Number(r1Reqs[0].d) >= 0, r1Reqs[0]);

  // ------------------------------------------------------------ 3. RIDER4: incompatible, city-only, unresolvable
  const rider4 = await newPage(U.rider4);
  await fillTrip(rider4, { departure: dep, origin: RIDER_ORIGIN, destination: FAR_DEST, passengers: 1 });
  await rider4.waitForSelector("text=Veículo recomendado", { timeout: 90000 });
  const r4Body = await body(rider4);
  record("Incompatible rider (far destination): NO carpool card, no hint of the host's trip; vehicle flow shown", (await rider4.locator('[data-testid="carpool-offer-card"]').count()) === 0 && has(r4Body, "Nenhuma carona compatível") && !has(r4Body, U.host.fullName));
  await shot(rider4, "rider-incompatible-no-offer-vehicle-shown");

  await fillTrip(rider4, { departure: dep, origin: SLOW_ORIGIN, destination: RIDER_DEST, passengers: 1 });
  await rider4.waitForSelector("text=Veículo recomendado", { timeout: 90000 });
  record("Close-by rider whose detour is too long for the policy (+20 min > 10): route-based matching refuses it, NO card", (await rider4.locator('[data-testid="carpool-offer-card"]').count()) === 0 && has(await body(rider4), "Nenhuma carona compatível"));
  await shot(rider4, "rider-route-detour-too-long-no-offer");

  await fillTrip(rider4, { departure: dep, origin: RIDER_ORIGIN, destination: "São Paulo", passengers: 1 });
  await rider4.waitForSelector('[data-testid="carpool-needs-precision"], [data-testid="carpool-unavailable"]', { timeout: 90000 });
  const cityBody = await body(rider4);
  record("City-only destination ('São Paulo'): asks for a more precise place, does NOT guess, no carpool search result", has(cityBody, "Precisamos de um local mais preciso") && /apenas uma cidade/.test(cityBody) && (await rider4.locator('[data-testid="carpool-offer-card"]').count()) === 0);
  record("While clarification is pending the vehicle result is hidden until the rider explicitly continues", !has(cityBody, "Veículo recomendado"));
  await shot(rider4, "rider-city-only-destination-clarification");
  await rider4.click("text=Continuar sem buscar carona");
  await rider4.waitForSelector("text=Veículo recomendado");
  record("Rider can continue to the normal vehicle flow from the clarification prompt", true);
  await shot(rider4, "rider-clarification-continue-to-vehicle");

  await fillTrip(rider4, { departure: dep, origin: RIDER_ORIGIN, destination: "zzqxk wvbn 98765 asdfgh", passengers: 1 });
  await rider4.waitForSelector('[data-testid="carpool-needs-precision"], [data-testid="carpool-unavailable"]', { timeout: 90000 });
  const junkBody = await body(rider4);
  record("Unresolvable address: asks for a precise place and does not guess", /não encontramos|apenas uma cidade/.test(junkBody) && (await rider4.locator('[data-testid="carpool-offer-card"]').count()) === 0, junkBody.match(/Não encontramos[^\n]*|“[^\n]*apenas uma cidade[^\n]*/)?.[0]);
  await shot(rider4, "rider-unresolvable-address-clarification");

  // ------------------------------------------------------------ 4. HOST: accept
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-pending-request"]');
  const pendText = await host.locator('[data-testid="carpool-pending-request"]').textContent();
  record("My Trip (host): pending request shows rider name, seats, COARSE pickup/drop-off area (no street number), detour, Accept/Reject", pendText.includes(U.rider1.fullName) && /Aceitar/.test(pendText) && /Recusar/.test(pendText) && /Desvio estimado/.test(pendText) && /Região de embarque/.test(pendText) && !/1578/.test(pendText) && /Apenas a região aproximada/.test(pendText), pendText.replace(/\n/g, " | "));
  await shot(host, "host-pending-request-accept-reject");
  await host.click('[data-testid="carpool-pending-request"] button:has-text("Aceitar")');
  await host.waitForSelector('[data-testid="carpool-participants"]');
  const seatsAfter = await host.locator('[data-testid="carpool-seats"]').textContent();
  const offerAfter = (await sql(`select seats_available from carpool_offers where id='${offer.id}'`))[0];
  record("Host accepts: seats decrement 2 -> 1, rider listed as confirmed passenger", offerAfter.seats_available === 1 && /Vagas disponíveis: 1/.test(seatsAfter.replace(/\s+/g, " ")) && (await host.locator('[data-testid="carpool-participants"]').textContent()).includes(U.rider1.fullName), { db: offerAfter, ui: seatsAfter });
  await shot(host, "host-after-accept-seats-1-participant");

  // ------------------------------------------------------------ 5. RIDER1 status
  await rider1.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await rider1.waitForSelector('[data-testid="my-carpool-requests"]');
  const accStatus = await rider1.locator('[data-testid="my-carpool-request-status"]').first().textContent();
  const tripsBody = await body(rider1);
  const participantRow = (await sql(`select count(*) c from trip_participants where passenger_id='${U.rider1.id}' and status='accepted'`))[0];
  record("Rider status: request shows ACCEPTED (Aceita) on Trips", /Aceita/i.test(accStatus), accStatus);
  record("Accepted rider is listed ONCE: a trip_participants row exists but the legacy 'Caronas' list does not repeat it", Number(participantRow.c) === 1 && !/^Caronas$/m.test(tripsBody.split("\n").map((l) => l.trim()).filter((l) => l === "caronas").join("\n")) && (await rider1.locator('[data-testid="my-carpool-request"]').count()) === 1);
  await shot(rider1, "rider-trips-request-accepted");

  // ------------------------------------------------------------ 6. RIDER2: request -> host rejects with reason
  const rider2 = await newPage(U.rider2);
  await fillTrip(rider2, { departure: dep, origin: RIDER_ORIGIN, destination: RIDER_DEST, passengers: 1 });
  await rider2.waitForSelector('[data-testid="carpool-offer-card"]', { timeout: 90000 });
  await rider2.click('[data-testid="carpool-offer-card"] button:has-text("Solicitar carona")');
  await rider2.waitForSelector("text=Aguardando a aprovação do motorista", { timeout: 90000 });
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-pending-request"]');
  await host.fill('[data-testid="carpool-pending-request"] input[name="reason"]', "Sem espaço para bagagem");
  await shot(host, "host-reject-with-reason");
  await host.click('[data-testid="carpool-pending-request"] button:has-text("Recusar")');
  await host.waitForSelector('[data-testid="carpool-history"]');
  const histText = await host.locator('[data-testid="carpool-history"]').textContent();
  record("Host rejects with a reason: request moves to history as Recusada with the reason", /Recusada/.test(histText) && /Sem espaço para bagagem/.test(histText), histText.replace(/\n/g, " | "));
  await rider2.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await rider2.waitForSelector('[data-testid="my-carpool-request"]');
  const r2Text = await rider2.locator('[data-testid="my-carpool-request"]').textContent();
  record("Rider sees REJECTED (Recusada) with the host's reason", /Recusada/.test(r2Text) && /Sem espaço para bagagem/.test(r2Text), r2Text.replace(/\n/g, " | "));
  await shot(rider2, "rider-trips-request-rejected-with-reason");
  const rejRow = (await sql(`select status from carpool_ride_requests where rider_id='${U.rider2.id}'`))[0];
  record("Rejection kept the row (status REJECTED, never deleted)", rejRow.status === "REJECTED");

  // ------------------------------------------------------------ 7. RIDER3: request -> cancel
  const rider3 = await newPage(U.rider3);
  await fillTrip(rider3, { departure: dep, origin: RIDER_ORIGIN, destination: RIDER_DEST, passengers: 1 });
  await rider3.waitForSelector('[data-testid="carpool-offer-card"]', { timeout: 90000 });
  await rider3.click('[data-testid="carpool-offer-card"] button:has-text("Solicitar carona")');
  await rider3.waitForSelector("text=Aguardando a aprovação do motorista", { timeout: 90000 });
  await rider3.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await rider3.waitForSelector('[data-testid="my-carpool-request"]');
  await shot(rider3, "rider-trips-pending-request-with-cancel");
  await rider3.click('[data-testid="my-carpool-request"] button:has-text("Cancelar solicitação")');
  await rider3.waitForFunction(() => /Cancelada/i.test(document.body.innerText), null, { timeout: 30000 });
  await shot(rider3, "rider-trips-request-cancelled");
  const canRow = (await sql(`select status from carpool_ride_requests where rider_id='${U.rider3.id}'`))[0];
  record("Rider cancels their own pending request: status CANCELLED", canRow.status === "CANCELLED");

  // ------------------------------------------------------------ 7b. legacy pending request coexists on My Trip
  await sql(`insert into trip_participants (organization_id, trip_request_id, passenger_id, passenger_count, status) values ('${A.orgId}', '${hostTrip.trip_id}', '${U.rider4.id}', 1, 'pending')`);
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-host-section"]');
  const bothText = await body(host);
  const legacyCount = bothText.split(U.rider4.fullName.toLowerCase()).length - 1;
  record("My Trip shows the new-engine section AND the legacy pending block (transition), the legacy rider exactly once, flagged as 'fluxo anterior'",
    has(bothText, "Carona nesta viagem") && has(bothText, "Pedidos feitos pelo fluxo anterior de carona") && legacyCount === 1, { legacyCount });
  record("The legacy pending rider is NOT in the new engine's confirmed passengers or pending list", !(await host.locator('[data-testid="carpool-participants"]').innerText().catch(() => "")).includes(U.rider4.fullName) && (await host.locator('[data-testid="carpool-pending-request"]').count()) === 0);
  await shot(host, "host-my-trip-new-engine-and-legacy-pending-blocks");
  await sql(`delete from trip_participants where passenger_id='${U.rider4.id}'`);

  // ------------------------------------------------------------ 8. POLICY: new version used by the next search
  const rider4b = rider4;
  await fillTrip(rider4b, { departure: dep10, origin: RIDER_ORIGIN, destination: RIDER_DEST, passengers: 1 });
  await rider4b.waitForSelector('[data-testid="carpool-offer-card"], :text("Nenhuma carona compatível")', { timeout: 90000 });
  record("Policy v1 (departure window 15 min): a rider departing +10 min IS offered the carpool", (await rider4b.locator('[data-testid="carpool-offer-card"]').count()) === 1);
  await shot(rider4b, "policy-v1-window-15-plus-10min-card-shown");
  const mgr = await newPage(U.mgr);
  await mgr.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await mgr.waitForSelector('[data-testid="carpool-policy-section"]');
  await waitHydrated(mgr);
  const verText = await mgr.locator('[data-testid="carpool-policy-version"]').textContent();
  record("Admin screen shows the current policy version (1) and its values", /Versão em vigor: 1/.test(verText), verText);
  await shot(mgr, "admin-policy-screen-version-1");
  await mgr.fill('input[name="departureWindowMinutes"]', "5");
  await mgr.fill('input[name="maxAdditionalDistanceKm"]', "4.5");
  await mgr.click('button:has-text("Publicar nova versão")');
  await mgr.waitForSelector('[data-testid="carpool-policy-saved"]', { timeout: 30000 });
  await shot(mgr, "admin-policy-published-version-2");
  const pol = await sql(`select policy_version, departure_window_minutes, max_additional_distance_km from carpool_policy_settings where organization_id='${A.orgId}' order by policy_version`);
  record("Admin publishes a NEW version (insert-only): v1 untouched, v2 has window 5 / 4.5 km", pol.length === 2 && pol[0].departure_window_minutes === 15 && pol[1].departure_window_minutes === 5 && Number(pol[1].max_additional_distance_km) === 4.5, pol);
  const histItems = await mgr.locator('[data-testid="carpool-policy-history"] li').count();
  record("History lists both versions", histItems === 2, { histItems });
  // server-side validation (bypass the browser's min/max attributes)
  await mgr.evaluate(() => {
    const el = document.querySelector('input[name="maxAdditionalDistanceKm"]');
    el.removeAttribute("min");
    el.removeAttribute("max");
    el.value = "-3";
  });
  await mgr.click('button:has-text("Publicar nova versão")');
  await mgr.waitForSelector('[data-testid="carpool-policy-error"]', { timeout: 30000 });
  await shot(mgr, "admin-policy-invalid-value-refused-server-side");
  const polCount = (await sql(`select count(*) c from carpool_policy_settings where organization_id='${A.orgId}'`))[0].c;
  record("Invalid value (-3 km) refused server-side: no new version created", Number(polCount) === 2, { polCount });
  // an employee cannot reach the screen / the action
  const emp = await rider1.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  record("Employee is redirected away from /settings (no policy screen for non-managers)", !rider1.url().includes("/settings"), rider1.url());

  await fillTrip(rider4b, { departure: dep10, origin: RIDER_ORIGIN, destination: RIDER_DEST, passengers: 1 });
  await rider4b.waitForSelector("text=Nenhuma carona compatível", { timeout: 90000 });
  record("After publishing v2 (window 5 min) the NEXT search uses it: the +10 min rider no longer gets the carpool", (await rider4b.locator('[data-testid="carpool-offer-card"]').count()) === 0);
  await shot(rider4b, "policy-v2-window-5-plus-10min-no-card");

  // ------------------------------------------------------------ 9. HOST CANCELS -> invalidation visible
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-host-section"]');
  await host.click('button:has-text("Cancelar")');
  await host.waitForFunction(() => /Cancelad/i.test(document.body.innerText), null, { timeout: 30000 });
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-host-section"]');
  const hostHist = await host.locator('[data-testid="carpool-history"]').textContent();
  record("Host trip cancelled: host sees the accepted rider's request as Invalidada with the reason", /Invalidada/.test(hostHist) && /cancelou a viagem/.test(hostHist), hostHist.replace(/\n/g, " | "));
  record("Host section shows the offer as disabled", /desativada/i.test(await host.locator('[data-testid="carpool-state"]').textContent()));
  await shot(host, "host-after-trip-cancel-invalidated-with-reason");
  await rider1.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await rider1.waitForSelector('[data-testid="my-carpool-request"]');
  const r1After = await rider1.locator('[data-testid="my-carpool-request"]').textContent();
  record("Accepted rider is told the carpool was invalidated, with the reason (never silently stranded)", /Invalidada/.test(r1After) && /cancelou a viagem/.test(r1After), r1After.replace(/\n/g, " | "));
  await shot(rider1, "rider-trips-invalidated-host-cancelled-with-reason");
  const nCount = (await sql(`select count(*) c from notifications where user_id='${U.rider1.id}' and title='Carona invalidada'`))[0].c;
  record("Rider notified (in-app) about the invalidation", Number(nCount) === 1, { nCount });

  // ------------------------------------------------------------ 9b. host2: publish failure is NON-FATAL + retry; update / disable; auto-accept outcome
  const host2 = await newPage(U.host2);
  const dep14 = new Date(dep.getTime() + 4 * 3600000);
  await sql("alter table carpool_events add constraint c5ui_block check (event_type <> 'CarpoolOfferEnabled') not valid");
  try {
    await fillTrip(host2, { departure: dep14, origin: HOST_ORIGIN, destination: HOST_DEST, passengers: 1 });
    await host2.waitForSelector('[data-testid="host-offer-step"]', { timeout: 90000 });
    await host2.check('input[name="offerChoice"][value="yes"]');
    await host2.fill('input[name="offerSeats"]', "2");
    await host2.click("text=Solicitar reserva");
    await host2.waitForURL((u) => u.pathname.startsWith("/reservations/"), { timeout: 60000 });
  } finally {
    await sql("alter table carpool_events drop constraint if exists c5ui_block");
  }
  await host2.waitForSelector('[data-testid="carpool-publish-failed"]');
  const failTxt = await host2.locator('[data-testid="carpool-publish-failed"]').textContent();
  const [h2] = await sql(`select r.id res_id, tr.id trip_id, r.status from reservations r join trip_requests tr on tr.id=r.trip_request_id where tr.requester_id='${U.host2.id}'`);
  const h2Offers = await sql(`select count(*) c from carpool_offers where trip_request_id='${h2.trip_id}'`);
  record("Publishing failure is NON-FATAL: the reservation stands, no offer exists, and My Trip shows a notice with the retry controls",
    h2.status === "pending_approval" && Number(h2Offers[0].c) === 0 && /não foi possível publicar as vagas/i.test(failTxt) && (await host2.locator('button:has-text("Disponibilizar vagas")').count()) === 1, failTxt);
  await shot(host2, "host-publish-failed-reservation-stands-retry-available");
  await host2.fill('input[name="seats"]', "2");
  await host2.click('button:has-text("Disponibilizar vagas")');
  await host2.waitForSelector('[data-testid="carpool-state"]:has-text("Carona ativa")', { timeout: 30000 });
  record("Retry from My Trip publishes the offer (2 seats, active)", (await sql(`select seats_offered from carpool_offers where trip_request_id='${h2.trip_id}' and status='active'`))[0]?.seats_offered === 2);
  await host2.fill('input[name="seats"]', "3");
  await host2.click('button:has-text("Atualizar vagas")');
  await host2.waitForFunction(() => /Vagas oferecidas: 3/.test(document.body.innerText), null, { timeout: 30000 });
  record("Host updates seats from My Trip (2 -> 3)", (await sql(`select seats_offered, seats_available from carpool_offers where trip_request_id='${h2.trip_id}'`))[0].seats_available === 3);
  await shot(host2, "host-my-trip-update-seats-3");

  // auto-accept policy (host approval NOT required): the rider sees the real outcome 'confirmed'
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, host_approval_required, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
    values ('${A.orgId}', 3, false, 15, 15, 5, 15, 30)`);
  const rider5 = await newPage(U.rider5);
  await fillTrip(rider5, { departure: dep14, origin: RIDER_ORIGIN, destination: RIDER_DEST, passengers: 1 });
  await rider5.waitForSelector('[data-testid="carpool-offer-card"]', { timeout: 90000 });
  await rider5.click('[data-testid="carpool-offer-card"] button:has-text("Solicitar carona")');
  await rider5.waitForSelector("text=Carona confirmada", { timeout: 90000 });
  await shot(rider5, "rider-auto-accepted-outcome-confirmed");
  const r5 = (await sql(`select status, policy_version from carpool_ride_requests where rider_id='${U.rider5.id}'`))[0];
  const o5 = (await sql(`select seats_available from carpool_offers where trip_request_id='${h2.trip_id}'`))[0];
  record("Policy hostApprovalRequired=false: request is auto-ACCEPTED (policy v3 recorded), seat consumed, and the UI says 'Carona confirmada'", r5.status === "ACCEPTED" && r5.policy_version === 3 && o5.seats_available === 2, { r5, o5 });
  // host turns the carpool off: accepted rider is invalidated with the reason
  await host2.goto(`${BASE}/reservations/${h2.res_id}`, { waitUntil: "domcontentloaded" });
  await host2.waitForSelector('[data-testid="carpool-host-section"]');
  await host2.click('button:has-text("Desativar carona")');
  await host2.waitForSelector('[data-testid="carpool-state"]:has-text("Carona desativada")', { timeout: 30000 });
  await rider5.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await rider5.waitForSelector('[data-testid="my-carpool-request"]');
  const r5Txt = await rider5.locator('[data-testid="my-carpool-request"]').textContent();
  record("Host turns the carpool off: the accepted rider sees Invalidada with 'O motorista desativou a carona.'", /Invalidada/i.test(r5Txt) && /desativou a carona/i.test(r5Txt), r5Txt);
  await shot(rider5, "rider-invalidated-offer-disabled-by-host");

  // ------------------------------------------------------------ 10. cron route
  const noAuth = await fetch(`${BASE}/api/cron/carpool-expiry`);
  const authed = await fetch(`${BASE}/api/cron/carpool-expiry`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  const cronBody = await authed.json();
  record("Cron route: 401 without the secret, 200 with it (sweep incl. reconcile pass runs)", noAuth.status === 401 && authed.status === 200 && typeof cronBody.expired === "number", { noAuth: noAuth.status, authed: authed.status, cronBody });
  const vj = JSON.parse((await import("node:fs")).readFileSync(`${ROOT}/vercel.json`, "utf8"));
  // (stale assertion fixed in C7a: since the cron consolidation the daily dispatcher /api/cron/daily runs the expiry sweep)
  record("vercel.json keeps exactly one daily cron (the /api/cron/daily dispatcher)", vj.crons.length === 1 && vj.crons[0].path === "/api/cron/daily" && vj.crons[0].schedule === "0 12 * * *", vj.crons);
} catch (e) {
  record("FATAL (unexpected exception)", false, String(e && e.stack ? e.stack : e));
  try {
    for (const c of ctxs) for (const p of c.pages()) await p.screenshot({ path: `${SHOTS}/zz-failure-${Date.now()}.png`, fullPage: true }).catch(() => {});
  } catch { /* ignore */ }
} finally {
  await sql("alter table carpool_events drop constraint if exists c5ui_block").catch(() => {});
  await browser.close().catch(() => {});
  if (process.env.KEEP !== "1") await cleanupOrgs(orgs);
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== Summary ===");
  for (const r of failed) console.log("FAIL - " + r.name);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  process.exitCode = failed.length ? 1 : 0;
}
