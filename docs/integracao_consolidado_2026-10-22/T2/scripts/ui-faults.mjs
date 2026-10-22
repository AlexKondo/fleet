// T2 — Cenário 3 (parte UI): quedas injetadas no navegador real (Playwright route) e recuperação pela UI
// (/account/photos: "Minhas fotos pendentes"). Nada é apagado; verificação no banco/Storage local.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { RES as RESF, watch, netSummary, insp, photosOf, journalOf, driverChecklist, gateVisual } from './flows.mjs';
const FILE = 'ui-faults.json'; const OUT = L.T2 + '/shots';
const RES = RESF();
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; const run = (id) => !ONLY || ONLY.includes(id);
const b = await L.chromium.launch({ headless: true });

/** Recupera uma pendência pela tela /account/photos escolhendo `file` no cartão cuja sha = `sha`. */
async function recoverUI(key, id, wantSha, file, { restart = false } = {}) {
  const s = await L.login(b, key); const res = {};
  await s.page.goto(L.BASE + '/account/photos', { waitUntil: 'networkidle', timeout: 120000 });
  res.cards = await s.page.locator('article.fm-card').count();
  const pend = await L.rpc(s.token, 'fm_photo_pending', {}); res.pendingApi = (pend.body ?? []).map(p => p.sha256.slice(0, 8));
  const idx = (pend.body ?? []).findIndex(p => p.sha256 === wantSha); res.idx = idx;
  if (idx < 0) { await s.page.screenshot({ path: `${OUT}/${id}_recover.png`, fullPage: true }); await s.ctx.close(); return res; }
  const card = s.page.locator('article.fm-card').nth(idx);
  if (restart) {
    await card.getByRole('button', { name: /Preparar nova tentativa/ }).click();
    await card.locator('[role="status"]').waitFor({ timeout: 60000 }).catch(() => {}); res.restartMsg = await card.locator('[role="status"]').innerText().catch(() => '');
    await s.page.waitForTimeout(1500);
  }
  await card.locator('input[type="file"]').setInputFiles(file);
  await card.getByRole('button', { name: /Reenviar e verificar/ }).click();
  const t0 = Date.now(); let st = '';
  for (let i = 0; i < 120; i++) { await s.page.waitForTimeout(500); st = L.journal(`id='${pend.body[idx].id}'`)[0]?.state; const m = await card.locator('[role="status"]').innerText({ timeout: 200 }).catch(() => ''); if (m) { res.msg = m; break; } if (st === 'linked') { res.msg = '(cartão saiu da lista após concluir)'; break; } }
  res.ms = Date.now() - t0; res.state = st;
  await s.page.screenshot({ path: `${OUT}/${id}_recover.png`, fullPage: true });
  await s.ctx.close(); return res;
}

