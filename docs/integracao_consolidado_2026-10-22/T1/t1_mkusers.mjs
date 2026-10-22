// T1: cria usuarios ficticios no GoTrue LOCAL (127.0.0.1:55321). Nunca imprime chaves/senhas.
// Uso: node t1_mkusers.mjs <env.txt> <saida_credenciais.json>   (credenciais ficam fora do projeto, no scratchpad)
import fs from 'node:fs';
import crypto from 'node:crypto';
const [envPath, outPath] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const API = env.API_URL; if (!/^http:\/\/127\.0\.0\.1:/.test(API)) throw new Error('API nao local');
const K = env.SERVICE_ROLE_KEY;
const defs = ['t1admin','t1adminnocnh','t1fmall','t1fmsp','t1fmcp','t1fmnocnh','t1sec','t1maint','t1custcp','t1custrj','t1drvok','t1drvexp','t1drvnull','t1emp','t1deact','t1req2','t1adminb','t1drvb','t1secb'];
const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
for (const k of defs) {
  if (out[k]) continue;
  const email = `${k}@t1.test`;
  const password = 'T1!' + crypto.randomBytes(12).toString('base64url');
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'T1 ' + k } }) });
  const j = await r.json(); if (!j.id) throw new Error('falha ao criar ' + k + ' status ' + r.status);
  out[k] = { id: j.id, email, password };
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([k, v]) => `('${k}','${v.id}')`).join(','));
