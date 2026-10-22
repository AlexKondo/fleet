// T3 - localiza na /fleet (fmall) o veiculo T3M0001 e os controles de edicao.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const seed = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/design/users.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })).newPage();
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.fill('input[name="email"]', seed.fmall.email); await page.fill('input[name="password"]', seed.fmall.password);
await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
await page.goto(BASE + (process.argv[2] || '/fleet'), { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2000);
console.log('url', page.url()); const inputs = await page.locator('input').evaluateAll(a => a.map(i => i.name + '|' + i.placeholder + '|' + i.type)); console.log('inputs', JSON.stringify(inputs.slice(0,15))); const s = page.locator('input[type=search], input[placeholder*=usca]').first(); if (await s.count()) { await s.fill('T3M0001'); await page.waitForTimeout(1500); }
console.log('T3M0001 ocorrencias', await page.getByText('T3M0001').count());
const el = page.getByText('T3M0001').first();
const html = await el.evaluate(n => { let p = n; for (let i = 0; i < 6 && p.parentElement; i++) p = p.parentElement; return p.outerHTML.slice(0, 3000); }).catch(e => String(e));
console.log(html);
console.log('botoes pagina:', JSON.stringify((await page.locator('button, a[role=button]').allInnerTexts()).filter(Boolean).slice(0, 60)));
await browser.close();
