// Phase C6 real-browser walk-through of the CHAT (Playwright against `next dev` on BASE_URL, live
// Supabase + live Google + live Claude). Everything is typed into the chat panel like a user would.
// Voice (microphone) cannot be driven headlessly: ChatPanel's SpeechRecognition only fills the same
// textarea that is typed into here, so voice shares exactly this text pipeline.
// Screenshots -> resultado_de_testes/carpool-c6/
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BASE, ROOT, T, URL_, SVC, record, results, sql, provisionOrg, cleanupOrgs, login } from "./carpool-c5-lib.mjs";

const SHOTS = path.join(ROOT, "resultado_de_testes", "carpool-c6");
mkdirSync(SHOTS, { recursive: true });
let shotIndex = 0;
async function shot(page, name, { full = false } = {}) {
  shotIndex += 1;
  const file = path.join(SHOTS, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
  if (full) await page.screenshot({ path: file, fullPage: true });
  else await page.screenshot({ path: file });
  console.log("    screenshot: resultado_de_testes/carpool-c6/" + path.basename(file));
}

const HOST_ORIGIN = "Avenida Paulista, 1578, São Paulo";
const HOST_DEST = "Aeroporto de Congonhas, São Paulo";
const RIDER_DEST = "Avenida Washington Luís, 5000, São Paulo";

const orgs = [];
const browser = await chromium.launch({ headless: true });
const lastSent = new Map();

async function newPage(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("    [pageerror]", String(e).slice(0, 300)));
  await login(page, user);
  page.__user = user;
  return page;
}
const dialog = (page) => page.locator('[role="dialog"][aria-label="Assistente Fleet"]');
async function openChat(page) {
  await page.waitForSelector('button[type="button"][aria-label="Assistente Fleet"]', { timeout: 60000 });
  await page.waitForTimeout(1200); // hydration
  await page.click('button[type="button"][aria-label="Assistente Fleet"]');
  await dialog(page).waitFor({ state: "visible" });
}
const bubbles = (page) => dialog(page).locator('div[class*="max-w-[85%]"]');
async function lastBubble(page) {
  const n = await bubbles(page).count();
  return n ? (await bubbles(page).nth(n - 1).innerText()).trim() : "";
}
async function cardText(page) {
  const c = dialog(page).locator("p.text-gwm-accent");
  return (await c.count()) ? (await c.first().innerText()).trim() : null;
}
async function settle(page) {
  // wait for the "Pensando..." indicator to appear (briefly) and then disappear
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.body.innerText.includes("Pensando..."), null, { timeout: 150000 });
  await page.waitForTimeout(600);
}
/** Types a message into the chat textarea and sends it, respecting the 6/30s burst limit. */
async function say(page, text) {
  const key = page.__user.id;
  const wait = 7000 - (Date.now() - (lastSent.get(key) ?? 0));
  if (wait > 0) await page.waitForTimeout(wait);
  const ta = dialog(page).locator("textarea");
  await ta.fill(text);
  await dialog(page).getByRole("button", { name: "Enviar" }).click();
  lastSent.set(key, Date.now());
  await settle(page);
  return lastBubble(page);
}
async function clickInChat(page, label) {
  await dialog(page).getByRole("button", { name: label, exact: true }).click();
  lastSent.set(page.__user.id, Date.now());
  await settle(page);
}
const optionButtons = async (page) => dialog(page).locator('[data-testid="chat-carpool-option"]').allInnerTexts();

