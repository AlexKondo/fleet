// T3 - reproducao: apos um erro NATURAL do servidor na edicao do veiculo (placa duplicada), o formulario e reiniciado pelo React
// e o <select> de categoria volta para a 1a opcao enquanto o estado interno continua com a categoria antiga; ao salvar de novo,
// a categoria do veiculo muda silenciosamente. Veiculo proprio do T3 (T3M0001). App LOCAL, papel fmall.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const EVD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const seed = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/design/users.json', 'utf8'));
const q = (s) => execSync(`docker exec supabase_db_fleet-homolog psql -U postgres -d postgres -Atc "${s}"`).toString().trim();
const state = () => q("select c.name||'|'||c.energy_type||'|fuel='||coalesce(v.fuel_level_percent::text,'NULL')||'|bat='||coalesce(v.battery_level_percent::text,'NULL')||'|odo='||v.odometer_km from vehicles v join vehicle_categories c on c.id=v.category_id where v.plate='T3M0001'");
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })).newPage();
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.fill('input[name="email"]', seed.fmall.email); await page.fill('input[name="password"]', seed.fmall.password);
await Promise.all([page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
await page.goto(BASE + '/fleet', { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500);
await page.locator('input[type=search]').first().fill('T3M0001'); await page.waitForTimeout(1200);
const det = page.locator('section.vw-detail');
await det.locator('details.vw-admin > summary').click();
await det.locator('button', { hasText: /^Editar$/ }).first().click(); await page.waitForTimeout(800);
const form = det.locator('form:has(input[name=plate])');
const cat = form.locator('select[name=categoryId], select[name=category_id]').first();
const catText = async () => cat.evaluate(s => s.options[s.selectedIndex]?.text);
console.log('INICIO banco:', state(), '| select categoria:', await catText(), '| campos:', JSON.stringify(await form.locator('input,select,textarea').evaluateAll(a => a.map(e => e.name).filter(Boolean))));
await form.locator('input[name=plate]').fill('GWM1H61'); // placa de outro veiculo -> erro do servidor
await form.locator('button[type=submit]').first().click(); await page.waitForTimeout(3500);
console.log('APOS ERRO msgs:', (await form.locator('[role=alert], .text-signal-red').allInnerTexts()).join(' | '), '| select categoria agora:', await catText(), '| placa no campo:', await form.locator('input[name=plate]').inputValue(), '| fuel visivel:', await form.locator('[name=fuelLevelPercent]').count(), '| bateria visivel:', await form.locator('[name=batteryLevelPercent]').count());
await page.screenshot({ path: `${EVD}/shots/c4_veiculo_apos_erro.png`, fullPage: false });
await form.locator('input[name=plate]').fill('T3M0001');
await form.locator('button[type=submit]').first().click(); await page.waitForTimeout(3500);
console.log('APOS SALVAR DE NOVO banco:', state());
await browser.close();
