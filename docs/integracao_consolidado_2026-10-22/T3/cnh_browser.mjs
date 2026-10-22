// T3 - CNH: envio de documentos sinteticos pela tela /account/license (navegador real, app LOCAL).
// Captura na rede o corpo da server action (multipart), extrai o arquivo realmente enviado e mede seu tamanho.
// Uso: node cnh_browser.mjs <modo: desktop|mobile|nosupport> [arquivos...]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const DOCS = 'C:/projects/fleet/_local/homolog/conclusao/T3/docs';
const SENT = 'C:/projects/fleet/_local/homolog/conclusao/T3/sent';
const EVD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const users = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json', 'utf8'));
const mode = process.argv[2] || 'desktop';
const ALL = ['img_1mib.jpg', 'img_2_9mib.jpg', 'img_3_5mib.jpg', 'img_4_9mib.jpg', 'jpg_12mp_4_5mib.jpg', 'png_4_5mib.png', 'jpg_50mp_4mib.jpg', 'img_6mib.jpg',
  'invalido.txt', 'pdf_1p_pequeno.pdf', 'pdf_3p_pequeno.pdf', 'pdf_1p_4mib.pdf', 'pdf_3p_4mib.pdf', 'pdf_5p_4mib.pdf', 'pdf_6p_4mib.pdf', 'pdf_8p_4mib.pdf', 'pdf_9p_4mib.pdf',
  'pdf_2p_6mib.pdf', 'pdf_protegido_4mib.pdf', 'pdf_protegido_pequeno.pdf', 'pdf_corrompido_4mib.pdf'];
const files = process.argv.slice(3).length ? process.argv.slice(3) : ALL;
fs.mkdirSync(SENT, { recursive: true });

function multipartFiles(buf, ctype) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype || ''); if (!m) return [];
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const parts = []; let i = buf.indexOf(boundary);
  while (i >= 0) {
    const next = buf.indexOf(boundary, i + boundary.length); if (next < 0) break;
    const part = buf.subarray(i + boundary.length + 2, next - 2);
    const he = part.indexOf('\r\n\r\n'); const head = part.subarray(0, he).toString('latin1'); const body = part.subarray(he + 4);
    const name = /name="([^"]*)"/.exec(head)?.[1]; const filename = /filename="([^"]*)"/.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
    parts.push({ name, filename, type, size: body.length, body, isFile: filename !== undefined });
    i = next;
  }
  return parts;
}

