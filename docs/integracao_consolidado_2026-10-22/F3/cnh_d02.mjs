// F3 — D-T3-02: fotos de CNH de 12 MP (ruído forte) e 50 MP entre 3 e 5 MiB na tela /account/license (navegador real, app LOCAL).
// Captura no navegador o arquivo realmente enviado à server action (mesma técnica do T3/cnh_browser.mjs). A IA não é chamada de verdade
// no ambiente local ("falha IA" é esperado); o que importa é se a foto é preparada (≤ 3 MiB) e enviada, ou recusada e com qual mensagem.
// Uso: MODE=antes|depois node cnh_d02.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const MODE = process.env.MODE;
const F3 = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/F3';
const DOCS = 'C:/Users/remoto/AppData/Local/Temp/claude/c--projects-fleet/c9b2838b-745c-4a4f-97f8-1c56252460c4/scratchpad/f3_docs';
const SENT = DOCS + '/sent'; fs.mkdirSync(SENT, { recursive: true });
const user = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json', 'utf8')).t3up;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
let current = null;
await ctx.exposeFunction('__f3sent', (meta, b64) => { if (!current) return; const rec = { ...meta }; if (b64) { const p = `${SENT}/${MODE}_${current.arquivo}_enviado.jpg`; fs.writeFileSync(p, Buffer.from(b64, 'base64')); rec.salvo = p; } current.enviado.push(rec); });
await ctx.addInitScript(() => {
  const orig = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const h = init && init.headers; const isAction = h && (h['Next-Action'] || h['next-action'] || (h.get && h.get('Next-Action')));
      if (isAction && init.body instanceof FormData) for (const [k, v] of init.body.entries()) if (v instanceof File) {
        const bytes = new Uint8Array(await v.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        let dims = null; try { const bm = await createImageBitmap(v); dims = `${bm.width}x${bm.height}`; bm.close(); } catch {}
        await window.__f3sent({ campo: k, tipo: v.type, bytes: v.size, dimensoes: dims }, btoa(s));
      }
    } catch { /* observação apenas */ }
    return orig.apply(this, arguments);
  };
});
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.fill('input[name="email"]', user.email); await page.fill('input[name="password"]', user.password);
await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 120000 }).catch(() => {}), page.click('button[type="submit"]')]);
const results = [];
for (const file of ["f3_12mp_ruido.jpg", "f3_50mp_ruido.jpg", "f3_ruido_extremo.jpg"]) {
  const r = { arquivo: file, bytesEntrada: fs.statSync(`${DOCS}/${file}`).size, enviado: [] }; current = r;
  await page.goto(BASE + '/account/license', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const input = 'input[type=file][accept="image/*,application/pdf"]';
  await page.waitForSelector(input, { state: 'attached', timeout: 60000 }); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200);
  const t0 = Date.now();
  await page.setInputFiles(input, `${DOCS}/${file}`); await page.waitForTimeout(400);
  const submit = page.locator(`form:has(${input}) button[type=submit]`);
  await submit.click();
  await page.waitForFunction((sel) => { const b = document.querySelector(sel)?.closest('form')?.querySelector('button[type=submit]'); return b && !b.disabled && !/Analisando|Lendo/i.test(b.textContent || ''); }, input, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(1000);
  r.ms = Date.now() - t0;
  r.mensagens = (await page.locator('[role=alert], [role=status]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).filter(Boolean);
  r.originalAindaSelecionado = await page.locator(`text=${file}`).count() > 0;
  r.resultado = r.enviado.length ? `ENVIADO ${r.enviado[0].tipo} ${r.enviado[0].bytes} B ${r.enviado[0].dimensoes ?? ''} (limite 3.145.728 B)` : 'RECUSADO NA PREPARAÇÃO (nada enviado)';
  await page.screenshot({ path: `${F3}/shots/cnh_${MODE}_${file.replace(/\./g, '_')}.png`, fullPage: true });
  results.push(r); console.log(JSON.stringify(r));
}
await browser.close();
fs.writeFileSync(`${F3}/cnh_d02_${MODE}.json`, JSON.stringify(results, null, 1));
