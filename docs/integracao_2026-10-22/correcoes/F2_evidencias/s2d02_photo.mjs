// S2-D02: admin edits GWM4J14 in /fleet and attaches a VALID 8.6 MB PNG (generated in the OS temp dir, not kept),
// then (AFTER only) a valid ~3 MB PNG to prove the normal path still saves. Usage: node s2d02_photo.mjs BEFORE|AFTER
import fs from 'node:fs'; import os from 'node:os'; import zlib from 'node:zlib'; import crypto from 'node:crypto';
import { chromium, login, go, shot, save, sql } from './common.mjs';
const tag = process.argv[2] ?? 'RUN';
function png(w, h) { // random RGB pixels => incompressible, valid PNG
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; crypto.randomFillSync(raw, y * (w * 3 + 1) + 1, w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const big = os.tmpdir() + '/f2_big_8_6mb.png'; fs.writeFileSync(big, png(1693, 1693));
const small = os.tmpdir() + '/f2_ok_3mb.png'; fs.writeFileSync(small, png(1000, 1000));
const plate = 'GWM4J14';
const photoPath = () => sql(`select coalesce(photo_storage_path,'') from vehicles where plate='${plate}'`);
const browser = await chromium.launch();
const { ctx, page, log } = await login(browser, 'admin');
const responses = []; page.on('response', (r) => { if (r.request().method() === 'POST') responses.push(r.status()); });
async function openEdit() {
  await go(page, '/fleet');
  const search = page.locator('input[placeholder*="placa"]').first();
  if (await search.count()) { await search.fill(plate); await page.waitForTimeout(800); }
  await page.locator(`text=${plate}`).first().click(); await page.waitForTimeout(700);
  const summary = page.locator('summary', { hasText: plate }).first(); await summary.click(); await page.waitForTimeout(500);
  await summary.locator('xpath=..').getByRole('button', { name: 'Editar' }).first().click(); await page.waitForTimeout(500);
  return page.locator('form:has(input[name="photo"])').first();
}
async function attempt(file, label) {
  const before = photoPath(); responses.length = 0; log.http5xx.length = 0; log.pageerrors.length = 0;
  const form = await openEdit();
  await form.locator('input[name="photo"]').setInputFiles(file);
  await page.waitForTimeout(400);
  const inlineError = (await page.locator('[data-testid=vehicle-photo-too-large]').innerText().catch(() => '')).trim();
  const validity = await form.locator('input[name="photo"]').evaluate((i) => i.validationMessage);
  await form.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(8000);
  const body = await page.locator('body').innerText().catch(() => '');
  const r = { label, sizeBytes: fs.statSync(file).size, inlineError, validationMessage: validity, postStatuses: [...responses], http5xx: [...log.http5xx], pageerrors: [...log.pageerrors],
    globalErrorPage: /Algo deu errado|Something went wrong|Application error|Body exceeded/i.test(body), alerts: (await page.locator('[role=alert]').allInnerTexts()).join(' | ').slice(0, 300),
    photoChanged: photoPath() !== before };
  await shot(page, `S2-D02_${tag}_${label}`);
  return r;
}
const out = { tag, attempts: [] };
out.attempts.push(await attempt(big, 'valid_8_6MB'));
if (tag !== 'BEFORE') out.attempts.push(await attempt(small, 'valid_3MB'));
save(`S2-D02_${tag}`, out); console.log(JSON.stringify(out, null, 1));
fs.rmSync(big); fs.rmSync(small);
await ctx.close(); await browser.close();
