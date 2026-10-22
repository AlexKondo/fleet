// T1 harness (adaptado do harness S1) comum: login real no GoTrue LOCAL, chamadas PostgREST/Storage. Nunca imprime tokens/senhas.
import fs from 'node:fs';
export function loadEnv(envPath) {
  const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
  if (!/^http:\/\/127\.0\.0\.1:/.test(env.API_URL)) throw new Error('API nao local - abortado');
  return env;
}
export function loadCreds(credsPath) {
  return JSON.parse(fs.readFileSync(credsPath, 'utf8'));
}
export class Api {
  constructor(env, creds) { this.env = env; this.creds = creds; this.tokens = {}; this.API = env.API_URL; }
  async login(k) {
    if (this.tokens[k]) return this.tokens[k];
    const c = this.creds[k]; if (!c) throw new Error('sem usuario ' + k);
    const r = await fetch(`${this.API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: this.env.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) });
    const j = await r.json(); if (!j.access_token) throw new Error('login falhou ' + k + ' ' + r.status);
    this.tokens[k] = j.access_token; return j.access_token;
  }
  async headers(k) {
    if (k === 'anon') return { apikey: this.env.ANON_KEY, Authorization: 'Bearer ' + this.env.ANON_KEY };
    if (k === 'service') return { apikey: this.env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + this.env.SERVICE_ROLE_KEY };
    return { apikey: this.env.ANON_KEY, Authorization: 'Bearer ' + await this.login(k) };
  }
  async rpc(k, fn, args) {
    const r = await fetch(`${this.API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...(await this.headers(k)), 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, code: j?.code, msg: j?.message };
  }
  async patch(k, table, query, body) {
    const r = await fetch(`${this.API}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...(await this.headers(k)), 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, rows: Array.isArray(j) ? j.length : null, code: j?.code, msg: j?.message };
  }
  async get(k, table, query) {
    const r = await fetch(`${this.API}/rest/v1/${table}?${query}`, { headers: await this.headers(k) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  }
  async upload(k, bucket, path, bytes, mime) {
    const r = await fetch(`${this.API}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { ...(await this.headers(k)), 'content-type': mime, 'x-upsert': 'false' }, body: bytes });
    const t = await r.text(); return { status: r.status, body: t.slice(0, 160) };
  }
  async download(k, bucket, path) {
    const r = await fetch(`${this.API}/storage/v1/object/authenticated/${bucket}/${path}`, { headers: await this.headers(k) });
    const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, bytes: b };
  }
}
import { execFileSync } from 'node:child_process';
/** psql como postgres no container LOCAL; retorna linhas (campos separados por |). */
export function sql(q) {
  const out = execFileSync('docker', ['exec', '-i', 'supabase_db_fleet-homolog', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map(l => l.split('|'));
}
export function ids() {
  const m = {};
  for (const [k, id] of sql("select 'v_'||k,id from t1.v union all select 'r_'||k,id from t1.r union all select 't_'||k,id from t1.t union all select 'u_'||k,id from t1.u")) m[k] = id;
  return m;
}
export function summarize(r) { return { status: r.status, code: r.code ?? null, msg: (r.msg ?? (typeof r.body === 'string' ? r.body : null))?.toString().slice(0, 120) ?? null, rows: r.rows ?? undefined }; }
