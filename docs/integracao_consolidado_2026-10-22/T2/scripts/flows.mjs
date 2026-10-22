// T2 — fluxos de UI reutilizados (checklist do motorista, conferência da portaria, movimentos físicos).
import fs from 'node:fs';
import * as L from './lib.mjs';
const OUT = L.T2 + '/shots'; fs.mkdirSync(OUT, { recursive: true });
export const ANG = ['front', 'back', 'left_side', 'right_side', 'wheels', 'interior', 'damage'];
export const RES = () => Object.fromEntries(L.psql(`select k||'='||rid from t2.r`).split(String.fromCharCode(10)).map(l => l.split('=')));
export function watch(page) {
  const net = [];
  page.on('request', (r) => { if (r.method() !== 'POST') return; const h = r.headers(); let len = 0; try { len = r.postDataBuffer()?.length ?? 0; } catch {} net.push({ url: r.url().replace(L.BASE, '').replace(L.API, 'SUPABASE').slice(0, 90), action: !!h['next-action'], len, req: r }); });
  page.on('response', (r) => { const e = net.find(n => n.req === r.request()); if (e) e.status = r.status(); });
  return net;
}
export const netSummary = (net) => ({ maxAction: Math.max(0, ...net.filter(n => n.action).map(n => n.len)), api: net.filter(n => n.url.startsWith('/api/photos')).map(n => `${n.len}B:${n.status}`).join(','), storage: net.filter(n => n.url.startsWith('SUPABASE/storage')).map(n => n.status).join(','), x5: net.filter(n => n.status >= 500).length });
export const insp = (rid, type, role) => L.psql(`select id from inspections where reservation_id='${rid}' and type='${type}' and performed_by_role='${role}' order by created_at desc limit 1`);
export const photosOf = (id) => !id ? '(sem inspeção)' : L.psql(`select coalesce(string_agg(angle::text,',' order by angle::text),'') from inspection_photos where inspection_id='${id}'`);
export const journalOf = (id) => L.journal(`target_id='${id}'`);

/** Checklist do motorista (retirada ou devolução). files: [[angle, buffer], ...] */
export async function driverChecklist(b, id, key, rid, phase, files, { damage = true, intercept } = {}) {
  const s = await L.login(b, key); const net = watch(s.page); const res = { id, key, phase };
  if (intercept) await intercept(s.page, res);
  try {
    await s.page.goto(`${L.BASE}/reservations/${rid}/${phase}`, { waitUntil: 'networkidle', timeout: 120000 });
    res.url0 = s.page.url().replace(L.BASE, '');
    const form = s.page.locator('form[data-testid="checklist-form"]');
    await form.waitFor({ timeout: 30000 });
    const odo = form.locator('input[name="odometerKm"]'); const min = Number(await odo.getAttribute('min') ?? 0); await odo.fill(String(min + (phase === 'return' ? 120 : 0)));
    if (await form.locator('select[name="fuelLevelPercent"]').count()) await form.locator('select[name="fuelLevelPercent"]').selectOption({ index: 2 });
    if (await form.locator('input[name="batteryLevelPercent"]').count()) await form.locator('input[name="batteryLevelPercent"]').fill('70');
    res.equipment = await form.locator('input[name^="equip_"]').count();
    if (damage) {
      await form.locator('.ck-check[data-tone="warn"] input[type="checkbox"]').check();
      await form.locator('textarea[name="damageNotes"]').fill('T2: risco na porta dianteira esquerda (fictício)');
      const inputs = form.locator('.ck-photos input[type="file"]');
      for (const [angle, buf] of files) { await inputs.nth(ANG.indexOf(angle)).setInputFiles(L.writeTmp(`${id}_${angle}_${buf.length}_${Math.random().toString(36).slice(2, 6)}.png`, buf)); }
      res.fieldErrors = (await form.locator('.ck-photos .text-signal-red').allInnerTexts()).join(' | ');
    }
    await s.page.screenshot({ path: `${OUT}/${id}_antes.png`, fullPage: true });
    const t0 = Date.now();
    await form.locator('button[type="submit"]').click();
    res.outcome = await Promise.race([
      s.page.waitForURL((u) => u.pathname.startsWith('/trips'), { timeout: 240000 }).then(() => 'redirecionado /trips'),
      form.locator('[role="alert"]').first().waitFor({ timeout: 240000 }).then(() => 'alerta'),
    ]).catch(() => 'timeout');
    res.ms = Date.now() - t0;
    res.alert = (await s.page.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 400);
    await s.page.screenshot({ path: `${OUT}/${id}_depois.png`, fullPage: true });
  } catch (e) { res.error = String(e?.message ?? e).slice(0, 300); await s.page.screenshot({ path: `${OUT}/${id}_erro.png`, fullPage: true }).catch(() => {}); }
  res.net = netSummary(net); res.s = s; return res;
}
export async function gateVisual(b, id, rid, phase, buf) {
  const s = await L.login(b, 'security'); const net = watch(s.page); const res = { id, phase };
  try {
    await s.page.goto(`${L.BASE}/reservations/${rid}/${phase}`, { waitUntil: 'networkidle', timeout: 120000 });
    const form = s.page.locator('form.ck-card').filter({ has: s.page.locator('input[name="reservationId"]') });
    await form.waitFor({ timeout: 30000 });
    if (buf) { await form.locator('input[name="hasDamage"]').check(); await form.locator('textarea[name="notes"]').fill('T2 portaria: avaria fictícia no para-choque'); await form.locator('input[name="photo_damage"]').setInputFiles(L.writeTmp(`${id}.png`, buf)); }
    res.validity = buf ? await form.locator('input[name="photo_damage"]').evaluate(e => e.validationMessage) : '';
    const t0 = Date.now(); await form.locator('button[type="submit"]').click();
    res.outcome = await Promise.race([s.page.waitForURL((u) => u.pathname === '/gate', { timeout: 180000 }).then(() => 'redirecionado /gate'), form.locator('[role="alert"]').first().waitFor({ timeout: 180000 }).then(() => 'alerta')]).catch(() => 'timeout/validação nativa');
    res.ms = Date.now() - t0; res.alert = (await form.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' | ');
    await s.page.screenshot({ path: `${OUT}/${id}.png`, fullPage: true });
  } catch (e) { res.error = String(e?.message ?? e).slice(0, 300); await s.page.screenshot({ path: `${OUT}/${id}_erro.png` }).catch(() => {}); }
  res.net = netSummary(net); await s.ctx.close(); return res;
}
export async function gateMove(b, rid, kind) {
  const s = await L.login(b, 'security');
  await s.page.goto(`${L.BASE}/gate/history?reservation=${rid}&kind=${kind}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.locator('textarea[name="reason"]').fill('T2 movimento físico fictício');
  await s.page.getByRole('button', { name: /Confirmar e auditar movimento/ }).click(); await s.page.waitForTimeout(3000);
  await s.ctx.close();
  return L.psql(`select count(*) from fm_gate_events where reservation_id='${rid}' and kind='${kind}'`);
}
