// F3 — P3 mecânicos (DEPOIS): T2-D02 (HEIC na edição do veículo) e T2-D07 (checklist do motorista salvo, foto de avaria pendente).
// App LOCAL. ANTES = T2 (V09 e F01, ver RELATORIO do T2).
import fs from 'node:fs';
import * as L from '../T2/scripts/lib.mjs';
import { driverChecklist, insp, photosOf } from '../T2/scripts/flows.mjs';
const F3 = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/F3';
const out = {};
const b = await L.chromium.launch({ headless: true });
// ---- T2-D02: HEIC no formulário do veículo
{
  const nameOf = () => L.psql(`select name from vehicles where plate='T3M0001'`);
  const s = await L.login(b, 'fmall'); const page = s.page;
  await page.goto(L.BASE + '/fleet', { waitUntil: 'networkidle', timeout: 120000 }); await page.waitForTimeout(1000);
  await page.locator('input[type=search]').first().fill('T3M0001'); await page.waitForTimeout(1200);
  const det = page.locator('section.vw-detail');
  await det.locator('details.vw-admin > summary').click();
  await det.locator('button', { hasText: /^Editar$/ }).first().click(); await page.waitForTimeout(800);
  const form = det.locator('form:has(input[name=plate])');
  const antes = nameOf();
  await form.locator('input[name=name]').fill('F3 heic nao deve salvar');
  await form.locator('input[name=photo]').setInputFiles({ name: 'carro.heic', mimeType: 'image/heic', buffer: Buffer.from('ftypheic-ficticio') });
  await form.locator('button[type=submit]').first().click(); await page.waitForTimeout(3000);
  out.D02 = { mensagemNaTela: (await form.locator('[role=alert]').allInnerTexts()).join(' | '), validacaoNativa: await form.locator('input[name=photo]').evaluate(e => e.validationMessage), accept: await form.locator('input[name=photo]').getAttribute('accept'),
    nomeNoBancoAntes: antes, nomeNoBancoDepois: nameOf(), pendenciasHeic: L.psql(`select count(*) from fm_photo_uploads where mime_type='image/heic' and created_at>now()-interval '5 minutes'`) };
  await page.screenshot({ path: `${F3}/shots/d02_veiculo_heic.png` });
  await s.ctx.close();
}
// ---- T2-D07: checklist do motorista com queda da foto de avaria (t2sp, reserva g4 / TDA1C04)
{
  const rid = L.psql(`select rid from t2.r where k='g4'`);
  const dmg = L.pngOfSize(500_000);
  const r = await driverChecklist(b, 'F3_D07', 't2sp', rid, 'pickup', [['damage', dmg]], {
    intercept: async (page) => { await page.route('**/storage/v1/object/vehicle-photos/**', (route) => route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()); },
  });
  const id = insp(rid, 'pickup', 'traveler');
  out.D07 = { resultado: r.outcome, mensagem: r.alert.replace(/\s+/g, ' '), linkPendentes: await r.s.page.getByRole('link', { name: /Minhas fotos pendentes/ }).count(), fotos: photosOf(id), erro: r.error };
  await r.s.page.screenshot({ path: `${F3}/shots/d07_checklist_salvo_foto_pendente.png`, fullPage: true });
  await r.s.page.unroute('**/storage/v1/object/vehicle-photos/**');
  await r.s.page.locator('form[data-testid="checklist-form"] button[type="submit"]').click();
  await r.s.page.waitForURL((u) => u.pathname.startsWith('/trips'), { timeout: 120000 }).catch(() => {});
  await r.s.page.waitForTimeout(1500);
  out.D07.reenvio = { url: r.s.page.url().replace(L.BASE, ''), retiradasDoMotorista: L.psql(`select count(*) from inspections where reservation_id='${rid}' and type='pickup' and performed_by_role='traveler'`), fotos: photosOf(insp(rid, 'pickup', 'traveler')) };
  await r.s.ctx.close();
}
await b.close();
fs.writeFileSync(`${F3}/p3_d02_d07.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
