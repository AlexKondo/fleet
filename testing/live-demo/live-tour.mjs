// Slow, visible (headed) tour of the production screens per role, with an on-screen banner. Disposable org, removed at the end.
import { chromium } from "playwright";
import { BASE, PASSWORD, T, sql, provisionOrg, cleanupOrgs } from "./carpool-c5-lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const orgs = [];
const browser = await chromium.launch({ headless: false, slowMo: 450, args: ["--start-maximized"] });

async function banner(page, text) {
  await page.evaluate((t) => {
    let b = document.getElementById("__tour");
    if (!b) { b = document.createElement("div"); b.id = "__tour"; b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:2147483647;background:#101d35;color:#fff;font:600 15px Arial;padding:10px 18px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.4);pointer-events:none"; document.body.appendChild(b); }
    b.textContent = t;
  }, text).catch(() => {});
}
async function slowScroll(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight).catch(() => 0);
  for (let y = 0; y <= Math.min(h, 2400); y += 300) { await page.evaluate((v) => window.scrollTo({ top: v, behavior: "smooth" }), y).catch(() => {}); await sleep(450); }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })).catch(() => {});
  await sleep(700);
}
async function visit(page, path, label, hold = 4000) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await banner(page, label);
  await sleep(hold);
  await slowScroll(page);
  await banner(page, label);
}
async function login(page, user) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/", { timeout: 90000 }), page.click('button[type="submit"]')]);
}
async function session(user, viewport, fn) {
  const ctx = await browser.newContext({ viewport, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  const page = await ctx.newPage();
  await login(page, user);
  await fn(page);
  await ctx.close();
}

try {
  const A = await provisionOrg("tour", [["emp", "employee"], ["mgr", "fleet_manager"], ["adm", "administrator"], ["sec", "security"]]);
  orgs.push(A);
  const U = A.users, O = A.orgId;
  await sql(`update profiles set driver_authorized=true where organization_id='${O}'`);
  const v1 = A.vehicles[0], v2 = A.vehicles[1];
  const trip = async (who, dest, s, e) => (await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${O}','${U[who].id}',${s},${e},'Valinhos','${dest}',20,1,'Reuniao') returning id`))[0].id;
  const resv = async (v, t, st, s, e) => (await sql(`insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values ('${O}','${v.id}','${t}','${st}',${s},${e}) returning id`))[0].id;
  const t1 = await trip("emp", "Sao Paulo", "now() - interval '1 hour'", "now() + interval '6 hours'");
  const r1 = await resv(v1, t1, "confirmed", "now() - interval '1 hour'", "now() + interval '6 hours'");
  await sql(`update vehicles set status='reserved' where id='${v1.id}'`);
  const t2 = await trip("emp", "Campinas", "now() + interval '2 days'", "now() + interval '2 days' + interval '5 hours'");
  await resv(v2, t2, "pending_approval", "now() + interval '2 days'", "now() + interval '2 days' + interval '5 hours'");
  const t3 = await trip("emp", "Iracemapolis", "now() - interval '5 days'", "now() - interval '5 days' + interval '4 hours'");
  await resv(v2, t3, "completed", "now() - interval '5 days'", "now() - interval '5 days' + interval '4 hours'");
  console.log("TOUR START", BASE);

  await session(U.emp, { width: 1440, height: 900 }, async (p) => {
    await banner(p, "COLABORADOR: entrou direto na nova Home");
    await sleep(4500); await slowScroll(p);
    await visit(p, "/trips", "COLABORADOR: Minhas Viagens (abas, cartoes, pedidos de carona)");
    await visit(p, "/trips/new", "COLABORADOR: Reservar Veiculo");
    await visit(p, "/carpool", "COLABORADOR: Buscar Carona");
    await visit(p, `/reservations/${r1}`, "COLABORADOR: detalhe da reserva");
    await visit(p, `/reservations/${r1}/pickup`, "COLABORADOR: checklist de retirada");
  });
  await session(U.emp, { width: 390, height: 844 }, async (p) => {
    await banner(p, "COLABORADOR no CELULAR: Home");
    await sleep(4500); await slowScroll(p);
    await visit(p, "/trips", "CELULAR: Minhas Viagens");
    await visit(p, "/carpool", "CELULAR: Buscar Carona");
  });
  await session(U.mgr, { width: 1440, height: 900 }, async (p) => {
    await banner(p, "GESTOR: entrou direto no Command Center");
    await sleep(4500); await slowScroll(p);
    await visit(p, "/fleet", "GESTOR: Frota");
    await visit(p, `/fleet/vehicles/${v1.id}`, "GESTOR: detalhe do veiculo");
    await visit(p, "/analytics", "GESTOR: Relatorios");
    await visit(p, "/analytics/carpool", "GESTOR: Caronas (KPIs)");
    await visit(p, "/settings", "GESTOR: Politicas da organizacao");
  });
  await session(U.adm, { width: 1440, height: 900 }, async (p) => {
    await banner(p, "ADMINISTRADOR");
    await visit(p, "/settings/users", "ADMIN: Usuarios, perfis e permissoes");
  });
  await session(U.sec, { width: 1440, height: 900 }, async (p) => {
    await banner(p, "SEGURANCA: entrou direto na Portaria");
    await sleep(4500); await slowScroll(p);
  });
  console.log("TOUR END - closing in 15s");
  await sleep(15000);
} catch (e) {
  console.log("TOUR ERROR", String(e).slice(0, 400));
} finally {
  await browser.close();
  await cleanupOrgs(orgs);
}
