// T2 — V12: a foto vinculada aparece na Frota (link assinado gerado em /fleet) para admin, gestor total e gestor limitado.
import * as L from './lib.mjs';
const b = await L.chromium.launch();
const out = [];
{ // V08 deixou um WEBP sintético (bytes aleatórios, não decodificável) no TDA1A01: religa um PNG real pelo fluxo novo antes de conferir a exibição
  const s = await L.login(b, 'admin'); const buf = L.pngOfSize(200_000); const v = L.vid('TDA1A01');
  const bg = await L.apiPhotos(s, { phase: 'begin', kind: 'vehicle', target: v, angle: null, sha: L.sha(buf), size: buf.length, mime: 'image/png' });
  await L.storageUpload(s.token, bg.body.path, buf, 'image/png'); await L.apiPhotos(s, { phase: 'finish', id: bg.body.id }); await s.ctx.close(); }
for (const [key, plate] of [['admin', 'TDA1A01'], ['fmall', 'TDA1A04'], ['fmcampinas', 'TDA2A01']]) {
  const s = await L.login(b, key);
  await s.page.goto(L.BASE + '/fleet', { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.locator('.vw-filters input[type="search"]').fill(plate);
  const btn = s.page.locator('button.vw-select', { hasText: plate }).first(); await btn.click(); await s.page.waitForTimeout(2500);
  const imgs = await s.page.locator('img').evaluateAll((els) => els.filter(e => (e.getAttribute('src') ?? '').includes('vehicle-photos') || (e.currentSrc ?? '').includes('vehicle-photos')).map(e => ({ ok: e.complete && e.naturalWidth > 0 })));
  await s.page.screenshot({ path: `${L.T2}/shots/V12_${key}.png` });
  out.push(`${key}/${plate}: imagens=${imgs.length} carregadas=${imgs.filter(i => i.ok).length}`);
  await s.ctx.close();
}
L.rec('ui-vehicle.json', { id: 'V12', cenario: 'Foto vinculada exibida na Frota (link assinado) após o fluxo novo', papel: 'admin / fmall / fmcampinas', esperado: 'imagem do veículo carregada', obtido: out.join('; '), status: out.every(o => /carregadas=[1-9]/.test(o)) ? 'PASS' : 'FAIL', evidencia: out });
await b.close();
