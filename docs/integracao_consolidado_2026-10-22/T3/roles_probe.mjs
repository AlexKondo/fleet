// T3 - confere o CONTEUDO de rotas que responderam 200 sem redirecionar para papeis sem permissao (le texto + captura).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const EVD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const users = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json', 'utf8'));
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch({ headless: true });
for (const [k, routes] of Object.entries(plan)) {
  const u = users[k];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[name="email"]', u.email); await page.fill('input[name="password"]', u.password);
  await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  for (const r of routes) {
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const fu = new URL(page.url());
    const main = await page.locator('main').first().innerText().catch(async () => await page.locator('body').innerText());
    const file = `shots/role_${k}_${r.replace(/[^a-z0-9]+/gi, '-')}.png`;
    await page.screenshot({ path: `${EVD}/${file}` });
    console.log(`== ${k} ${r} -> ${fu.pathname}${fu.search}\n${main.replace(/\s+/g, ' ').slice(0, 400)}\n   (${file})`);
  }
  await ctx.close();
}
await browser.close();

