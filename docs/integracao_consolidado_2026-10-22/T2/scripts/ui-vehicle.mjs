// T2 — Cenário 1: foto do VEÍCULO pela UI real (Frota > Editar / + Adicionar veículo) em http://localhost:3100.
// Captura de rede: toda requisição POST com tamanho do corpo; prova de que server actions não carregam bytes.
import fs from 'node:fs';
import * as L from './lib.mjs';
const OUT = L.T2 + '/shots'; fs.mkdirSync(OUT, { recursive: true });
const FILE = 'ui-vehicle.json';
const MiB = 1024 * 1024;

function watch(page) {
  const net = [];
  page.on('request', (r) => {
    if (r.method() !== 'POST' && r.method() !== 'PUT') return;
    const u = r.url(); const h = r.headers();
    let len = 0; try { len = r.postDataBuffer()?.length ?? 0; } catch { len = -1; }
    net.push({ m: r.method(), url: u.replace(L.BASE, '').replace(L.API, 'SUPABASE').slice(0, 110), action: !!h['next-action'], len });
  });
  page.on('response', async (r) => { const e = net.find(n => !n.status && r.url().replace(L.BASE, '').replace(L.API, 'SUPABASE').startsWith(n.url.slice(0, 60)) && r.request().method() === n.m); if (e) { e.status = r.status(); try { e.wire = (await r.request().sizes()).requestBodySize; if (e.wire > e.len) e.len = e.wire; } catch {} } });
  return net;
}
async function openEdit(page, plate) {
  await page.goto(L.BASE + '/fleet', { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('.vw-filters input[type="search"]').fill(plate);
  await page.locator('button.vw-select', { hasText: plate }).first().click();
  await page.locator('details.vw-admin summary', { hasText: plate }).click();
  const card = page.locator('details.vw-admin li').filter({ has: page.locator('p.font-mono', { hasText: plate }) }).first();
  await card.getByRole('button', { name: 'Editar' }).click();
  return card;
}
async function editCase(b, id, key, plate, buf, ext = 'png', mime = 'image/png', expect = 'success') {
  const s = await L.login(b, key); const net = watch(s.page); const res = { id, user: key, plate, size: buf.length };
  const vid = L.vid(plate); const before = L.psql(`select coalesce(photo_storage_path,'(null)') from vehicles where id='${vid}'`);
  try {
    const card = await openEdit(s.page, plate);
    const file = L.writeTmp(`${id}.${ext}`, buf);
    const form = card.locator('form').filter({ has: s.page.locator('input[name="photo"]') });
    await form.locator('input[name="photo"]').setInputFiles(file);
    const t0 = Date.now();
    await form.locator('button[type="submit"]').click();
    res.outcome = await Promise.race([
      card.locator('input[name="photo"]').waitFor({ state: 'detached', timeout: 180000 }).then(() => 'form fechado (sucesso)'),
      card.locator('form [role="alert"], form .text-signal-red').first().waitFor({ timeout: 180000 }).then(() => 'alerta'),
    ]).catch((e) => 'timeout');
    res.ms = Date.now() - t0;
    res.alert = (await card.locator('[role="alert"], .text-signal-red').allInnerTexts().catch(() => [])).join(' | ');
    res.validity = await form.locator('input[name="photo"]').evaluate(e => e.validationMessage).catch(() => '(detached)');
    await s.page.waitForTimeout(800);
    await s.page.screenshot({ path: `${OUT}/${id}.png` });
  } catch (e) { res.error = String(e?.message ?? e).slice(0, 300); await s.page.screenshot({ path: `${OUT}/${id}_erro.png` }).catch(() => {}); }
  res.before = before; res.after = L.psql(`select coalesce(photo_storage_path,'(null)') from vehicles where id='${vid}'`);
  res.journal = L.journal(`sha256='${L.sha(buf)}'`); res.object = res.journal[0] ? L.objects(res.journal[0].path) : [];
  res.net = net; res.maxActionBody = Math.max(0, ...net.filter(n => n.action).map(n => n.len)); res.maxApiPhotos = Math.max(0, ...net.filter(n => n.url.startsWith('/api/photos')).map(n => n.len));
  res.storageUpload = net.filter(n => n.url.startsWith('SUPABASE/storage')).map(n => `${n.len}B→${n.status}`).join(',');
  res.http500 = net.filter(n => n.status >= 500).length;
  await s.ctx.close(); return res;
}
const b = await L.chromium.launch({ headless: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; const run = (id) => !ONLY || ONLY.includes(id);
const ok = (r) => r.outcome === 'form fechado (sucesso)' && r.after.includes(L.sha(Buffer.alloc(0)).slice(0, 0)) && r.journal.some(j => j.state === 'linked' && j.verified) && r.maxActionBody < 64 * 1024 && r.http500 === 0;
// 1) papéis
for (const [id, key, plate, size] of [['V01', 'admin', 'TDA1A01', 300_000], ['V02', 'fmall', 'TDA1A04', 3 * MiB], ['V03', 'fmcampinas', 'TDA2A01', Math.round(4.5 * MiB)], ['V04', 'fmall', 'TDA1A01', Math.round(8.6 * MiB)], ['V05', 'admin', 'TDA2A01', 10 * MiB]]) {
  if (!run(id)) continue; const buf = L.pngOfSize(size); const r = await editCase(b, id, key, plate, buf);
  const linked = r.after.endsWith(L.sha(buf) + '.png');
  L.rec(FILE, { id, cenario: `Editar veículo ${plate} com foto ${(size / MiB).toFixed(2)} MiB`, papel: key, esperado: 'sucesso; bytes direto ao Storage; server action sem bytes; /api/photos só JSON; jornal linked+verificado; vehicles.photo_storage_path = novo objeto', obtido: `${r.outcome} em ${r.ms}ms; action máx=${r.maxActionBody}B; /api/photos máx=${r.maxApiPhotos}B; storage=${r.storageUpload} objeto=${r.object?.[0]?.size ?? '-'}B; 5xx=${r.http500}; vinculado=${linked}; ${r.alert ?? ''} ${r.error ?? ''}`, status: r.outcome === 'form fechado (sucesso)' && linked && r.maxActionBody < 65536 && r.http500 === 0 ? 'PASS' : 'FAIL', evidencia: r });
}
// 2) acima do limite: 10 MiB + 1
{
  const buf = L.pngOfSize(10 * MiB + 1); const r = await editCase(b, 'V06', 'fmall', 'TDA1A04', buf);
  const sent = r.net.some(n => n.url.startsWith('SUPABASE/storage') || n.url.startsWith('/api/photos') || n.action);
  L.rec(FILE, { id: 'V06', cenario: 'Editar veículo com 10 MiB + 1 byte', papel: 'fmall', esperado: 'mensagem clara no campo; nada enviado; foto anterior preservada', obtido: `${r.outcome}; alerta="${r.alert}"; validity="${r.validity}"; requisições enviadas=${sent}; antes=após:${r.before === r.after}`, status: !sent && r.before === r.after && /10/.test(r.alert + r.validity) ? 'PASS' : 'FAIL', evidencia: r });
}
// 3) tipos pelo formulário (accept=image/*)
for (const [id, ext, mime, buf] of [['V07', 'jpg', 'image/jpeg', L.jpegOfSize(200_000)], ['V08', 'webp', 'image/webp', L.webpOfSize(150_000)], ['V09', 'heic', 'image/heic', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(120_000, 7)])]]) {
  const r = await editCase(b, id, 'admin', 'TDA1A01', buf, ext, mime);
  const linked = r.after.includes(L.sha(buf));
  const expectOk = mime !== 'image/heic';
  L.rec(FILE, { id, cenario: `Editar veículo com ${ext.toUpperCase()}`, papel: 'admin', esperado: expectOk ? 'aceito e vinculado' : 'recusa com mensagem clara de tipo (HEIC não suportado no contrato 0219+: só jpeg/png/webp)', obtido: `${r.outcome}; alerta="${r.alert}"; vinculado=${linked}; api=${r.net.filter(n => n.url.startsWith('/api')).map(n => n.status).join(',')}`, status: expectOk ? (linked ? 'PASS' : 'FAIL') : (!linked && /tipo|formato|imagem|JPEG|PNG|WEBP/i.test(r.alert) ? 'PASS' : 'FAIL'), evidencia: r });
}
// 4) criação de veículo com foto (admin, unidade SP; fmcampinas em Campinas)
async function createCase(id, key, plate, unitName, buf) {
  const s = await L.login(b, key); const net = watch(s.page); const res = { id, user: key, plate };
  try {
    await s.page.goto(L.BASE + '/fleet', { waitUntil: 'networkidle', timeout: 120000 });
    await s.page.getByRole('button', { name: /Adicionar veículo|Add vehicle/i }).first().click();
    const form = s.page.locator('form').filter({ has: s.page.locator('input[name="plate"]') }).filter({ has: s.page.locator('input[name="photo"]') }).first();
    await form.locator('input[name="plate"]').fill(plate);
    await form.locator('input[name="name"]').fill('T2 criado ' + plate).catch(() => {});
    await form.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await form.locator('input[name="odometerKm"]').fill('1000');
    await form.locator('input[name="estimatedRangeKm"]').fill('500').catch(() => {});
    if (await form.locator('select[name="fuelLevelPercent"]').count()) await form.locator('select[name="fuelLevelPercent"]').selectOption({ index: 1 });
    if (await form.locator('input[name="batteryLevelPercent"]').count()) await form.locator('input[name="batteryLevelPercent"]').fill('80');
    if (await form.locator('select[name="unitId"]').count()) await form.locator('select[name="unitId"]').selectOption({ label: unitName });
    if (await form.locator('select[name="locationId"]').count()) await form.locator('select[name="locationId"]').selectOption({ index: 1 }).catch(() => {});
    if (await form.locator('select[name="color"]').count()) await form.locator('select[name="color"]').selectOption({ index: 1 }).catch(() => {});
    await form.locator('input[name="photo"]').setInputFiles(L.writeTmp(id + '.png', buf));
    const t0 = Date.now(); await form.locator('button[type="submit"]').click();
    for (let i = 0; i < 120; i++) { await s.page.waitForTimeout(1000); if (L.psql(`select count(*) from vehicles where plate='${plate}'`) === '1' && L.journal(`sha256='${L.sha(buf)}'`).some(j => j.state === 'linked')) break; if (await form.locator('[role="alert"]').count()) break; }
    res.ms = Date.now() - t0; res.alert = (await form.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' | ');
    await s.page.screenshot({ path: `${OUT}/${id}.png` });
  } catch (e) { res.error = String(e?.message ?? e).slice(0, 300); await s.page.screenshot({ path: `${OUT}/${id}_erro.png` }).catch(() => {}); }
  res.vehicle = L.psql(`select coalesce(json_agg(json_build_object('id',v.id,'photo',v.photo_storage_path,'unit',(select unit_id from fm_vehicle_units where vehicle_id=v.id))),'[]') from vehicles v where plate='${plate}'`);
  res.journal = L.journal(`sha256='${L.sha(buf)}'`); res.net = net; res.maxActionBody = Math.max(0, ...net.filter(n => n.action).map(n => n.len));
  await s.ctx.close(); return res;
}
{
  const buf = L.pngOfSize(Math.round(8.6 * MiB)); const r = await createCase('V10', 'admin', process.env.P10 ?? 'TDA1A09', 'São Paulo - Matriz (Faria Lima)', buf);
  const v = JSON.parse(r.vehicle);
  L.rec(FILE, { id: 'V10', cenario: 'Criar veículo com foto 8,6 MiB', papel: 'admin / SP', esperado: '1 veículo; foto vinculada; action sem bytes', obtido: `veículos=${v.length}; foto=${v[0]?.photo?.endsWith(L.sha(buf) + '.png')}; action máx=${r.maxActionBody}B; ${r.ms}ms; ${r.alert ?? ''} ${r.error ?? ''}`, status: v.length === 1 && v[0]?.photo?.endsWith(L.sha(buf) + '.png') && r.maxActionBody < 65536 ? 'PASS' : 'FAIL', evidencia: r });
}
{
  const buf = L.pngOfSize(600_000); const r = await createCase('V11', 'fmcampinas', process.env.P11 ?? 'TDA2A09', 'Campinas - Centro Técnico', buf);
  const v = JSON.parse(r.vehicle);
  L.rec(FILE, { id: 'V11', cenario: 'Criar veículo com foto (gestor limitado, unidade do escopo)', papel: 'fmcampinas / Campinas', esperado: '1 veículo na unidade Campinas; foto vinculada', obtido: `veículos=${v.length}; unit=${v[0]?.unit}; foto=${v[0]?.photo?.endsWith(L.sha(buf) + '.png')}; action máx=${r.maxActionBody}B; ${r.alert ?? ''} ${r.error ?? ''}`, status: v.length === 1 && v[0]?.photo?.endsWith(L.sha(buf) + '.png') ? 'PASS' : 'FAIL', evidencia: r });
}
await b.close();
