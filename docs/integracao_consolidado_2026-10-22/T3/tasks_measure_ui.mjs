// T3 - atribuicao de tarefa pelo dashboard (auditada) e edicao de medicoes pela Frota (justificativa na reducao). UI LOCAL, papel fmall.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const EVD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const seed = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/design/users.json', 'utf8'));
const q = (s) => execSync(`docker exec supabase_db_fleet-homolog psql -U postgres -d postgres -Atc "${s}"`).toString().trim();
const VID = q("select id from vehicles where plate='T3M0001'");
const TASK = q(`select id from workflow_tasks where vehicle_id='${VID}' limit 1`);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 150)));
page.on('dialog', d => d.accept());
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.fill('input[name="email"]', seed.fmall.email); await page.fill('input[name="password"]', seed.fmall.password);
await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
const go = async (r) => { await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500); };
// --- tarefa
await go('/dashboard');
const card = page.locator('li', { hasText: 'T3M0001' }).filter({ has: page.locator('form') }).first(); console.log('TAREFA li encontrados:', await page.locator('li', { hasText: 'T3M0001' }).count());
const btns = await card.locator('button').allInnerTexts().catch(() => []);
console.log('TAREFA card botoes:', JSON.stringify(btns));
const claim = card.locator('form').first().locator('button').first();
if (await claim.count() && /Assumir/.test(await claim.innerText())) {
  await claim.click(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500);
  console.log('TAREFA apos clique url=', page.url().replace(BASE, ''), 'banner=', (await page.locator('[role=alert]').allInnerTexts()).join(' | '));
}
console.log('TAREFA banco:', q(`select coalesce((select full_name from profiles where id=assigned_to),'NULL') from workflow_tasks where id='${TASK}'`), '| audit:', q(`select count(*) from audit_log where entity_id='${TASK}' and action='workflow_task.claimed'`));
await page.screenshot({ path: `${EVD}/shots/c4_dashboard_tarefa.png`, fullPage: false });
// --- medicoes
await go('/fleet'); await page.locator('input[type=search]').first().fill('T3M0001'); await page.waitForTimeout(1500); const vrow = page.locator('section.vw-detail'); await vrow.locator('details.vw-admin > summary').click(); await page.waitForTimeout(500); console.log('MEDICAO linhas:', await vrow.count());
const editBtn = vrow.locator('button', { hasText: /^Editar$/ }).first();
console.log('MEDICAO botao editar encontrado:', await editBtn.count());
if (await editBtn.count()) {
  await editBtn.click(); await page.waitForTimeout(1500);
  const odo = page.locator('input[name=odometerKm], input[name=odometer_km], input[name=odometer]').first();
  console.log('MEDICAO campo odometro:', await odo.count(), 'valor:', await odo.inputValue().catch(() => null));
  // 1) reduzir SEM justificativa
  await odo.fill('14000'); await page.waitForTimeout(500);
  const reason = page.locator('textarea[name=odometerCorrectionReason]');
  console.log('MEDICAO justificativa exibida ao reduzir:', await reason.count(), 'required:', await reason.getAttribute('required').catch(() => null));
  await page.screenshot({ path: `${EVD}/shots/c4_medicao_reducao_form.png`, fullPage: true });
  const save = page.locator('form button[type=submit]').filter({ hasText: /Salvar|Atualizar|Save/i }).first();
  // contorna a validacao do navegador para provar a recusa NO SERVIDOR
  await page.evaluate(() => { const t = document.querySelector('textarea[name=odometerCorrectionReason]'); if (t) { t.removeAttribute('required'); t.removeAttribute('minlength'); t.value = ''; } });
  await save.click(); await page.waitForTimeout(3000);
  console.log('MEDICAO sem justificativa -> msgs:', (await page.locator('[role=alert]').allInnerTexts()).join(' | '), '| odometro banco:', q(`select odometer_km from vehicles where id='${VID}'`));
  // 2) com justificativa
  console.log('MEDICAO apos recusa: valor odometro no formulario=', await odo.inputValue().catch(() => null), 'justificativa ainda visivel=', await reason.count());
  await odo.fill('14000'); await page.waitForTimeout(400);
  if (await reason.count()) { await reason.fill('T3 correcao: digitacao errada na devolucao'); }
  await save.click(); await page.waitForTimeout(3500);
  console.log('MEDICAO com justificativa -> msgs:', (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | '), '| odometro banco:', q(`select odometer_km from vehicles where id='${VID}'`));
  console.log('MEDICAO auditoria:', q(`select string_agg(action||' '||left(coalesce(after::text,''),160),' || ') from audit_log where entity_id='${VID}'`));
  await page.screenshot({ path: `${EVD}/shots/c4_medicao_depois.png`, fullPage: true });
}
console.log('pageerrors', JSON.stringify(errs));
await browser.close();
