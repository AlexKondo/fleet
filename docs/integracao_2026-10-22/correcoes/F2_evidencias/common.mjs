// F2 helpers (LOCAL only: http://localhost:3100 + docker supabase_db_fleet-homolog). Passwords are read, never printed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
export const { chromium } = require('playwright');
export const BASE = 'http://localhost:3100';
export const OUT = 'C:/projects/fleet-integ/docs/integracao_2026-10-22/correcoes/F2_evidencias';
export const users = { ...JSON.parse(fs.readFileSync('C:/projects/_homolog/design/users.json', 'utf8')), ...JSON.parse(fs.readFileSync('C:/projects/_homolog/conclusao/S3/s3users.json', 'utf8')) };
export function sql(s) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_fleet-homolog', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: s }).toString().trim();
}
export async function login(browser, key, { viewport = { width: 1440, height: 900 } } = {}) {
  const u = users[key];
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const log = { console: [], pageerrors: [], http5xx: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.console.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.pageerrors.push(String(e).slice(0, 300)));
  page.on('response', (r) => { if (r.status() >= 500) log.http5xx.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[name="email"]', u.email);
  await page.fill('input[name="password"]', u.password);
  await Promise.all([page.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 120000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return { ctx, page, log, landed: new URL(page.url()).pathname };
}
export async function go(page, route) {
  let status = null, err = null;
  try { const r = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 120000 }); status = r?.status() ?? null; } catch (e) { err = String(e).slice(0, 200); }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { status, err, path: new URL(page.url()).pathname + new URL(page.url()).search };
}
export const shot = (page, name) => page.screenshot({ path: `${OUT}/shots/${name}.png` }).catch(() => {});
export function save(name, obj) { fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(obj, null, 1)); }
/** Superuser session but with auth.uid() claims (local fixtures whose triggers check the actor). */
export function sqlClaims(userId, body) {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' }).replace(/'/g, "''");
  return sql(`begin; set local request.jwt.claims = '${claims}'; ${body}; commit;`);
}