const ctxOpts = mode === 'mobile' || mode === 'nosupport'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' }
  : { viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext(ctxOpts);
if (mode === 'nosupport') {
  // simula navegador sem suporte a preparacao local: sem createImageBitmap e sem Worker de modulo
  await ctx.addInitScript(() => { try { delete window.createImageBitmap; } catch {} window.createImageBitmap = undefined; window.Worker = undefined; });
}
// Observa no navegador o FormData que vai para a rede (Playwright nao expoe corpo multipart com arquivo).
let current = null;
await ctx.exposeFunction('__t3sent', (meta, b64) => {
  if (!current) return;
  const rec = { ...meta };
  if (b64) { const ext = (meta.type || '').includes('pdf') ? 'pdf' : (meta.type || '').includes('png') ? 'png' : 'jpg'; const out = `${SENT}/${mode}_${current.file}_send${current.sent.length + 1}.${ext}`; fs.writeFileSync(out, Buffer.from(b64, 'base64')); rec.saved = out; }
  current.sent.push(rec);
});
await ctx.addInitScript(() => {
  const orig = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const h = init && init.headers; const isAction = h && (h['Next-Action'] || h['next-action'] || (h.get && h.get('Next-Action')));
      if (isAction && init.body instanceof FormData) {
        for (const [k, v] of init.body.entries()) {
          if (v instanceof File) {
            const bytes = new Uint8Array(await v.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            await window.__t3sent({ field: k, name: v.name, type: v.type, size: v.size }, bytes.length ? btoa(s) : '');
          }
        }
        if (![...init.body.values()].some(v => v instanceof File)) await window.__t3sent({ field: 'none', size: 0 }, '');
      }
    } catch (e) { /* observacao apenas */ }
    return orig.apply(this, arguments);
  };
});
const page = await ctx.newPage();
const user = users.t3up;
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.fill('input[name="email"]', user.email); await page.fill('input[name="password"]', user.password);
await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 120000 }).catch(() => {}), page.click('button[type="submit"]')]);
const results = [];
for (const name of files) {
  const r = { file: name, mode, inputBytes: fs.statSync(path.join(DOCS, name)).size, requests: [], messages: [], consoleErrors: [], pageErrors: [] };
  const onC = m => { if (m.type() === 'error') r.consoleErrors.push(m.text().slice(0, 200)); };
  const onE = e => r.pageErrors.push(String(e).slice(0, 200));
  r.sent = []; current = r;
  const onReq = async req => {
    if (req.method() !== 'POST') return; const ah = await req.allHeaders().catch(() => ({}));
    const sizes = await req.sizes().catch(() => null);
    const resp = await req.response().catch(() => null);
    r.requests.push({ url: req.url().replace(BASE, ''), requestBodySize: sizes ? sizes.requestBodySize : null, status: resp ? resp.status() : null, action: !!ah['next-action'], contentLength: ah['content-length'] || null });
  };
  page.on('console', onC); page.on('pageerror', onE); const pend = []; const onReqW = () => {}; page.on('requestfinished', onReqW); const onAny = q => { if (q.method() === 'POST') { r.posts = (r.posts || 0) + 1; pend.push(onReq(q)); } }; page.on('request', onAny);
  await page.goto(BASE + '/account/license', { waitUntil: 'domcontentloaded', timeout: 120000 });
  r.landed = new URL(page.url()).pathname;
  await page.waitForSelector('input[type=file][accept="image/*,application/pdf"]', { state: 'attached', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1500);
  const t0 = Date.now();
  await page.setInputFiles('input[type=file][accept="image/*,application/pdf"]', path.join(DOCS, name));
  await page.waitForTimeout(400);
  const submit = page.locator('form:has(input[accept="image/*,application/pdf"]) button[type=submit]');
  r.submitEnabledAfterPick = await submit.isEnabled();
  r.pickError = (await page.locator('[role=alert]').allInnerTexts()).join(' | ');
  if (r.submitEnabledAfterPick) {
    await submit.click();
    // espera terminar (botao volta a ficar habilitado ou mensagem aparece)
    await page.waitForFunction(() => { const b = document.querySelector('input[accept="image/*,application/pdf"]').closest('form').querySelector('button[type=submit]'); return b && !b.disabled && !/Analisando|Lendo/i.test(b.textContent || ''); }, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(800);
    r.ms = Date.now() - t0;
    r.messages = await page.locator('[role=alert], [role=status]').allInnerTexts();
    r.fileStillShown = await page.locator(`text=${name}`).count() > 0;
    r.submitLabel = (await submit.innerText().catch(() => '')).trim();
    r.submitEnabledAfterFail = await submit.isEnabled().catch(() => null);
    if (name === 'img_3_5mib.jpg' || name === 'pdf_3p_4mib.pdf' || name === 'img_1mib.jpg') {
      // reenvio: o original continua selecionado e e preparado de novo
      const before = r.sent.length;
      await submit.click();
      await page.waitForFunction(() => { const b = document.querySelector('input[accept="image/*,application/pdf"]').closest('form').querySelector('button[type=submit]'); return b && !b.disabled && !/Analisando|Lendo/i.test(b.textContent || ''); }, null, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(800);
      r.retry = { newRequests: r.sent.length - before, messages: await page.locator('[role=alert], [role=status]').allInnerTexts() };
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${EVD}/shots/cnh_${mode}_${name.replace(/\./g, '_')}.png`, fullPage: true });
  page.off('console', onC); page.off('pageerror', onE); await Promise.all(pend); page.off('requestfinished', onReqW);
  results.push(r);
  console.log(JSON.stringify({ f: name, in: r.inputBytes, en: r.submitEnabledAfterPick, pickErr: r.pickError, sent: r.sent.map(s => s.type + ':' + s.size), net: r.requests.map(q => q.requestBodySize + '/' + q.contentLength + '/' + q.status), msg: r.messages, posts: r.posts, retry: r.retry && r.retry.newRequests, ms: r.ms, cerr: [...r.consoleErrors, ...r.pageErrors] }));
}
fs.writeFileSync(`${EVD}/cnh_${mode}.json`, JSON.stringify(results, (k, v) => k === 'body' ? undefined : v, 1));
await browser.close();








