// C6 follow-up browser checks (F1 reload, F4 layout at 390/360px, F6 bare-number replies).
// Real Chromium against next dev (BASE_URL), live Supabase/Google/Claude. Screenshots -> resultado_de_testes/carpool-c6/followup-*
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BASE, ROOT, T, record, results, sql, provisionOrg, cleanupOrgs, login } from "./carpool-c5-lib.mjs";

const SHOTS = path.join(ROOT, "resultado_de_testes", "carpool-c6");
mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, `followup-${name}.png`) });
  console.log("    screenshot: resultado_de_testes/carpool-c6/followup-" + name + ".png");
};
const ORIGIN = "Avenida Paulista, 1578, São Paulo";
const DEST = "Avenida Washington Luís, 5000, São Paulo";

const orgs = [];
const browser = await chromium.launch({ headless: true });
const last = new Map();
const dlg = (p) => p.locator('[role="dialog"][aria-label="Assistente Fleet"]');
async function open(p) {
  await p.waitForSelector('button[type="button"][aria-label="Assistente Fleet"]', { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.click('button[type="button"][aria-label="Assistente Fleet"]');
  await dlg(p).waitFor({ state: "visible" });
}
const settle = async (p) => {
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => !document.body.innerText.includes("Pensando..."), null, { timeout: 150000 });
  await p.waitForTimeout(600);
};
async function say(p, text) {
  const wait = 7000 - (Date.now() - (last.get(p.__u) ?? 0));
  if (wait > 0) await p.waitForTimeout(wait);
  await dlg(p).locator("textarea").fill(text);
  await dlg(p).getByRole("button", { name: "Enviar" }).click();
  last.set(p.__u, Date.now());
  await settle(p);
}
const opts = (p) => dlg(p).locator('[data-testid="chat-carpool-option"]').allInnerTexts();
const card = async (p) => ((await dlg(p).locator("p.text-gwm-accent").count()) ? (await dlg(p).locator("p.text-gwm-accent").first().innerText()).trim() : null);
const hasBtn = async (p, n) => (await dlg(p).getByRole("button", { name: n, exact: true }).count()) > 0;
const taEnabled = (p) => dlg(p).locator("textarea").isEnabled();
async function page(user, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "pt-BR" });
  const p = await ctx.newPage();
  await login(p, user);
  p.__u = user.id;
  return p;
}
async function overflowing(p) {
  // true when any button of the confirmation card is clipped by the panel
  return p.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const r = d.getBoundingClientRect();
    return [...d.querySelectorAll("button")].filter((b) => b.offsetParent).some((b) => { const x = b.getBoundingClientRect(); return x.right > r.right + 0.5 || x.left < r.left - 0.5; });
  });
}

