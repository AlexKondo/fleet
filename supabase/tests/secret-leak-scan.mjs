#!/usr/bin/env node
// C7b / pack 07 "API key leakage": after `next build` (run it first in apps/web), scan the CLIENT bundle (.next/static)
// and the SERVER output (.next/server) for the actual secret VALUES from the repo-root .env and for credential-shaped
// tokens. Prints counts and file names only - never a secret value.
//
//   node supabase/tests/secret-leak-scan.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record, summary } from './lib/live.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEXT = path.join(ROOT, 'apps/web/.next');
if (!existsSync(NEXT)) { console.error('apps/web/.next not found: run `npx next build` in apps/web first'); process.exit(2); }

const env = {};
for (const l of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
// server-only / secret variables (NEXT_PUBLIC_* are public by design: the anon key and URL MAY be in the client bundle)
const SECRET_NAMES = Object.keys(env).filter((k) => !k.startsWith('NEXT_PUBLIC_') && env[k] && env[k].length >= 12 && !/^(EMAIL_FROM_NAME|EMAIL_FROM_ADDRESS|BREVO_SMTP_HOST|BREVO_SMTP_PORT|BREVO_SMTP_LOGIN)$/.test(k));

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const TEXT = /\.(js|mjs|cjs|json|html|css|txt|map|rsc|body|meta)$/i;
const PATTERNS = [
  ['Google API key shape (AIza + 35)', /AIza[0-9A-Za-z_-]{35}/],
  ['Anthropic key shape (sk-ant-)', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key shape (sk-)', /\bsk-[A-Za-z0-9]{32,}/],
  ['Supabase service-role / secret JWT claim (role":"service_role)', /service_role/],
  ['Supabase personal access token shape (sbp_)', /sbp_[0-9a-f]{20,}/],
];

const areas = { 'client bundle (.next/static)': path.join(NEXT, 'static'), 'server output (.next/server)': path.join(NEXT, 'server') };
for (const [label, dir] of Object.entries(areas)) {
  if (!existsSync(dir)) { record(`${label} exists`, false, dir); continue; }
  const files = [...walk(dir)].filter((f) => TEXT.test(f) && statSync(f).size < 60 * 1024 * 1024);
  const secretHits = {};
  const patternHits = {};
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const k of SECRET_NAMES) if (text.includes(env[k])) (secretHits[k] ??= []).push(path.relative(NEXT, f));
    for (const [pname, re] of PATTERNS) if (re.test(text)) (patternHits[pname] ??= []).push(path.relative(NEXT, f));
  }
  console.log(`${label}: ${files.length} text files scanned against ${SECRET_NAMES.length} secret values (${SECRET_NAMES.join(', ')}) and ${PATTERNS.length} credential patterns`);
  record(`${label}: NO secret value from .env appears`, Object.keys(secretHits).length === 0, Object.keys(secretHits).length ? Object.fromEntries(Object.entries(secretHits).map(([k, v]) => [k, v.slice(0, 3)])) : { scanned: files.length });
  for (const [pname] of PATTERNS) {
    const hits = patternHits[pname] ?? [];
    // the literal string "service_role" legitimately appears in server code (role names, SQL text); only the CLIENT bundle must be free of it
    const clientOnly = pname.includes('service_role');
    if (clientOnly && label.startsWith('server')) continue;
    record(`${label}: no ${pname}`, hits.length === 0, hits.length ? hits.slice(0, 3) : undefined);
  }
}
process.exit(summary('secret-leak-scan') ? 1 : 0);
