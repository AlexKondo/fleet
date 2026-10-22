// T3 - Cenario 4 (UI LOCAL): busca de carona por colaborador SEM CNH, falha de leitura dos pontos (revoga/restaura SELECT),
// visao do anfitriao (passageiros aceitos + comandos de oferta), visao do passageiro, rotulo de excecao em 4 idiomas.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const EVD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const seed = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/design/users.json', 'utf8'));
const t3 = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json', 'utf8'));
const psql = (s) => execSync(`docker exec supabase_db_fleet-homolog psql -U postgres -d postgres -Atc "${s}"`).toString().trim();
const HOST_RES = psql("select r.id from carpool_offers o join reservations r on r.trip_request_id=o.trip_request_id where o.id='58384ea0-6d26-4a9d-ad1a-1907d79281b2'");
const EXC_RES = psql("select reservation_id from fm_operation_exceptions where reason='MOTIVO-INTERNO-T3-SIGILOSO' limit 1");
const browser = await chromium.launch({ headless: true });
async function session(u, locale) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  if (locale) await ctx.addCookies([{ name: 'fleet-locale', value: locale, url: BASE }]);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 150)));
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[name="email"]', u.email); await page.fill('input[name="password"]', u.password);
  await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return { ctx, page, errs };
}
const go = async (page, r) => { await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500); return (await page.locator('main').first().innerText().catch(() => page.locator('body').innerText())).replace(/\s+/g, ' '); };
const shot = (page, n) => page.screenshot({ path: `${EVD}/shots/c4_${n}.png`, fullPage: true });

// 1+2) busca de carona por colaborador SEM CNH, antes e durante a revogacao do SELECT dos pontos
{
  const { ctx, page, errs } = await session(t3.t3null);
  const search = async (tag) => {
    await go(page, '/carpool');
    await page.locator('#fm-origin').fill('Matriz Faria Lima'); await page.waitForTimeout(600); await page.keyboard.press('Escape');
    await page.locator('#fm-destination').fill('Centro Técnico Campinas'); await page.waitForTimeout(600); await page.keyboard.press('Escape');
    await page.locator('#fm-when').fill('2026-10-24T08:00');
    await page.locator('#fm-seats').fill('1');
    await page.locator('[data-testid=buscar-submit]').click();
    const t0 = Date.now(); await page.waitForFunction(() => !/Buscando/.test(document.querySelector('[data-testid=buscar-submit]')?.textContent || ''), null, { timeout: 120000 }).catch(() => {}); await page.waitForTimeout(1000); console.log('  tempo ms', Date.now() - t0);
    const txt = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
    const unavailable = await page.locator('[data-testid=carpool-unavailable]').count();
    await shot(page, `busca_${tag}`);
    console.log(`BUSCA ${tag}: unavailableBanner=${unavailable} :: ${txt.slice(txt.indexOf('Buscar caronas'), txt.indexOf('Buscar caronas') + 400)}`);
  };
  await search('normal');
  psql('revoke select on public.corporate_mobility_points from authenticated');
  try { await search('pontos_revogados'); }
  finally { psql('grant select on public.corporate_mobility_points to authenticated'); console.log('GRANT restaurado:', psql("select string_agg(privilege_type,',') from information_schema.role_table_grants where table_name='corporate_mobility_points' and grantee='authenticated'")); }
  await search('restaurado');
  console.log('pageerrors', JSON.stringify(errs));
  await ctx.close();
}
if (process.argv[2] === 'busca') { await browser.close(); process.exit(0); }
// 3) anfitriao (lucas): reserva com oferta e passageiro aceito; visao propria de motorista
{
  const { ctx, page } = await session(seed.lucas);
  const det = await go(page, `/reservations/${HOST_RES}`); await shot(page, 'anfitriao_reserva');
  console.log('ANFITRIAO reserva: mariana visivel=', /Mariana/.test(det), ':: trecho carona:', det.slice(Math.max(0, det.search(/[Cc]arona/) - 50), det.search(/[Cc]arona/) + 500));
  const mine = await go(page, '/carpool/mine'); await shot(page, 'anfitriao_carpool_mine');
  console.log('ANFITRIAO /carpool/mine ::', mine.slice(0, 700));
  const tab = await go(page, '/trips?tab=carpools'); await shot(page, 'anfitriao_trips_carpools');
  console.log('ANFITRIAO /trips?tab=carpools ::', tab.slice(0, 500));
  await ctx.close();
}
// 4) passageira (mariana)
{
  const { ctx, page } = await session(seed.mariana);
  const mine = await go(page, '/carpool/mine'); await shot(page, 'passageira_carpool_mine');
  console.log('PASSAGEIRA /carpool/mine ::', mine.slice(0, 700));
  const tab = await go(page, '/trips?tab=carpools'); await shot(page, 'passageira_trips_carpools');
  console.log('PASSAGEIRA /trips?tab=carpools ::', tab.slice(0, 500));
  await ctx.close();
}
// 5) rotulo de excecao para o solicitante, 4 idiomas, sem motivo interno
for (const loc of ['pt-BR', 'en-US', 'es', 'zh-CN']) {
  const { ctx, page } = await session(t3.t3valid, loc);
  const list = await go(page, '/trips?tab=all'); await shot(page, `excecao_trips_${loc}`);
  const det = await go(page, `/reservations/${EXC_RES}`); await shot(page, `excecao_detalhe_${loc}`);
  const label = /veículo não saiu|vehicle did not leave|vehículo no salió|车辆未出发/;
  console.log(`EXCECAO ${loc}: lista rotulo=${label.test(list)} detalhe rotulo=${label.test(det)} motivoInternoVisivel=${/MOTIVO-INTERNO/.test(list + det)} :: ${(det.match(label) || [''])[0]}`);
  await ctx.close();
}
await browser.close();
