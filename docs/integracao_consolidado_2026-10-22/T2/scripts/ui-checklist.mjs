// T2 — Cenário 2: checklists de retirada/devolução pela UI real com MÚLTIPLAS fotos (ângulos + avaria),
// São Paulo (gate_visual: motorista + portaria + movimentos) e Campinas/Rio (custódia), evidência adicional.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { ANG, RES as RESF, watch, netSummary, insp, photosOf, journalOf, driverChecklist, gateVisual, gateMove } from './flows.mjs';
const FILE = 'ui-checklist.json'; const OUT = L.T2 + '/shots';
const MiB = 1024 * 1024;
const RES = RESF();
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; const run = (id) => !ONLY || ONLY.includes(id);
function verdict(id, cenario, papel, res, inspId, expectAngles) {
  const got = inspId ? photosOf(inspId) : ''; const j = inspId ? journalOf(inspId) : [];
  const allOk = j.length > 0 && j.every(x => x.state === 'linked' && x.verified);
  const pass = res.outcome?.startsWith('redirecionado') && got === expectAngles && allOk && res.net.maxAction < 65536 && res.net.x5 === 0;
  L.rec(FILE, { id, cenario, papel, esperado: `checklist salvo; fotos [${expectAngles}] vinculadas e verificadas; actions sem bytes`, obtido: `${res.outcome} (${res.ms}ms); fotos=[${got}]; jornal ${j.filter(x => x.state === 'linked').length}/${j.length} linked; action máx=${res.net.maxAction}B; /api/photos=${res.net.api}; storage=${res.net.storage}; 5xx=${res.net.x5}; equipamentos=${res.equipment ?? '-'}; ${res.alert ?? ''} ${res.fieldErrors ?? ''} ${res.error ?? ''}`, status: pass ? 'PASS' : 'FAIL', evidencia: { ...res, s: undefined, inspection: inspId, journal: j } });
}
const b = await L.chromium.launch({ headless: true });
const P = (n) => L.pngOfSize(n);
// ---- São Paulo (gate_visual) ----
if (run('C01')) {
  const files = [['front', P(400_000)], ['front', P(350_000)], ['back', P(Math.round(4.5 * MiB))], ['wheels', P(200_000)], ['damage', P(700_000)], ['damage', P(650_000)]];
  const r = await driverChecklist(b, 'C01', 't2sp', RES.sp1, 'pickup', files); await r.s.ctx.close();
  verdict('C01', 'SP retirada (motorista) com 6 fotos: 2×frente, traseira 4,5 MiB, rodas, 2×avaria', 't2sp / SP gate_visual', r, insp(RES.sp1, 'pickup', 'traveler'), 'back,damage,damage,front,front,wheels');
}
if (run('C02')) {
  const r = await gateVisual(b, 'C02', RES.sp1, 'pickup', P(900_000));
  const id = insp(RES.sp1, 'pickup', 'security');
  verdict('C02', 'SP portaria: conferência visual de retirada com avaria + foto (GateVisualForm)', 'security / SP', r, id, 'damage');
}
if (run('C03')) {
  // A avaria registrada na retirada (C01/C02) bloqueia a saída por regra; a devolução SP usa a reserva sp2 retirada sem avaria (sem fotos: a UI só pede fotos com avaria).
  const r1 = await driverChecklist(b, 'C03a', 't2sp', RES.sp2, 'pickup', [], { damage: false }); await r1.s.ctx.close();
  const r2 = await gateVisual(b, 'C03b', RES.sp2, 'pickup', null);
  const d = await gateMove(b, RES.sp2, 'departure'); const a = await gateMove(b, RES.sp2, 'arrival');
  L.rec(FILE, { id: 'C03', cenario: 'SP reserva sp2: retirada sem avaria (motorista+portaria) + saída e chegada físicas (pré-requisito da devolução)', papel: 'security', esperado: '1 saída e 1 chegada', obtido: `retirada=${r1.outcome}; portaria=${r2.outcome}; saídas=${d} chegadas=${a}`, status: d === '1' && a === '1' ? 'PASS' : 'FAIL', evidencia: {} });
}
if (run('C04')) {
  const files = [['left_side', P(300_000)], ['right_side', P(300_000)], ['interior', P(1_200_000)], ['damage', P(500_000)], ['damage', P(Math.round(4.9 * MiB))]];
  const r = await driverChecklist(b, 'C04', 't2sp', RES.sp2, 'return', files); await r.s.ctx.close();
  verdict('C04', 'SP devolução (motorista) com 5 fotos incl. avaria 4,9 MiB', 't2sp / SP', r, insp(RES.sp2, 'return', 'traveler'), 'damage,damage,interior,left_side,right_side');
}
if (run('C05')) {
  const r = await gateVisual(b, 'C05', RES.sp2, 'return', P(Math.round(4.8 * MiB)));
  verdict('C05', 'SP portaria: conferência visual de devolução com avaria + foto 4,8 MiB', 'security / SP', r, insp(RES.sp2, 'return', 'security'), 'damage');
}
// ---- Campinas e Rio (custódia) ----
for (const [id, key, k, phase, files, papel] of [
  ['C06', 't2camp', 'camp', 'pickup', [['front', P(500_000)], ['back', P(500_000)], ['damage', P(800_000)]], 't2camp / Campinas key_custody'],
  ['C07', 't2camp', 'camp', 'return', [['wheels', P(300_000)], ['wheels', P(310_000)], ['damage', P(2 * MiB)]], 't2camp / Campinas key_custody'],
  ['C08', 't2rio', 'rio', 'pickup', [['interior', P(600_000)], ['damage', P(Math.round(3 * MiB))], ['damage', P(400_000)]], 't2rio / Rio key_custody'],
  ['C09', 't2rio', 'rio', 'return', [['front', P(250_000)], ['left_side', P(250_000)], ['damage', P(250_000)]], 't2rio / Rio key_custody'],
]) {
  if (!run(id)) continue;
  const r = await driverChecklist(b, id, key, RES[k], phase, files); await r.s.ctx.close();
  verdict(id, `${k === 'camp' ? 'Campinas' : 'Rio'} ${phase === 'pickup' ? 'retirada' : 'devolução'} com ${files.length} fotos (${files.map(f => f[0]).join(', ')})`, papel, r, insp(RES[k], phase, 'traveler'), files.map(f => f[0]).sort().join(','));
}
// ---- Evidência adicional (reservations/[id]/evidence) ----
if (run('C10')) {
  const s = await L.login(b, 't2sp'); const net = watch(s.page); const ins = insp(RES.sp1, 'pickup', 'traveler'); const before = photosOf(ins);
  const res = {};
  try {
    await s.page.goto(`${L.BASE}/reservations/${RES.sp1}/evidence/${ins}`, { waitUntil: 'networkidle', timeout: 120000 });
    await s.page.locator('select[name="angle"]').selectOption('interior');
    await s.page.locator('input[name="files"]').setInputFiles([L.writeTmp('C10a.png', P(Math.round(8.6 * MiB))), L.writeTmp('C10b.png', P(600_000))]);
    await s.page.getByRole('button', { name: 'Adicionar fotos' }).click();
    await s.page.locator('form [role="status"], form [role="alert"]').first().waitFor({ timeout: 180000 });
    res.msg = (await s.page.locator('form [role="status"], form [role="alert"]').allInnerTexts()).join(' | ');
    await s.page.screenshot({ path: `${OUT}/C10.png`, fullPage: true });
  } catch (e) { res.error = String(e?.message ?? e).slice(0, 300); }
  const after = photosOf(ins); const ns = netSummary(net);
  L.rec(FILE, { id: 'C10', cenario: 'Evidência adicional: 2 fotos "interior" (8,6 MiB + 0,6 MiB) na própria inspeção de retirada', papel: 't2sp / SP', esperado: 'fotos anteriores preservadas + 2 novas; action sem bytes', obtido: `antes=[${before}] depois=[${after}] msg="${res.msg}" action máx=${ns.maxAction}B api=${ns.api} ${res.error ?? ''}`, status: after.split(',').length === before.split(',').length + 2 && /adicionadas/.test(res.msg ?? '') && ns.maxAction < 65536 ? 'PASS' : 'FAIL', evidencia: { before, after, ns } });
  await s.ctx.close();
}
await b.close();
