// F1 / S2-D01 over real HTTP (GoTrue login + PostgREST), AFTER 0216: the inspector's direct INSERT into inspection_photos is
// refused (42501) and nothing is written. Usage: node r_s2_d01_http.mjs <env file from `supabase status -o env`>
// Never prints keys or passwords.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
if (!/^http:\/\/127\.0\.0\.1:/.test(env.API_URL)) throw new Error('not local');
const users = JSON.parse(fs.readFileSync('C:/projects/_homolog/design/users.json', 'utf8'));
const q = s => execFileSync('docker', ['exec', '-i', 'supabase_db_fleet-homolog', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: s, encoding: 'utf8' }).trim();
const ORG = '00000000-0000-0000-0000-000000000001', INS = 'b16613dd-6012-4b63-8843-7a02680f5de2';
const login = await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: users.lucas.email, password: users.lucas.password }) });
const tok = (await login.json()).access_token; if (!tok) throw new Error('login failed ' + login.status);
const before = q(`select count(*) from inspection_photos where inspection_id='${INS}'`);
const path = `${ORG}/${INS}/front_f1_http_${Date.now()}.png`;
const r = await fetch(`${env.API_URL}/rest/v1/inspection_photos`, { method: 'POST', headers: { apikey: env.ANON_KEY, Authorization: 'Bearer ' + tok, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ organization_id: ORG, inspection_id: INS, angle: 'front', storage_path: path }) });
const body = await r.json().catch(() => ({}));
const after = q(`select count(*) from inspection_photos where inspection_id='${INS}'`);
const anon = await fetch(`${env.API_URL}/rest/v1/inspection_photos`, { method: 'POST', headers: { apikey: env.ANON_KEY, Authorization: 'Bearer ' + env.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: ORG, inspection_id: INS, angle: 'front', storage_path: path }) });
const anonBody = await anon.json().catch(() => ({}));
const out = { lucas_insert: { http: r.status, code: body.code, message: body.message }, anon_insert: { http: anon.status, code: anonBody.code, message: anonBody.message }, rows_before: before, rows_after: after };
out.verdict = (r.status === 401 || r.status === 403) && body.code === '42501' && before === after && anon.status >= 400 ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out, null, 1));
