// F3 — D-T3-01: edição de veículo após erro do servidor (placa duplicada). App LOCAL, papel fmall, veículo do T3 (T3M0001).
// Uso: MODE=antes node vehicle_d01.mjs | MODE=depois node vehicle_d01.mjs  (no "depois" o veículo volta ao estado inicial pela própria UI)
import fs from 'node:fs';
import * as L from '../T2/scripts/lib.mjs';
const F3 = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/F3';
const MODE = process.env.MODE;
const state = () => L.psql(`select v.name||' | '||c.name||' | '||c.energy_type||' | fuel='||coalesce(v.fuel_level_percent::text,'NULL')||' | bat='||coalesce(v.battery_level_percent::text,'NULL')||' | odo='||v.odometer_km from vehicles v join vehicle_categories c on c.id=v.category_id where v.plate='T3M0001'`);
const out = { mode: MODE, inicio: state() };
const b = await L.chromium.launch({ headless: true });
const s = await L.login(b, 'fmall'); const page = s.page;
async function openEdit() {
  await page.goto(L.BASE + '/fleet', { waitUntil: 'networkidle', timeout: 120000 }); await page.waitForTimeout(1000);
  await page.locator('input[type=search]').first().fill('T3M0001'); await page.waitForTimeout(1200);
  const det = page.locator('section.vw-detail');
  await det.locator('details.vw-admin > summary').click();
  await det.locator('button', { hasText: /^Editar$/ }).first().click(); await page.waitForTimeout(800);
  return det.locator('form:has(input[name=plate])');
}
let form = await openEdit();
const cat = () => form.locator('select[name=categoryId]');
const catText = () => cat().evaluate(s => s.options[s.selectedIndex]?.text);
const snapshot = async () => ({ categoria: await catText(), placa: await form.locator('input[name=plate]').inputValue(), nome: await form.locator('input[name=name]').inputValue(), odometro: await form.locator('input[name=odometerKm]').inputValue(), combustivelVisivel: await form.locator('[name=fuelLevelPercent]').count(), bateriaVisivel: await form.locator('[name=batteryLevelPercent]').count() });
await cat().selectOption({ label: 'SUV Híbrido' });
await form.locator('input[name=name]').fill('F3 nome digitado');
await form.locator('input[name=plate]').fill('GWM1H61'); // placa de outro veículo -> erro natural do servidor
out.digitado = await snapshot();
await form.locator('button[type=submit]').first().click(); await page.waitForTimeout(3500);
out.aposErro = { mensagem: (await form.locator('[role=alert]').allInnerTexts()).join(' | '), ...(await snapshot()) };
await page.screenshot({ path: `${F3}/shots/t3d01_${MODE}_apos_erro.png` });
await form.locator('input[name=plate]').fill('T3M0001');
await form.locator('button[type=submit]').first().click(); await page.waitForTimeout(3500);
out.aposSalvarDeNovo = { banco: state(), escolhido: 'F3 nome digitado | SUV Híbrido | HEV' };
out.categoriaPreservada = out.aposSalvarDeNovo.banco.includes('SUV Híbrido');
if (MODE === 'depois') {
  // devolve o veículo ao estado inicial do T3 (pela UI), sem SQL
  form = await openEdit();
  await cat().selectOption({ label: 'SUV Compacto' });
  await form.locator('input[name=name]').fill('T3 Jolion medicoes');
  await form.locator('select[name=fuelLevelPercent]').selectOption('70').catch(() => {});
  await form.locator('button[type=submit]').first().click(); await page.waitForTimeout(3500);
  out.restaurado = state();
}
await b.close();
fs.writeFileSync(`${F3}/t3d01_${MODE}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