try {
  const A = await provisionOrg("c6", [
    ["host", "employee"], ["host2", "employee"], ["rider1", "employee"], ["rider2", "employee"], ["rider3", "employee"], ["carla", "employee"],
  ]);
  orgs.push(A);
  const U = A.users;
  // Real first names so "aceita a carona da Ana" is speakable.
  const names = { host: "Henrique Teste", host2: "Helena Teste", rider1: "Ana Silva", rider2: "Bruno Lima", rider3: "Ana Costa", carla: "Carla Dias" };
  for (const [k, n] of Object.entries(names)) {
    await sql(`update profiles set full_name='C6 ${n}' where id='${U[k].id}'`);
    U[k].first = n.split(" ")[0];
  }
  // two more vehicles (host, host2, carla need one each, plus spare)
  const [cat] = await sql(`select id from vehicle_categories where organization_id='${A.orgId}' limit 1`);
  for (const n of [3, 4]) {
    await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km)
      values ('${A.orgId}', 'C6V${n}${T.slice(-3).toUpperCase()}', '${cat.id}', 'available', 1000, 80, 600, 20000)`);
  }
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes)
    values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);
  console.log(`\n=== C6 chat walkthrough (${BASE}) org=${A.orgId} ===\n`);

  const tripOf = async (uid) => (await sql(`select tr.id trip_id, r.id res_id, r.status from trip_requests tr join reservations r on r.trip_request_id=tr.id where tr.requester_id='${uid}' order by tr.created_at desc limit 1`))[0];
  const offerOf = async (tripId) => (await sql(`select id, status, seats_offered, seats_available from carpool_offers where trip_request_id='${tripId}' order by created_at desc limit 1`))[0];
  const reqOf = async (riderId) => (await sql(`select id, status, status_reason, carpool_offer_id, requested_seats from carpool_ride_requests where rider_id='${riderId}' order by created_at desc`));

  // ------------------------------------------------ 1. HOST: normal vehicle reservation by chat
  const host = await newPage(U.host);
  await openChat(host);
  let a = await say(host, `Reserva um carro para amanhã às 10h, saindo da ${HOST_ORIGIN}, indo para o ${HOST_DEST}, retorno às 18h, só eu de passageiro.`);
  record("Chat reservation (engine active): the assistant asks the NEW host question (offer seats?) instead of the old consent wording", /vagas para carona/i.test(a), a);
  await shot(host, "host-chat-asks-offer-seats-question");
  a = await say(host, "Sim, quero oferecer 1 vaga de carona.");
  let card = await cardText(host);
  record("Chat reservation: confirmation card names the actual vehicle + trip, no carpool offers exist yet so NO options (vehicle flow unchanged); states 1 seat will be published", Boolean(card) && /Vou reservar o veículo/.test(card) && /Depois da reserva, vou disponibilizar 1 vaga para carona/.test(card) && (await optionButtons(host)).length === 0, card);
  await shot(host, "host-chat-vehicle-confirmation-card");
  await clickInChat(host, "Confirmar");
  a = await lastBubble(host);
  const hostTrip = await tripOf(U.host.id);
  const hostOffer0 = hostTrip && (await offerOf(hostTrip.trip_id));
  record("Chat reservation confirmed -> real reservation (pending approval) AND the 1-seat offer published", /Reserva criada/.test(a) && /Vagas de carona publicadas: 1 vaga/.test(a) && hostOffer0?.status === "active" && hostOffer0.seats_offered === 1, { a, hostTrip, hostOffer0 });
  await shot(host, "host-chat-reservation-created");

  // ------------------------------------------------ 2. HOST2: reservation by chat + "Yes, offer 2 seats"
  const host2 = await newPage(U.host2);
  await openChat(host2);
  a = await say(host2, `Reserva um carro para amanhã às 10h05, saindo da ${HOST_ORIGIN}, indo para o ${HOST_DEST}, retorno às 18h, só eu de passageiro.`);
  a = await say(host2, "Sim, quero oferecer 2 vagas de carona.");
  const h2opts = await optionButtons(host2);
  record("Chat reservation + carpool-first: host2's route matches host's published offer -> shown as option 1 next to 'Usar um veículo' BEFORE any vehicle card", h2opts.length === 2 && /^1\. Saída 10:00/.test(h2opts[0]) && /^2\. Usar um veículo/.test(h2opts[1]), h2opts);
  await shot(host2, "host2-chat-reservation-carpool-first-options");
  await dialog(host2).locator('[data-testid="chat-carpool-option"]').nth(1).click();
  lastSent.set(U.host2.id, Date.now());
  await settle(host2);
  card = await cardText(host2);
  record("Chat reservation with host answer Yes: the card says exactly how many seats will be published afterwards", Boolean(card) && /Depois da reserva, vou disponibilizar 2 vagas para carona/.test(card), card);
  await shot(host2, "host2-chat-reservation-card-offers-2-seats");
  await clickInChat(host2, "Confirmar");
  a = await lastBubble(host2);
  const host2Trip = await tripOf(U.host2.id);
  const host2Offer = host2Trip && (await offerOf(host2Trip.trip_id));
  record("Reservation created AND the offer was published through enable_carpool_offer (2 seats, active), message says so", /Reserva criada/.test(a) && /Vagas de carona publicadas: 2 vagas/.test(a) && host2Offer?.status === "active" && host2Offer.seats_offered === 2, { a, host2Offer });
  await shot(host2, "host2-chat-reservation-created-offer-published");

  // ------------------------------------------------ 3. HOST: OFFER_CARPOOL by chat
  a = await say(host, "Fleet, pode oferecer duas vagas na minha viagem de amanhã.");
  card = await cardText(host);
  record("OFFER_CARPOOL ('duas vagas'): the card says it will CHANGE the existing 1-seat offer to 2 seats on the trip to Congonhas; nothing changes before Confirmar", Boolean(card) && /Vou alterar a oferta de carona da sua viagem para Aeroporto de Congonhas.*para 2 vagas/.test(card) && (await offerOf(hostTrip.trip_id)).seats_offered === 1, card);
  await shot(host, "host-offer-carpool-confirmation-card");
  await clickInChat(host, "Confirmar");
  a = await lastBubble(host);
  const hostOffer = await offerOf(hostTrip.trip_id);
  record("OFFER_CARPOOL confirmed -> the offer is ACTIVE with 2 seats in the DB (update_carpool_offer path)", /Oferta atualizada: 2 vagas/.test(a) && hostOffer?.status === "active" && hostOffer.seats_offered === 2 && hostOffer.seats_available === 2, { a, hostOffer });
  await shot(host, "host-offer-carpool-done");
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-host-section"]');
  const st = await host.locator('[data-testid="carpool-state"]').textContent();
  const seatsTxt = await host.locator('[data-testid="carpool-seats"]').textContent();
  record("My Trip (host) shows the offer made by chat: enabled, 2 seats", /ativa/i.test(st) && /2/.test(seatsTxt), { st, seatsTxt });
  await shot(host, "host-my-trip-offer-created-by-chat", { full: true });

  // ------------------------------------------------ 4. RIDER1: FIND -> numbered options -> request
  const rider1 = await newPage(U.rider1);
  await openChat(rider1);
  a = await say(rider1, "Tem carona saindo amanhã às 10h?");
  record("FIND_CARPOOL with the destination missing -> ONE focused clarification (asks the destination), nothing searched", /destin|para onde|onde/i.test(a), a);
  await shot(rider1, "rider-find-missing-destination-clarification");
  a = await say(rider1, `Tem alguém indo para a ${RIDER_DEST} amanhã às 10h, saindo da ${HOST_ORIGIN}?`);
  const opts = await optionButtons(rider1);
  const optCard = await cardText(rider1);
  record("FIND_CARPOOL: compatible offers presented as NUMBERED options (departure time, detour, seats only)", opts.length === 2 && /^1\. Saída 10:00 · desvio \+[\d.]+ km \/ \+\d+ min · 2 vagas/.test(opts[0]) && /^2\. Saída 10:05/.test(opts[1]), { opts, optCard });
  record("Options expose no host name / address / coordinates", !/Henrique|Helena|paulista|congonhas|washington|-?\d{2}\.\d{4,}/i.test(opts.join(" ")), opts);
  await shot(rider1, "rider-find-numbered-compatible-options");
  const noRequestYet = (await reqOf(U.rider1.id)).length === 0;
  await dialog(rider1).locator('[data-testid="chat-carpool-option"]').first().click();
  lastSent.set(U.rider1.id, Date.now());
  await settle(rider1);
  card = await cardText(rider1);
  record("Choosing option 1 builds the REQUEST confirmation card: 'Vou solicitar 1 vaga na carona com saída às 10:00, desvio estimado X km' (nothing requested yet)", noRequestYet && /Vou solicitar 1 vaga na carona com saída às 10:00, desvio estimado de [\d.]+ km \(cerca de \d+ min\)/.test(card ?? "") && (await reqOf(U.rider1.id)).length === 0, card);
  await shot(rider1, "rider-request-confirmation-card");
  await clickInChat(rider1, "Confirmar");
  a = await lastBubble(rider1);
  const r1 = await reqOf(U.rider1.id);
  record("REQUEST confirmed -> request PENDING on the 10:00 host's offer; the rider is told it awaits approval", /Aguardando a aprovação do motorista/.test(a) && r1.length === 1 && r1[0].status === "PENDING" && r1[0].carpool_offer_id === hostOffer.id && r1[0].requested_seats === 1, { a, r1 });
  await shot(rider1, "rider-request-sent-pending");

  // ------------------------------------------------ 5. RIDER2: city-only clarification, bare-number reply, Alterar, Cancelar
  const rider2 = await newPage(U.rider2);
  await openChat(rider2);
  a = await say(rider2, `Tem alguém indo para São Paulo amanhã às 10h, saindo da ${HOST_ORIGIN}?`);
  record("City-only destination ('São Paulo') -> asks for a more precise place, NEVER guesses, no options shown", /apenas uma cidade/.test(a) && /destino/i.test(a) && (await optionButtons(rider2)).length === 0 && (await reqOf(U.rider2.id)).length === 0, a);
  await shot(rider2, "rider-city-only-needs-precise-place");
  a = await say(rider2, `Tem alguém indo para a ${RIDER_DEST} amanhã às 10h, saindo da ${HOST_ORIGIN}?`);
  const opts2 = await optionButtons(rider2);
  record("After the precise place the same search yields numbered options", opts2.length >= 1, opts2);
  a = await say(rider2, "2");
  card = await cardText(rider2);
  record("A bare-number reply ('2') picks option 2 (the 10:05 carpool) and shows its request card", /saída às 10:05/.test(card ?? ""), card);
  await shot(rider2, "rider2-number-reply-selects-option-2");
  await clickInChat(rider2, "Alterar");
  record("'Alterar' drops the card client-side and asks what to change (no request created)", /o que você gostaria de alterar/i.test(await lastBubble(rider2)) && (await reqOf(U.rider2.id)).length === 0);
  a = await say(rider2, `Tem alguém indo para a ${RIDER_DEST} amanhã às 10h, saindo da ${HOST_ORIGIN}?`);
  a = await say(rider2, "1");
  await clickInChat(rider2, "Cancelar");
  record("'Cancelar' discards the card: no request exists", (await reqOf(U.rider2.id)).length === 0);
  await shot(rider2, "rider2-cancelled-no-request");

  // rider3 (a second 'Ana') has a pending request on the host's offer too (created through the same service-role RPC the app uses)
  {
    const dep = (await sql(`select departure_at from trip_requests where id='${hostTrip.trip_id}'`))[0].departure_at;
    const res = await fetch(URL_ + "/rest/v1/rpc/create_carpool_ride_request_as_rider", {
      method: "POST",
      headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_rider_id: U.rider3.id, p_offer_id: hostOffer.id, p_seats: 1,
        p_pickup: { coordinates: { lat: -23.55, lng: -46.63 }, source: "manual_lat_lng", label: "Pickup C6" },
        p_dropoff: { coordinates: { lat: -23.56, lng: -46.64 }, source: "manual_lat_lng", label: "Dropoff C6" },
        p_requested_departure_at: dep, p_client_request_id: crypto.randomUUID(),
        p_match_additional_distance_km: 1.2, p_match_additional_time_min: 3,
      }),
    });
    if (!res.ok) throw new Error("rider3 request failed " + (await res.text()));
  }

  // ------------------------------------------------ 6. HOST: ACCEPT by chat (ambiguous 'Ana', then full name)
  await host.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await openChat(host);
  a = await say(host, "Pode aceitar a carona da Ana.");
  record("ACCEPT 'a carona da Ana' is AMBIGUOUS (two pending Anas on the host's own offers): asks which, never guesses, no card", /Ana Silva/.test(a) && /Ana Costa/.test(a) && (await cardText(host)) === null, a);
  await shot(host, "host-accept-ambiguous-ana");
  a = await say(host, "Aceita a carona da Ana Silva.");
  card = await cardText(host);
  record("ACCEPT with the full name: confirmation card 'Vou aceitar o pedido de carona de Ana Silva (1 vaga)...'; nothing accepted before Confirmar", /Vou aceitar o pedido de carona de C6 Ana Silva \(1 vaga\)/.test(card ?? "") && (await reqOf(U.rider1.id))[0].status === "PENDING", card);
  await shot(host, "host-accept-confirmation-card");
  await clickInChat(host, "Confirmar");
  a = await lastBubble(host);
  const afterAccept = { req: (await reqOf(U.rider1.id))[0], offer: await offerOf(hostTrip.trip_id) };
  record("ACCEPT confirmed -> request ACCEPTED and the offer's available seats DECREMENTED 2 -> 1", /aceito/.test(a) && afterAccept.req.status === "ACCEPTED" && afterAccept.offer.seats_available === 1, { a, afterAccept });
  await shot(host, "host-accept-done");
  a = await say(host, "Recusa a carona da Ana Costa, meu carro está cheio.");
  card = await cardText(host);
  record("REJECT: card 'Vou recusar o pedido de carona de Ana Costa.'", /Vou recusar o pedido de carona de C6 Ana Costa/.test(card ?? ""), card);
  await clickInChat(host, "Confirmar");
  const rej = (await reqOf(U.rider3.id))[0];
  record("REJECT confirmed -> request REJECTED (never deleted), reason stored; seats unchanged", rej.status === "REJECTED" && /cheio/i.test(rej.status_reason ?? "") && (await offerOf(hostTrip.trip_id)).seats_available === 1, rej);
  await shot(host, "host-reject-done");
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-host-section"]');
  await shot(host, "host-my-trip-after-accept-and-reject", { full: true });

  // ------------------------------------------------ 7. RIDER1: CANCEL by chat
  await rider1.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await openChat(rider1);
  a = await say(rider1, "Cancela minha carona de amanhã.");
  card = await cardText(rider1);
  record("CANCEL_CARPOOL_REQUEST: card says the already accepted seat will be released", /Vou cancelar sua carona já aceita/.test(card ?? "") && /vaga será liberada/.test(card ?? ""), card);
  await shot(rider1, "rider-cancel-confirmation-card");
  await clickInChat(rider1, "Confirmar");
  a = await lastBubble(rider1);
  record("CANCEL confirmed -> request CANCELLED, seat returned to the offer (1 -> 2)", /cancelada/i.test(a) && (await reqOf(U.rider1.id))[0].status === "CANCELLED" && (await offerOf(hostTrip.trip_id)).seats_available === 2, { a });
  await shot(rider1, "rider-cancel-done");

  // ------------------------------------------------ 8. HOST: DISABLE by chat
  await host.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded" });
  await openChat(host);
  a = await say(host, "Desativa a carona da minha viagem de amanhã.");
  card = await cardText(host);
  record("DISABLE_CARPOOL: card states pending/accepted requests will be invalidated; still active before Confirmar", /Vou desativar as vagas de carona da sua viagem/.test(card ?? "") && (await offerOf(hostTrip.trip_id)).status === "active", card);
  await shot(host, "host-disable-confirmation-card");
  await clickInChat(host, "Confirmar");
  a = await lastBubble(host);
  record("DISABLE confirmed -> offer DISABLED in the DB", /Carona desativada/.test(a) && (await offerOf(hostTrip.trip_id)).status === "disabled", a);
  await shot(host, "host-disable-done");
  await host.goto(`${BASE}/reservations/${hostTrip.res_id}`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector('[data-testid="carpool-host-section"]');
  await shot(host, "host-my-trip-offer-disabled", { full: true });

  // ------------------------------------------------ 9. CARLA: chat reservation with carpool-first
  const carla = await newPage(U.carla);
  await openChat(carla);
  a = await say(carla, `Reserva um carro para amanhã às 10h, saindo da ${HOST_ORIGIN}, indo para a ${RIDER_DEST}, retorno às 18h, não vou oferecer vagas.`);
  const cfOpts = await optionButtons(carla);
  record("Chat CREATE_RESERVATION with carpool-first: compatible offer shown as option 1 next to 'Usar um veículo' (no vehicle reserved yet)", cfOpts.length === 2 && /^1\. Saída 10:05/.test(cfOpts[0]) && /^2\. Usar um veículo/.test(cfOpts[1]) && !(await tripOf(U.carla.id)), { cfOpts, a: await cardText(carla) });
  await shot(carla, "carla-chat-reservation-carpool-first-options");
  await dialog(carla).locator('[data-testid="chat-carpool-option"]').nth(1).click();
  lastSent.set(U.carla.id, Date.now());
  await settle(carla);
  card = await cardText(carla);
  record("Choosing 'Usar um veículo' -> the normal vehicle card (same flow as before)", /Vou reservar o veículo/.test(card ?? ""), card);
  await shot(carla, "carla-use-vehicle-normal-card");
  await clickInChat(carla, "Confirmar");
  a = await lastBubble(carla);
  record("Vehicle reservation by chat completes end to end (reservation exists in the DB)", /Reserva criada/.test(a) && Boolean(await tripOf(U.carla.id)), a);
  await shot(carla, "carla-vehicle-reservation-created");

  // ------------------------------------------------ 9b. HOST: OFFER_CARPOOL again = ENABLE path (the offer is disabled)
  await openChat(host);
  a = await say(host, "Fleet, pode oferecer duas vagas na minha viagem de amanhã.");
  card = await cardText(host);
  record("OFFER_CARPOOL on a trip whose offer was disabled: card says it will make 2 seats available (enable path)", /Vou disponibilizar 2 vagas para carona na sua viagem/.test(card ?? ""), card);
  await shot(host, "host-offer-again-enable-confirmation-card");
  await clickInChat(host, "Confirmar");
  a = await lastBubble(host);
  const reEnabled = await offerOf(hostTrip.trip_id);
  record("Confirmed -> the SAME offer is ACTIVE again with 2 seats", /Pronto: 2 vagas disponíveis/.test(a) && reEnabled.status === "active" && reEnabled.seats_available === 2 && reEnabled.id === hostOffer.id, { a, reEnabled });
  await shot(host, "host-offer-again-done");

  // ------------------------------------------------ 10. DB-level confirmation that nothing mutated without Confirmar
  const audit = await sql(`select action, count(*) c from audit_log where organization_id='${A.orgId}' and action like 'carpool_%' group by action order by action`);
  record("Audit trail has the carpool lifecycle rows produced through the chat (offer enabled x2, accepted, rejected, cancelled, offer disabled, request created)", audit.length >= 5, audit);
} catch (e) {
  record("FATAL (unexpected exception)", false, String(e && e.stack ? e.stack : e));
  try {
    for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${SHOTS}/zz-failure-${Date.now()}.png`, fullPage: true }).catch(() => {});
  } catch { /* ignore */ }
} finally {
  await browser.close().catch(() => {});
  if (process.env.KEEP !== "1") {
    try {
      for (const o of orgs) {
        await sql(`delete from chat_messages where conversation_id in (select id from chat_conversations where organization_id='${o.orgId}')`);
        await sql(`delete from chat_conversations where organization_id='${o.orgId}'`);
      }
    } catch (e) { console.log("chat cleanup:", String(e)); }
    await cleanupOrgs(orgs);
    for (const o of orgs) {
      const left = await sql(`select (select count(*) from chat_conversations where organization_id='${o.orgId}') chat_conversations, (select count(*) from chat_messages where conversation_id in (select id from chat_conversations where organization_id='${o.orgId}')) chat_messages`);
      record("Cleanup: no chat rows left", Object.values(left[0]).every((v) => Number(v) === 0), left[0]);
    }
  }
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== Summary ===");
  for (const r of failed) console.log("FAIL - " + r.name);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  process.exitCode = failed.length ? 1 : 0;
}
