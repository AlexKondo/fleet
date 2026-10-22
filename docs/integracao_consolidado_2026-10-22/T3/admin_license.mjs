// T3 - administrador: rotulo IA/manual da CNH, reinicio de CNH travada por IA (resetMemberLicense) e cadastro manual. App LOCAL.
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
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
const errors = []; page.on('console', m => m.type() === 'error' && errors.push(m.text().slice(0, 200))); page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.fill('input[name="email"]', seed.admin.email); await page.fill('input[name="password"]', seed.admin.password);
await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
const open = async () => { await page.goto(BASE + '/settings/users', { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500); };
const row = (email) => page.locator('tr', { hasText: email }).first();
const log = (...a) => console.log(...a);
await open();
// 1) rotulos
for (const k of ['t3ai', 't3valid', 't3null']) {
  const r = row(t3[k].email);
  const src = r.locator('[data-testid=license-source]');
  log('ROTULO', k, await src.getAttribute('data-source'), JSON.stringify((await src.innerText()).trim()), 'locked=', await r.locator('[data-testid=license-locked]').count(), 'numDisabled=', await r.locator('input[name=licenseNumber]').isDisabled());
}
await row(t3.t3ai.email).screenshot({ path: `${EVD}/shots/admin_row_t3ai_antes.png` });
// 2) reinicio da CNH lida por IA
log('ANTES t3ai', prof(t3.t3ai.id));
const r = row(t3.t3ai.email);
await r.locator('input[name=reason]').first().fill('T3 teste: CNH ilegivel apos leitura');
// motivo curto tambem e conferido pelo servidor; aqui o motivo e valido
await r.locator('form:has(input[name=reason][minlength="5"]) button').click();
await page.waitForTimeout(4000);
log('DIALOGOS', JSON.stringify(dialogs));
log('DEPOIS t3ai', prof(t3.t3ai.id));
log('AUDIT', q(`select action||' '||coalesce(after::text,'') from audit_log where entity_id='${t3.t3ai.id}' and action='driver_license_reset' order by created_at desc limit 1`));
await open();
await row(t3.t3ai.email).screenshot({ path: `${EVD}/shots/admin_row_t3ai_depois.png` });
log('ROTULO t3ai depois', await row(t3.t3ai.email).locator('[data-testid=license-source]').getAttribute('data-source'));
// 3) cadastro manual (t3up, sem CNH)
log('ANTES t3up', prof(t3.t3up.id));
const u = row(t3.t3up.email);
await u.locator('input[name=licenseNumber]').fill('55500011122'); await u.locator('input[name=licenseNumber]').blur(); await page.waitForTimeout(2500);
await row(t3.t3up.email).locator('input[name=licenseCategory]').fill('B'); await row(t3.t3up.email).locator('input[name=licenseCategory]').blur(); await page.waitForTimeout(2500);
await row(t3.t3up.email).locator('input[name=licenseExpiration]').fill('2030-05-10'); await page.waitForTimeout(3000);
const chk = row(t3.t3up.email).locator('input[name=driverAuthorized]');
if (!(await chk.isChecked())) { await chk.check(); await page.waitForTimeout(3000); }
log('DEPOIS t3up', prof(t3.t3up.id));
await open();
log('ROTULO t3up depois', await row(t3.t3up.email).locator('[data-testid=license-source]').getAttribute('data-source'), JSON.stringify((await row(t3.t3up.email).locator('[data-testid=license-source]').innerText()).trim()));
await row(t3.t3up.email).screenshot({ path: `${EVD}/shots/admin_row_t3up_manual.png` });
log('ERROS console', JSON.stringify(errors));
await browser.close();