// F01 — upload interrompido no meio (requisição ao Storage abortada) na retirada SP com avaria.
if (run('F01')) {
  const front = L.pngOfSize(300_000), dmg = L.pngOfSize(800_000); const dmgFile = L.writeTmp('F01_damage.png', dmg);
  const r = await driverChecklist(b, 'F01', 't2sp', RES.g1, 'pickup', [['front', front], ['damage', dmg]], {
    intercept: async (page, res) => { res.aborted = 0; await page.route('**/storage/v1/object/vehicle-photos/**', async (route) => { if (route.request().method() === 'POST' && route.request().url().includes('damage_')) { res.aborted++; return route.abort('connectionreset'); } return route.continue(); }); },
  });
  const ins = insp(RES.g1, 'pickup', 'traveler');
  const j = L.journal(`sha256='${L.sha(dmg)}'`); const obj = j[0] ? L.objects(j[0].path) : []; const photosBefore = photosOf(ins);
  // Reenvio do MESMO formulário (botão continua visível) sem a queda
  await r.s.page.unroute('**/storage/v1/object/vehicle-photos/**');
  await r.s.page.locator('form[data-testid="checklist-form"] button[type="submit"]').click().catch(() => {});
  await r.s.page.waitForTimeout(6000);
  const resubmit = (await r.s.page.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' | ');
  await r.s.page.screenshot({ path: `${OUT}/F01_reenvio_form.png`, fullPage: true }); await r.s.ctx.close();
  const pickups = L.psql(`select count(*) from inspections where reservation_id='${RES.g1}' and type='pickup' and performed_by_role='traveler'`);
  L.rec(FILE, { id: 'F01', cenario: 'Upload da foto de AVARIA interrompido no meio (Storage abortado) durante a retirada SP', papel: 't2sp / SP', esperado: 'checklist salvo; UI informa avaria pendente; jornal pending sem objeto; nada apagado', obtido: `${r.outcome}; alerta="${r.alert}"; abortadas=${r.aborted}; fotos=[${photosBefore}]; jornal=${j.map(x => x.state).join(',')}; objeto=${obj.length}`, status: r.alert.includes('avaria') && j[0]?.state === 'pending' && obj.length === 0 && photosBefore === 'front' ? 'PASS' : 'FAIL', evidencia: { r: { ...r, s: undefined }, j, obj } });
  L.rec(FILE, { id: 'F01b', cenario: 'Após F01, motorista clica novamente "Registrar retirada" no mesmo formulário (sem queda)', papel: 't2sp / SP', esperado: 'concluir só a foto pendente, sem 2º checklist; ou orientar para Minhas fotos pendentes', obtido: `alerta="${resubmit}"; inspeções de retirada=${pickups}; fotos=[${photosOf(ins)}]; jornal=${L.journal(`sha256='${L.sha(dmg)}'`).map(x => x.state).join(',')}`, status: pickups === '1' && photosOf(ins).includes('damage') ? 'PASS' : 'FAIL', evidencia: {} });
}
// F02 — queda APÓS o upload e ANTES da atestação (finish não chega ao servidor).
if (run('F02')) {
  const dmg = L.pngOfSize(1_500_000); const dmgFile = L.writeTmp('F02_damage.png', dmg);
  const r = await driverChecklist(b, 'F02', 't2sp', RES.g2, 'pickup', [['damage', dmg]], {
    intercept: async (page, res) => { res.dropped = 0; await page.route('**/api/photos', async (route) => { if ((route.request().postData() ?? '').includes('"finish"')) { res.dropped++; return route.abort('connectionreset'); } return route.continue(); }); },
  });
  await r.s.ctx.close();
  const ins = insp(RES.g2, 'pickup', 'traveler'); const j = L.journal(`sha256='${L.sha(dmg)}'`); const obj = j[0] ? L.objects(j[0].path) : [];
  L.rec(FILE, { id: 'F02', cenario: 'Queda após upload e antes da atestação (POST finish abortado)', papel: 't2sp / SP', esperado: 'checklist salvo; objeto no Storage; jornal pending NÃO verificado; sem vínculo', obtido: `${r.outcome}; alerta="${r.alert}"; finish abortados=${r.dropped}; objeto=${obj.length} (${obj[0]?.size}B owner ok=${obj[0]?.owner === L.USERS.t2sp.id}); jornal=${j.map(x => x.state + (x.verified ? '+v' : '-v')).join(',')}; fotos=[${photosOf(ins)}]`, status: obj.length === 1 && j[0]?.state === 'pending' && !j[0]?.verified && photosOf(ins) === '' ? 'PASS' : 'FAIL', evidencia: { j, obj } });
  const wrong = L.writeTmp('F02_wrong.png', L.pngOfSize(1_500_000));
  const rw = await recoverUI('t2sp', 'F02w', L.sha(dmg), wrong);
  L.rec(FILE, { id: 'F02w', cenario: 'Recuperação escolhendo um arquivo DIFERENTE (mesmo tamanho)', papel: 't2sp', esperado: 'mensagem "Selecione o arquivo original"; nada enviado', obtido: `msg="${rw.msg}"; jornal=${L.journal(`sha256='${L.sha(dmg)}'`).map(x => x.state).join(',')}`, status: /original/.test(rw.msg ?? '') ? 'PASS' : 'FAIL', evidencia: rw });
  const rv = await recoverUI('t2sp', 'F02r', L.sha(dmg), dmgFile);
  const j2 = L.journal(`sha256='${L.sha(dmg)}'`);
  L.rec(FILE, { id: 'F02r', cenario: 'Recuperação com o ORIGINAL (objeto já existe → 409 no Storage, servidor verifica e finaliza)', papel: 't2sp', esperado: 'Foto concluída; vínculo; mesmo objeto (sem sobrescrita)', obtido: `msg="${rv.msg}"; fotos=[${photosOf(ins)}]; jornal=${j2.map(x => x.state + (x.verified ? '+v' : '')).join(',')}; objeto inalterado=${JSON.stringify(L.objects(j2[0].path)[0]?.created_at) === JSON.stringify(obj[0]?.created_at)}`, status: photosOf(ins) === 'damage' && j2[0].state === 'linked' ? 'PASS' : 'FAIL', evidencia: rv });
}
// F03 — portaria: foto de avaria falha (Storage abortado) → conferência salva sem foto; novo clique; recuperação.
if (run('F03')) {
  const dmg = L.pngOfSize(700_000); const dmgFile = L.writeTmp('F03.png', dmg);
  const s = await L.login(b, 'security'); const net = watch(s.page); const res = {};
  await s.page.route('**/storage/v1/object/vehicle-photos/**', (route) => route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue());
  await s.page.goto(`${L.BASE}/reservations/${RES.g3}/pickup`, { waitUntil: 'networkidle', timeout: 120000 });
  const form = s.page.locator('form.ck-card').filter({ has: s.page.locator('input[name="reservationId"]') });
  await form.locator('input[name="hasDamage"]').check(); await form.locator('textarea[name="notes"]').fill('T2 portaria F03'); await form.locator('input[name="photo_damage"]').setInputFiles(dmgFile);
  await form.locator('button[type="submit"]').click();
  for (let i = 0; i < 30; i++) { await s.page.waitForTimeout(500); const a = await s.page.locator('[role="alert"]').allInnerTexts().catch(() => []); if (a.join('').trim()) { res.alert1 = a.join(' | '); break; } if (s.page.url().includes('/evidence/')) break; }
  await s.page.waitForTimeout(3000);
  res.alert1 = res.alert1 ?? ''; res.url = s.page.url().replace(L.BASE, ''); res.textAfter = (await s.page.locator('main').innerText().catch(() => '')).slice(0, 300);
  await s.page.unroute('**/storage/v1/object/vehicle-photos/**');
  res.alert2 = '(não aplicável: formulário não está mais na tela)';
  await s.page.screenshot({ path: `${OUT}/F03.png`, fullPage: true }); await s.ctx.close();
  const ins = insp(RES.g3, 'pickup', 'security'); const n = L.psql(`select count(*) from inspections where reservation_id='${RES.g3}' and type='pickup' and performed_by_role='security'`);
  L.rec(FILE, { id: 'F03', cenario: 'Portaria (GateVisualForm): upload da foto de avaria cai; operador clica novamente', papel: 'security / SP', esperado: 'mensagem específica (conferência salva, foto pendente) e caminho de recuperação; 2º clique conclui a foto sem 2ª conferência', obtido: `alerta após falha="${res.alert1}"; url final=${res.url}; texto="${res.textAfter?.replace(/\s+/g,' ').slice(0,160)}"; conferências=${n}; fotos=[${photosOf(ins)}]; jornal=${L.journal(`sha256='${L.sha(dmg)}'`).map(x => x.state).join(',')}`, status: n === '1' && /foto/i.test(res.alert1) ? 'PASS' : 'FAIL', evidencia: { res, net: netSummary(net) } });
  const rv = await recoverUI('security', 'F03r', L.sha(dmg), dmgFile);
  L.rec(FILE, { id: 'F03r', cenario: 'Recuperação da foto da portaria por /account/photos', papel: 'security', esperado: 'Foto concluída; vínculo na conferência', obtido: `msg="${rv.msg}"; fotos=[${photosOf(ins)}]`, status: photosOf(ins) === 'damage' ? 'PASS' : 'FAIL', evidencia: rv });
}
// F04 — foto do VEÍCULO: finish abortado → dados salvos, foto pendente; recuperação pela conta; nova tentativa (restart) preservando original.
if (run('F04')) {
  const plate = 'TDA1A04'; const vid = L.vid(plate); const buf = L.pngOfSize(2_000_000); const f = L.writeTmp('F04.png', buf);
  const s = await L.login(b, 'fmall'); const res = {};
  await s.page.route('**/api/photos', (route) => (route.request().postData() ?? '').includes('"finish"') ? route.abort('connectionreset') : route.continue());
  await s.page.goto(L.BASE + '/fleet', { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.locator('.vw-filters input[type="search"]').fill(plate); await s.page.locator('button.vw-select', { hasText: plate }).first().click();
  await s.page.locator('details.vw-admin summary', { hasText: plate }).click();
  const card = s.page.locator('details.vw-admin li').filter({ has: s.page.locator('p.font-mono', { hasText: plate }) }).first();
  await card.getByRole('button', { name: 'Editar' }).click();
  const before = L.psql(`select photo_storage_path from vehicles where id='${vid}'`);
  await card.locator('input[name="name"]').fill('T2 F04 nome alterado');
  await card.locator('input[name="photo"]').setInputFiles(f); await card.getByRole('button', { name: 'Salvar alterações' }).click();
  await card.locator('[role="alert"], .text-signal-red').first().waitFor({ timeout: 120000 }).catch(() => {});
  res.alert = (await card.locator('[role="alert"], .text-signal-red').allInnerTexts().catch(() => [])).join(' | ');
  await s.page.screenshot({ path: `${OUT}/F04.png` }); await s.ctx.close();
  const after = L.psql(`select photo_storage_path||' | '||name from vehicles where id='${vid}'`);
  const j = L.journal(`sha256='${L.sha(buf)}'`);
  L.rec(FILE, { id: 'F04', cenario: 'Editar veículo: queda antes da atestação (finish abortado)', papel: 'fmall', esperado: 'dados salvos; foto anterior mantida; mensagem de pendência; jornal pending', obtido: `alerta="${res.alert}"; foto mantida=${after.startsWith(before)}; ${after.split(' | ')[1]}; jornal=${j.map(x => x.state).join(',')}`, status: after.startsWith(before) && /pendente/.test(res.alert) && j[0]?.state === 'pending' ? 'PASS' : 'FAIL', evidencia: { before, after, j } });
  const oldPath = j[0].path;
  const rv = await recoverUI('fmall', 'F04r', L.sha(buf), f, { restart: true });
  const j2 = L.journal(`sha256='${L.sha(buf)}'`); const hist = L.psql(`select count(*) from fm_photo_attempt_history where upload_id='${j[0].id}' and storage_path='${oldPath}'`);
  const now = L.psql(`select photo_storage_path from vehicles where id='${vid}'`);
  L.rec(FILE, { id: 'F04r', cenario: 'Pendência do veículo: "Preparar nova tentativa preservando o original" + reenvio do original', papel: 'fmall', esperado: 'caminho rotacionado; tentativa antiga no histórico e objeto antigo preservado; nova foto vinculada', obtido: `restart="${rv.restartMsg}"; msg="${rv.msg}"; novo caminho=${j2[0]?.path !== oldPath}; histórico=${hist}; objeto antigo=${L.objects(oldPath).length}; veículo aponta p/ novo=${now === j2[0]?.path}; jornal=${j2.map(x => x.state).join(',')}`, status: j2[0]?.path !== oldPath && hist === '1' && L.objects(oldPath).length === 1 && now === j2[0]?.path && j2[0]?.state === 'linked' ? 'PASS' : 'FAIL', evidencia: { rv, j2 } });
}
// F05 — checklist acima de 5 MiB no campo de foto (cliente) e na portaria (validação nativa).
if (run('F05')) {
  const big = L.pngOfSize(Math.round(8.6 * 1024 * 1024));
  const s = await L.login(b, 't2sp');
  await s.page.goto(`${L.BASE}/reservations/${RES.g4}/pickup`, { waitUntil: 'networkidle', timeout: 120000 });
  const form = s.page.locator('form[data-testid="checklist-form"]');
  await form.locator('.ck-check[data-tone="warn"] input[type="checkbox"]').check();
  await form.locator('.ck-photos input[type="file"]').nth(6).setInputFiles(L.writeTmp('F05.png', big));
  const msg = (await form.locator('.ck-photos .text-signal-red').allInnerTexts()).join(' | ');
  await s.page.screenshot({ path: `${OUT}/F05.png`, fullPage: true }); await s.ctx.close();
  L.rec(FILE, { id: 'F05', cenario: 'Checklist (retirada): foto de avaria 8,6 MiB', papel: 't2sp', esperado: 'decisão: o transporte novo e /evidence aceitam até 10 MB; o campo do checklist ainda recusa >5 MB', obtido: `mensagem="${msg}"`, status: /5 ?MB/i.test(msg) ? 'OBS' : 'FAIL', evidencia: {} });
}
await b.close();
