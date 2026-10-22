// T3 - administrador cadastra CNH manualmente (t3up) campo a campo, conferindo o banco a cada passo. App LOCAL.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const EVD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const seed = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/design/users.json', 'utf8'));
const t3 = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json', 'utf8'));
const q = (s) => execSync(`docker exec supabase_db_fleet-homolog psql -U postgres -d postgres -Atc "${s}"`).toString().trim();
const prof = (id) => q(`select coalesce(drivers_license_number,'NULL')||'|'||coalesce(drivers_license_category,'NULL')||'|'||coalesce(drivers_license_expiration::text,'NULL')||'|'||coalesce(drivers_license_expiration_source,'NULL')||'|auth='||driver_authorized from profiles where id='${id}'`);
const target = process.argv[2] || 't3up';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.fill('input[name="email"]', seed.admin.email); await page.fill('input[name="password"]', seed.admin.password);
await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
const open = async () => { await page.goto(BASE + '/settings/users', { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2000); };
const row = () => page.locator('tr', { hasText: t3[target].email }).first();
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2500); };
const alerts = async () => (await row().locator('[role=alert], .text-signal-teal').allInnerTexts()).join(' | ');
await open();
console.log('INICIO', prof(t3[target].id));
for (const [name, value] of [['licenseNumber', '55500011122'], ['licenseCategory', 'B'], ['licenseExpiration', '2030-05-10']]) {
  const inp = row().locator(`input[name=${name}]`);
  await inp.click(); await inp.fill(value);
  if (name !== 'licenseExpiration') await inp.press('Tab');
  await settle();
  console.log('APOS', name, prof(t3[target].id), 'msgs:', await alerts());
  await open();
}
const chk = row().locator('input[name=driverAuthorized]');
console.log('checkbox disabled=', await chk.isDisabled(), 'checked=', await chk.isChecked());
if (!(await chk.isChecked())) { await chk.click(); await settle(); }
console.log('APOS autorizar', prof(t3[target].id), 'msgs:', await alerts());
await open();
const src = row().locator('[data-testid=license-source]');
console.log('ROTULO', await src.getAttribute('data-source'), JSON.stringify((await src.innerText()).trim()));
await row().screenshot({ path: `${EVD}/shots/admin_row_${target}_manual.png` });
await browser.close();
