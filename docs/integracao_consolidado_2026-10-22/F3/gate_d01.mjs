// F3 — T2-D01: portaria (GateVisualForm) com queda do envio da foto de avaria. App LOCAL (localhost:3100), banco Docker local.
// Uso: MODE=antes KEY=g4 node gate_d01.mjs   |   MODE=depois KEY=g5 node gate_d01.mjs   |   MODE=depois2 KEY=f4 node gate_d01.mjs
// Nada é apagado. A queda é simulada abortando a POST do navegador ao Storage (mesma técnica do T2/F03).
import fs from 'node:fs';
import * as L from '../T2/scripts/lib.mjs';
const F3 = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/F3';
const MODE = process.env.MODE, KEY = process.env.KEY;
const rid = L.psql(`select rid from t2.r where k='${KEY}'`);
const insp = () => L.psql(`select coalesce(string_agg(id::text,','),'') from inspections where reservation_id='${rid}' and type='pickup' and performed_by_role='security'`);
const photos = (id) => id ? L.psql(`select coalesce(string_agg(angle::text,','),'') from inspection_photos where inspection_id='${id}'`) : '';
const out = { mode: MODE, key: KEY, rid, inicio: { conferencias: insp() } };
const b = await L.chromium.launch({ headless: true });
const s = await L.login(b, 'security');
const page = s.page;
const shot = async (n) => page.screenshot({ path: `${F3}/shots/d01_${MODE}_${n}.png`, fullPage: true });
const alerts = async () => (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
const dmg = L.pngOfSize(600_000); const dmgFile = L.writeTmp(`F3_${MODE}_${KEY}.png`, dmg);
const abort = (route) => route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue();
await page.goto(`${L.BASE}/reservations/${rid}/pickup`, { waitUntil: 'networkidle', timeout: 120000 });
const form = page.locator('form.ck-card').filter({ has: page.locator('input[name="reservationId"]') });
await form.waitFor({ timeout: 30000 });
await form.locator('input[name="hasDamage"]').check();
await form.locator('textarea[name="notes"]').fill(`F3 ${MODE}: risco no para-choque (fictício)`);
if (MODE === 'depois2') {
  // T2-D02 na portaria: HEIC recusado ANTES de registrar a conferência
  await form.locator('input[name="photo_damage"]').setInputFiles({ name: 'foto.heic', mimeType: 'image/heic', buffer: Buffer.from('ftypheic-ficticio') });
  await form.locator('button[type="submit"]').click(); await page.waitForTimeout(1500);
  out.heic = { alerta: await alerts(), validacao: await form.locator('input[name="photo_damage"]').evaluate(e => e.validationMessage), conferencias: insp() };
  await shot('1_heic');
}
await form.locator('input[name="photo_damage"]').setInputFiles(dmgFile);
await page.route('**/storage/v1/object/vehicle-photos/**', abort);
await form.locator('button[type="submit"]').click();
for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); if ((await alerts()).trim() || page.url().includes('/evidence/')) break; }
await page.waitForTimeout(2500);
const id = insp();
out.aposQueda = { url: page.url().replace(L.BASE, ''), alerta: await alerts(), conferencias: id.split(',').filter(Boolean).length, fotos: photos(id), jornal: L.journal(`sha256='${L.sha(dmg)}'`).map(j => j.state).join(','),
  botaoReenviar: await page.getByRole('button', { name: /Enviar a foto novamente/ }).count(), linkEvidencias: await page.getByRole('link', { name: /evidências desta conferência/ }).count() };
await shot('2_apos_queda');
await page.unroute('**/storage/v1/object/vehicle-photos/**');
if (MODE === 'depois') {
  await page.getByRole('button', { name: /Enviar a foto novamente/ }).click();
  await page.waitForURL((u) => u.pathname === '/gate', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  out.aposReenvio = { url: page.url().replace(L.BASE, ''), conferencias: insp().split(',').filter(Boolean).length, fotos: photos(insp()), jornal: L.journal(`sha256='${L.sha(dmg)}'`).map(j => j.state).join(',') };
  await shot('3_apos_reenvio');
}
if (MODE === 'depois2') {
  // O operador sai da tela (recarrega). A conferência já existe -> a página leva às evidências, que devem mostrar a pendência.
  await page.goto(`${L.BASE}/reservations/${rid}/pickup`, { waitUntil: 'networkidle', timeout: 120000 });
  out.recarregar = { url: page.url().replace(L.BASE, ''), alerta: await alerts(), anguloPreSelecionado: await page.locator('select[name="angle"]').inputValue().catch(() => '') };
  await shot('3_evidencias_pendente');
  await page.locator('input[name="files"]').setInputFiles(dmgFile);
  await page.getByRole('button', { name: /Adicionar fotos/ }).click();
  await page.locator('[role="status"]').waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  out.aposEnvioEvidencias = { status: await page.locator('[role="status"]').innerText().catch(() => ''), alerta: await alerts(), fotos: photos(insp()), conferencias: insp().split(',').filter(Boolean).length };
  await shot('4_evidencias_concluida');
}
await b.close();
fs.writeFileSync(`${F3}/d01_${MODE}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