try {
  const A = await provisionOrg("c6f", [["host", "employee"], ["rider", "employee"], ["carla", "employee"]]);
  orgs.push(A);
  const U = A.users;
  const [cat] = await sql(`select id from vehicle_categories where organization_id='${A.orgId}' limit 1`);
  for (const n of [3, 4]) await sql(`insert into vehicles (organization_id, plate, category_id, status, odometer_km, fuel_level_percent, estimated_range_km, next_service_odometer_km) values ('${A.orgId}', 'C6F${n}${T.slice(-3).toUpperCase()}', '${cat.id}', 'available', 1000, 80, 600, 20000)`);
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);
  await sql(`update organization_settings set booking_mode='user_choice' where organization_id='${A.orgId}'`);
  // host trip tomorrow 10:00 Brasília + an ACTIVE offer (2 seats), set up directly (this script tests the chat UI, not the host flow)
  const day = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const dep = new Date(`${day}T10:00:00-03:00`);
  const ret = new Date(`${day}T18:00:00-03:00`);
  const [t] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${A.orgId}', '${U.host.id}', '${dep.toISOString()}', '${ret.toISOString()}', 'Avenida Paulista, 1578, São Paulo', 'Aeroporto de Congonhas, São Paulo', 10, 1, 'C6F') returning id`);
  await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${A.orgId}', '${A.vehicles[0].id}', '${t.id}', 'confirmed', '${dep.toISOString()}', '${ret.toISOString()}')`);
  await sql(`insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) values ('${A.orgId}', '${t.id}', '${U.host.id}', 'active', 2, 2, 1)`);
  console.log(`\n=== C6 follow-up browser checks (${BASE}) org=${A.orgId} ===\n`);

  // ---------------- F1(a)+F6(carpool)+F4: rider, 390px
  const rider = await page(U.rider, { width: 390, height: 844 });
  await open(rider);
  await say(rider, `Tem alguém indo para a ${DEST} amanhã às 10h, saindo da ${ORIGIN}?`);
  let o = await opts(rider);
  record("[F1a] FIND options shown before reload", o.length === 1, o);
  await rider.reload({ waitUntil: "domcontentloaded" });
  await open(rider);
  o = await opts(rider);
  record("[F1a] after RELOAD the numbered options are still there (buttons restored, text box usable, no Confirmar)", o.length === 1 && (await taEnabled(rider)) && !(await hasBtn(rider, "Confirmar")), o);
  await shot(rider, "reload-find-options-390px");
  await say(rider, "1"); // bare number AFTER reload
  let c = await card(rider);
  record("[F1a][F6] typing '1' after the reload selects the option -> REQUEST card (not 'no recent search')", /Vou solicitar 1 vaga na carona/.test(c ?? ""), c);
  record("[F4] 3-button card at 390px: Confirmar/Alterar/Cancelar all fully inside the panel", (await hasBtn(rider, "Cancelar")) && !(await overflowing(rider)));
  record("[F6] a plain Confirmar/Alterar/Cancelar card (no options) keeps the text box DISABLED", !(await taEnabled(rider)));
  await shot(rider, "confirmation-card-390px");
  await rider.setViewportSize({ width: 360, height: 740 });
  await rider.waitForTimeout(500);
  await dlg(rider).locator("div.overflow-y-auto").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  record("[F4] same card at 360px: nothing clipped", !(await overflowing(rider)));
  await shot(rider, "confirmation-card-360px");
  await rider.setViewportSize({ width: 1280, height: 900 });
  await dlg(rider).getByRole("button", { name: "Confirmar", exact: true }).click();
  await settle(rider);
  record("Request confirmed after the restored flow -> PENDING in DB", (await sql(`select status from carpool_ride_requests where rider_id='${U.rider.id}'`))[0]?.status === "PENDING");

  // ---------------- F1(b) + F6(vehicle): carla chat reservation with carpool-first
  const carla = await page(U.carla);
  await open(carla);
  await say(carla, `Reserva um carro para amanhã às 10h, saindo da ${ORIGIN}, indo para a ${DEST}, retorno às 18h, não vou oferecer vagas.`);
  o = await opts(carla);
  const echo = await card(carla);
  record("[F1b] chat reservation shows carpool-first options + 'Usar um veículo'", o.length === 2 && /Usar um veículo/.test(o[1]), o);
  record("[F5] the 'Entendi' echo no longer has the postal code or ', Brazil'", !/Brazil|\d{5}-\d{3}/.test(echo ?? ""), echo);
  await carla.reload({ waitUntil: "domcontentloaded" });
  await open(carla);
  o = await opts(carla);
  record("[F1b] after RELOAD the carpool-first options and 'Usar um veículo' are restored and there is NO plain Confirmar that would skip the choice", o.length === 2 && /Usar um veículo/.test(o[1]) && !(await hasBtn(carla, "Confirmar")), o);
  await shot(carla, "reload-carpool-first-options");
  await say(carla, "2"); // 'Usar um veículo' by number after reload
  c = await card(carla);
  const vopts = await dlg(carla).locator("button.font-mono").allInnerTexts();
  record("[F1b][F6] typing '2' picks 'Usar um veículo' -> normal vehicle card with vehicle options (booking_mode=user_choice)", /Vou reservar o veículo/.test(c ?? "") && vopts.length >= 2, { c, vopts });
  record("[F5] vehicle card times have no seconds", !/\d{2}:\d{2}:\d{2}/.test(c ?? ""), c);
  record("[F6] with vehicle options pending the text box is ENABLED", await taEnabled(carla));
  await shot(carla, "vehicle-options-card-text-enabled");
  const before = c;
  await say(carla, "2");
  const after = await card(carla);
  record("[F6] typing '2' selects vehicle option 2 (card now names the other vehicle)", after && after !== before && /Vou reservar o veículo/.test(after), { before, after });
  await shot(carla, "vehicle-option-2-selected-by-number");
} catch (e) {
  record("FATAL", false, String(e && e.stack ? e.stack : e));
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${SHOTS}/followup-zz-failure-${Date.now()}.png` }).catch(() => {});
} finally {
  await browser.close().catch(() => {});
  for (const o of orgs) {
    await sql(`delete from chat_messages where conversation_id in (select id from chat_conversations where organization_id='${o.orgId}')`).catch(() => {});
    await sql(`delete from chat_conversations where organization_id='${o.orgId}'`).catch(() => {});
  }
  await cleanupOrgs(orgs);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  for (const r of failed) console.log("FAIL - " + r.name);
  process.exitCode = failed.length ? 1 : 0;
}
