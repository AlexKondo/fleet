// T3 - matriz papel x rota (acesso por CNH). App LOCAL. Registra status HTTP final, rota final (redirecionamento) e aviso de CNH.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const EVD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const users = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json', 'utf8'));
const q = (s) => execSync(`docker exec supabase_db_fleet-homolog psql -U postgres -d postgres -Atc "${s}"`).toString().trim();
const RES = q("select rid from seedv.r where k='f2'");
const ROUTES = ['/dashboard', '/dashboard/command-center', '/admin', '/analytics', '/gate', '/fleet', '/fleet/keys', '/settings', '/settings/users', '/maintenance',
  '/trips', '/trips/new', '/carpool', '/carpool/mine', '/account/keys', `/reservations/${RES}`, `/reservations/${RES}/pickup`, '/account', '/account/license'];
const WHO = process.argv.slice(2).length ? process.argv.slice(2) : ['t3admin', 't3fmtotal', 't3fmlim', 't3maint', 't3sec', 't3cust', 't3valid', 't3exp', 't3null', 't3off', 't3pwd'];
const browser = await chromium.launch({ headless: true });
const out = [];
for (const k of WHO) {
  const u = users[k];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[name="email"]', u.email); await page.fill('input[name="password"]', u.password);
  await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  const landed = new URL(page.url());
  const loginMsg = landed.pathname.startsWith('/login') ? (await page.locator('[role=alert]').allInnerTexts().catch(() => [])).join(' | ') : '';
  const row = { k, role: u.role, cnh: u.cnh, extra: u.extra, landed: landed.pathname + landed.search, loginMsg, routes: {} };
  for (const r of ROUTES) {
    let status = null, err = null;
    try { const resp = await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 120000 }); status = resp && resp.status(); } catch (e) { err = String(e).slice(0, 120); }
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500);
    const fu = new URL(page.url()); const final = fu.pathname + fu.search;
    const body = await page.locator('body').innerText().catch(() => '');
    const cnhNotice = /CNH/.test(body) && /(envie|enviar|cadastr|regularize|vencid|pendente|sem CNH)/i.test(body);
    const notFound = /404|nÃ£o encontrad|not found/i.test(body.slice(0, 3000)) && status === 404;
    row.routes[r.replace(RES, '[id]')] = { status, final: final.replace(RES, '[id]'), cnhNotice, err, notFound };
  }
  out.push(row);
  console.log(k, u.role, u.cnh, '->', row.landed, loginMsg);
  for (const [r, v] of Object.entries(row.routes)) console.log('   ', r.padEnd(28), v.status, v.final !== r ? '=> ' + v.final : '', v.cnhNotice ? '[aviso CNH]' : '', v.err || '');
  await ctx.close();
}
fs.writeFileSync(`${EVD}/roles_matrix.json`, JSON.stringify(out, null, 1));
await browser.close();

