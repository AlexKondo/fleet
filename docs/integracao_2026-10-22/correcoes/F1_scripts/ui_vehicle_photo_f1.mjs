// F1 (copy of S2 ui-vehicle-photo.mjs, fresh random colours so a NEW photo is linked after 0215/0216): fluxo EXATO do app (Frota > Editar veículo > foto > Salvar) em http://localhost:3100 (dev local).
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const OUT = 'C:/projects/fleet-integ/docs/integracao_2026-10-22/correcoes/evidencias/ui_f1'; fs.mkdirSync(OUT, { recursive: true });
const users = JSON.parse(fs.readFileSync('C:/projects/_homolog/design/users.json', 'utf8'));
const q = (s) => execSync('docker exec -i supabase_db_fleet-homolog psql -U postgres -d postgres -At', { input: s }).toString().trim();

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function realPng(w, h, rgb) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))]); const raw = Buffer.concat(Array.from({ length: h }, (_, y) => { const r = Buffer.from(row); r[1] = (y * 7) & 255; return r; })); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }

async function run(k, plate, rgb, extra = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const res = { user: k, plate, console: [], responses: [] };
  page.on('console', (m) => { if (m.type() === 'error') res.console.push(m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.request().method() === 'POST') res.responses.push(r.status() + ' ' + r.url().slice(0, 60)); });
  try {
    const img = extra.bytes ?? realPng(320, 200, rgb);
    const file = `${OUT}/ui_${k}_${plate}.png`; fs.writeFileSync(file, img);
    res.sha = crypto.createHash('sha256').update(img).digest('hex'); res.size = img.length;
    const vid = q(`select id from vehicles where plate='${plate}'`);
    res.before = q(`select coalesce(photo_storage_path,'(null)') from vehicles where id='${vid}'`);
    await page.goto(BASE + '/login');
    await page.fill('input[name="email"]', users[k].email);
    await page.fill('input[name="password"]', users[k].password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), page.click('button[type="submit"]')]);
    await page.goto(BASE + '/fleet', { waitUntil: 'networkidle', timeout: 120000 });
    // layout atual (VehicleFilterGrid): buscar placa > selecionar > "Cadastro e ações administrativas" > Editar
    await page.locator('.vw-filters input[type="search"]').fill(plate);
    await page.locator('button.vw-select', { hasText: plate }).first().click();
    await page.locator('details.vw-admin summary', { hasText: plate }).click();
    const card = page.locator('details.vw-admin li').filter({ has: page.locator('p.font-mono', { hasText: plate }) }).first();
    await card.getByRole('button', { name: 'Editar' }).click();
    const form = card.locator('form').filter({ has: page.locator('input[name="photo"]') });
    await form.locator('input[name="photo"]').setInputFiles(file);
    await page.screenshot({ path: `${OUT}/ui_${k}_${plate}_antes_salvar.png`, fullPage: false });
    const t0 = Date.now();
    await form.locator('button[type="submit"]').click();
    res.outcome = await Promise.race([
      card.locator('input[name="photo"]').waitFor({ state: 'detached', timeout: 120000 }).then(() => 'form fechado (sucesso)'),
      card.locator('form p[role="alert"], form .text-signal-red').first().waitFor({ timeout: 120000 }).then(() => 'alerta no formulário'),
    ]).catch((e) => 'timeout: ' + e.message.slice(0, 80));
    res.ms = Date.now() - t0;
    await page.screenshot({ path: `${OUT}/ui_${k}_${plate}_apos_salvar.png`, fullPage: false });
    res.bodyText = (await page.locator('main').innerText().catch(()=>'')).slice(0,400);
    res.alert = await card.locator('[role="alert"], .text-signal-red').allInnerTexts().catch(() => []);
    await page.waitForTimeout(1500);
    res.after = q(`select coalesce(photo_storage_path,'(null)') from vehicles where id='${vid}'`);
    res.journal = q(`select json_agg(json_build_object('state',state,'verified',server_verified_at is not null,'by',uploaded_by,'path',storage_path)) from fm_photo_uploads where sha256='${res.sha}'`);
    res.audit = q(`select count(*) from audit_log where action='photo.linked' and entity_id='${vid}' and after->>'sha256'='${res.sha}'`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.vw-filters input[type="search"]').fill(plate);
    await page.locator('button.vw-select', { hasText: plate }).first().click();
    await page.waitForTimeout(2500);
    const imgs = await page.locator('button.vw-select', { hasText: plate }).first().locator('img').evaluateAll((els) => els.map((e) => ({ src: e.getAttribute('src')?.slice(0, 90), ok: e.complete && e.naturalWidth > 0 })));
    res.cardImages = imgs;
    await page.screenshot({ path: `${OUT}/ui_${k}_${plate}_depois.png`, fullPage: false });
  } catch (e) { res.error = String(e?.message ?? e); await page.screenshot({ path: `${OUT}/ui_${k}_${plate}_erro.png` }).catch(() => {}); }
  await browser.close();
  return res;
}
const out = [];
const rnd = () => [0, 0, 0].map(() => crypto.randomInt(256));
out.push(await run('fmall', 'GWM5O35', rnd()));
out.push(await run('admin', 'GWM9J29', rnd()));
out.push(await run('fmcampinas', 'GWM6T36', rnd()));
for (const r of out) r.changed_to_new_photo = r.after !== r.before && r.journal.includes(r.after);
fs.writeFileSync(`${OUT}/ui_vehicle_photo_f1.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.map(r => ({ user: r.user, plate: r.plate, outcome: r.outcome, changed_to_new_photo: r.changed_to_new_photo, audit: r.audit, img: r.cardImages, error: r.error })), null, 1));
