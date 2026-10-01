#!/usr/bin/env node
// Runs every carpool / privacy / security LIVE script SERIALLY (the Management API throttles, and the scripts share
// the live project) and prints one summary table. Disposable data only; each script cleans up after itself.
//
//   node supabase/tests/run-carpool-live-suite.mjs [--with-browser] [--with-build] [--with-llm] [--only <substring>]
//
//   default        : DB / RPC / RLS scripts + the live vitest suites (chat confirm-guard attacks, __options tamper tests,
//                    allow_carpool, KPI dashboard, server-action RBAC) + the allow_carpool MUTATION check
//   --with-browser : also starts the app (dev servers on 3100 / 3101 [fetch logger] / 3102 [invalid Google key]) and runs
//                    the Playwright regression + C7b browser checks (animations, XSS, unauth flows, key leakage)
//   --with-build   : runs `next build` and the secret-leak scan of .next/static + .next/server
//   --with-llm     : adds the real-LLM classification battery (slow, costs API calls)
//   --pending-applied : strict mode for privacy-matrix / rbac-matrix (pending migrations 0066/0067 are applied)
import { spawn, spawnSync } from 'node:child_process';
import { openSync, readFileSync, existsSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = path.join(ROOT, 'apps/web');
const flag = (n) => process.argv.includes(n);
const only = flag('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const strict = flag('--pending-applied') ? ['--pending-applied'] : [];
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const steps = [];
const node = (name, file, args = []) => steps.push({ name, cmd: 'node', args: [path.join(ROOT, file), ...args], cwd: ROOT });
const vitestLive = (name, pattern) => steps.push({ name, cmd: 'npx', args: ['vitest', 'run', '--config', 'vitest.battery.config.ts', pattern], cwd: WEB, shell: true });

node('lifecycle RPCs (create/accept/reject/cancel/expire, idempotency, races)', 'supabase/tests/carpool-lifecycle-rpcs.mjs');
node('direct-write attacks (forged rows, seats, audit)', 'supabase/tests/carpool-direct-write-attacks.mjs');
node('step-0 follow-ups', 'supabase/tests/carpool-c5-step0-followups.mjs');
node('places privacy (coarse until accepted)', 'supabase/tests/carpool-places-privacy.mjs');
node('carpool_coarse_label table test (37 address formats)', 'supabase/tests/coarse-label-table.mjs');
node('chat conversation FK cascade proof (org / profile delete)', 'supabase/tests/chat-cascade-proof.mjs');
node('privacy matrix (role x resource reads + attacks + M1/M2)', 'supabase/tests/privacy-matrix.mjs', strict);
node('RBAC matrix (RPCs + tables x roles, incl. S1 internals)', 'supabase/tests/carpool-rbac-matrix.mjs', strict);
vitestLive('RBAC matrix (server actions x roles)', 'rbac-actions');
vitestLive('chat confirm-guard attacks + forged ids (chat-security)', 'chat-security');
vitestLive('allow_carpool regression (live)', 'allow-carpool-offer');
vitestLive('hostile free text through the chat (LLM) path', 'chat-hostile');
vitestLive('KPI dashboard data function vs a known scenario', 'kpi-dashboard');
vitestLive('KPI dashboard at volume (1500 rows > PostgREST cap) + error surfacing', 'kpi-volume');
node('mutation check: allow_carpool regression tests fail on the old logic', 'supabase/tests/mutation-allow-carpool.mjs');
steps.push({ name: 'unit: __options tamper / persisted pending / chat guards', cmd: 'npx', args: ['vitest', 'run', 'app/chat'], cwd: WEB, shell: true });
if (flag('--with-llm')) vitestLive('real-LLM classification battery', 'battery');

const results = [];
function parseCounts(out) {
  const t = strip(out);
  let m = [...t.matchAll(/(\d+)\/(\d+) checks passed/g)].pop();
  if (m) return `${m[1]}/${m[2]} checks`;
  m = t.match(/Tests\s+(?:(\d+) failed \|\s*)?(\d+) passed(?: \((\d+)\))?/);
  if (m) return `${m[2]} passed${m[1] ? `, ${m[1]} failed` : ''}`;
  return '';
}
function runStep(s) {
  const t0 = Date.now();
  console.log(`\n=== ${s.name} ===`);
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, shell: !!s.shell, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 25 * 60 * 1000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const lines = strip(out).split('\n');
  console.log(lines.filter((l) => /^(FAIL|KNOWN-OPEN)|checks passed|Tests |Test Files|pending migrations|mutation check/.test(l.trim()) || /^\s*(PASS|FAIL) - /.test(l) && /^FAIL/.test(l.trim())).slice(-25).join('\n'));
  results.push({ name: s.name, ok: r.status === 0, counts: parseCounts(out), knownOpen: lines.filter((l) => l.startsWith('KNOWN-OPEN') && !l.startsWith('KNOWN-OPEN cases') && !l.startsWith('KNOWN-OPEN cells')).length, netRetries: lines.filter((l) => l.startsWith('NET-RETRY')), secs: Math.round((Date.now() - t0) / 1000) });
}

// ---- optional browser / build phases
const servers = [];
async function startServer(port, extra = [], logFile) {
  const out = openSync(logFile, 'w');
  const child = spawn('node', [path.join(ROOT, 'testing/live-demo/start-server.mjs'), '--port', String(port), ...extra], { cwd: ROOT, stdio: ['ignore', out, out], detached: false });
  servers.push(child);
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(`http://localhost:${port}/login`); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('server on ' + port + ' did not start');
}
const stopServers = () => { for (const s of servers) { try { spawnSync('taskkill', ['/PID', String(s.pid), '/T', '/F']); } catch { /* ignore */ } } };

if (!only || steps.every((s) => s.name.includes(only))) { /* filter below */ }
for (const s of steps.filter((x) => !only || x.name.toLowerCase().includes(only.toLowerCase()))) runStep(s);

if (flag('--with-build')) {
  runStep({ name: 'next build (apps/web)', cmd: 'npx', args: ['next', 'build'], cwd: WEB, shell: true });
  runStep({ name: 'secret-leak scan of .next/static + .next/server', cmd: 'node', args: [path.join(ROOT, 'supabase/tests/secret-leak-scan.mjs')], cwd: ROOT });
}

if (flag('--with-browser')) {
  const tmp = path.join(os.tmpdir(), 'c7b-suite');
  mkdirSync(tmp, { recursive: true });
  const fetchLog = path.join(tmp, 'fetch.log');
  const badLog = path.join(tmp, 'badkey-server.log');
  for (const f of [fetchLog, badLog]) if (existsSync(f)) unlinkSync(f);
  writeFileSync(fetchLog, '');
  // ONE dev server at a time (two `next dev` processes cannot share apps/web/.next)
  const withEnv = (env, fn) => { const prev = {}; for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; process.env[k] = v; } try { fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };
  const bro = (name, file, base, env = {}) => withEnv({ BASE_URL: base, ...env }, () => runStep({ name, cmd: 'node', args: [path.join(ROOT, 'testing/live-demo', file)], cwd: path.join(ROOT, 'testing/live-demo') }));
  const phase = async (port, extra, log, body) => { await startServer(port, extra, log); try { await body(); } finally { stopServers(); await new Promise((r) => setTimeout(r, 4000)); servers.length = 0; } };
  const U = 'http://localhost:';
  await phase(3100, [], path.join(tmp, 'main-server.log'), async () => {
    bro('browser: per-role regression of every screen (c7a)', 'c7a-privacy-regression.mjs', U + '3100');
    bro('browser: C7b checks (XSS inert, L1 zoom, M3, KPI page, vehicleOptions reload)', 'c7b-browser.mjs', U + '3100');
    bro('browser: CNH animations x prefers-reduced-motion', 'c7b-animations.mjs', U + '3100');
  });
  await phase(3101, ['--fetch-log', fetchLog], path.join(tmp, 'fetchlog-server.log'), async () => {
    bro('browser: unauthenticated flows make no anon table access (L5)', 'c7b-unauth-flows.mjs', U + '3101', { FETCH_LOG: fetchLog });
  });
  await phase(3102, ['--bad-key'], badLog, async () => {
    bro('browser: provider failure never leaks the API key', 'c7b-keyleak.mjs', U + '3102', { SERVER_LOG: badLog });
  });
}

// ---- summary
console.log('\n================ carpool live suite summary ================');
const w = Math.max(...results.map((r) => r.name.length)) + 2;
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)} ${r.counts.padEnd(22)} ${r.knownOpen ? `(${r.knownOpen} known-open: pending migrations) ` : ''}${r.netRetries?.length ? `[${r.netRetries.length} network retries] ` : ''}${r.secs}s`);
const totalOpen = results.reduce((n, r) => n + r.knownOpen, 0);
console.log(`known-open cases (pending migrations), counted from the scripts' output: ${totalOpen}`);
for (const r of results) for (const l of r.netRetries ?? []) console.log(`  network diagnosis [${r.name}]: ${l}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} steps passed${bad ? `, ${bad} FAILED` : ''}.`);
void readFileSync;
process.exit(bad ? 1 : 0);
