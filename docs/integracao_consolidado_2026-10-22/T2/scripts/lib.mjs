// T2 — utilitários comuns (LOCAL apenas). Nenhuma chave/senha é impressa.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
export const { chromium } = require('playwright');
export const BASE = 'http://localhost:3100';
export const API = 'http://127.0.0.1:55321';
export const T2 = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T2';
export const SCR = 'C:/Users/remoto/AppData/Local/Temp/claude/c--projects-fleet/c9b2838b-745c-4a4f-97f8-1c56252460c4/scratchpad';
const env = Object.fromEntries(fs.readFileSync(SCR + '/env.txt', 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
if (!/^http:\/\/127\.0\.0\.1:55321$/.test(env.API_URL)) throw new Error('NOT LOCAL');
export const ANON = env.ANON_KEY; export const SERVICE = env.SERVICE_ROLE_KEY;
const seedUsers = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/design/users.json', 'utf8'));
const t2Users = JSON.parse(fs.readFileSync(SCR + '/t2cred.json', 'utf8'));
export const USERS = { ...seedUsers, ...t2Users };
export const ORG = '00000000-0000-0000-0000-000000000001';
export function psql(sql) {
  const p = spawnSync('docker', ['exec', '-i', 'supabase_db_fleet-homolog', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql });
  const out = (p.stdout?.toString() ?? '') + (p.stderr?.toString() ?? '');
  if (p.status !== 0) throw new Error('psql: ' + out.slice(0, 400));
  return out.trim();
}
export const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function crc32(buf) { let crc = ~0; for (const b of buf) { let c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
/** PNG real e decodificável com EXATAMENTE `size` bytes (preenchimento em chunk tEXt). */
export function pngOfSize(size, rgb = [Math.random() * 255 | 0, 90, 160]) {
  const w = 64, h = 40; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))]);
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => { const r = Buffer.from(row); r[1] = (y * 7) & 255; r[2] = (Math.random() * 255) | 0; return r; }));
  const head = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw))]);
  const iend = chunk('IEND', Buffer.alloc(0));
  const pad = size - head.length - iend.length - 12 - 4; if (pad < 0) return Buffer.concat([head, iend]);
  return Buffer.concat([head, chunk('tEXt', Buffer.concat([Buffer.from('pad\0'), crypto.randomBytes(pad)])), iend]);
}
export function jpegOfSize(size) { const b = crypto.randomBytes(size); b[0] = 255; b[1] = 216; b[2] = 255; b[3] = 0xe0; return b; }
export function webpOfSize(size) { const b = crypto.randomBytes(size); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(size - 8, 4); b.write('WEBP', 8, 'latin1'); return b; }
export function writeTmp(name, buf) { const d = SCR + '/files'; fs.mkdirSync(d, { recursive: true }); const p = d + '/' + name; fs.writeFileSync(p, buf); return p; }
/** Login real pela tela /login; devolve contexto, página e o access token da sessão (lido do cookie). */
export async function login(browser, key, opts = {}) {
  const u = USERS[key]; const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...opts }); const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[name="email"]', u.email); await page.fill('input[name="password"]', u.password);
  await Promise.all([page.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 120000 }), page.click('button[type="submit"]')]);
  return { ctx, page, uid: u.id, key, token: await tokenOf(ctx) };
}
export async function tokenOf(ctx) {
  const cookies = (await ctx.cookies()).filter(c => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  let v = cookies.map(c => c.value).join(''); v = decodeURIComponent(v);
  if (v.startsWith('base64-')) v = Buffer.from(v.slice(7), 'base64url').toString('utf8');
  return JSON.parse(v).access_token;
}
/** Chama a rota REAL /api/photos com os cookies da sessão (mesma origem). */
export async function apiPhotos(s, body, extraHeaders = {}) {
  const t0 = Date.now();
  const r = await s.ctx.request.post(BASE + '/api/photos', { headers: { 'content-type': 'application/json', origin: BASE, ...extraHeaders }, data: typeof body === 'string' ? body : JSON.stringify(body), timeout: 180000, maxRedirects: 0 });
  const loc = r.headers()['location'];
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status(), body: j, ms: Date.now() - t0, location: loc };
}
/** Upload direto ao Storage com sessão + chave pública (igual ao supabase-js do navegador; sem upsert). */
export async function storageUpload(token, path, buf, mime, { upsert = false, method = 'POST' } = {}) {
  const r = await fetch(`${API}/storage/v1/object/vehicle-photos/${path}`, { method, headers: { apikey: ANON, authorization: 'Bearer ' + token, 'content-type': mime, 'x-upsert': String(upsert) }, body: buf });
  return { status: r.status, body: (await r.text()).slice(0, 200) };
}
export async function storageDelete(token, path) {
  const r = await fetch(`${API}/storage/v1/object/vehicle-photos`, { method: 'DELETE', headers: { apikey: ANON, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) });
  return { status: r.status, body: (await r.text()).slice(0, 200) };
}
export async function storageGet(token, path) { const r = await fetch(`${API}/storage/v1/object/authenticated/vehicle-photos/${path}`, { headers: { apikey: ANON, authorization: 'Bearer ' + token } }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, size: b.length, sha: sha(b) }; }
export async function storageList(token, prefix) { const r = await fetch(`${API}/storage/v1/object/list/vehicle-photos`, { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ prefix, limit: 100 }) }); return { status: r.status, body: await r.json().catch(() => null) }; }
export async function rpc(token, fn, args) { const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json().catch(() => null) }; }
export async function signUrl(token, path) { const r = await fetch(`${API}/storage/v1/object/sign/vehicle-photos/${path}`, { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) }); return { status: r.status, body: await r.json().catch(() => null) }; }
export const journal = (where) => JSON.parse(psql(`select coalesce(json_agg(json_build_object('id',id,'state',state,'verified',server_verified_at is not null,'size',size_bytes,'mime',mime_type,'path',storage_path,'by',uploaded_by,'kind',target_kind,'target',target_id,'angle',angle) order by created_at),'[]') from fm_photo_uploads where ${where}`));
export const objects = (path) => JSON.parse(psql(`select coalesce(json_agg(json_build_object('name',name,'owner',owner,'size',metadata->>'size','mimetype',metadata->>'mimetype','created_at',created_at,'updated_at',updated_at)),'[]') from storage.objects where bucket_id='vehicle-photos' and name='${path}'`));
export const vid = (plate) => psql(`select id from vehicles where plate='${plate}'`);
export const R = [];
export function rec(file, r) { const p = `${T2}/${file}`; let all = []; try { all = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} all = all.filter(x => x.id !== r.id); all.push(r); all.sort((a, b) => a.id.localeCompare(b.id)); fs.writeFileSync(p, JSON.stringify(all, null, 1)); console.log(`${r.status}\t${r.id}\t${String(r.obtido ?? '').slice(0, 260)}`); }
