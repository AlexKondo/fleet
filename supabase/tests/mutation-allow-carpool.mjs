#!/usr/bin/env node
// Mutation check for the allow_carpool regression tests (host answered "No" at reservation time, later enabled an
// offer -> the rider's search must still find it; the OFFER is the consent, not the legacy trip_requests.allow_carpool
// flag). The OLD logic is re-introduced into apps/web/app/carpool/actions.ts (offers whose host trip has
// allow_carpool = false are dropped), the regression tests are run and MUST FAIL, then the file is restored and its
// sha256 compared with the original. The restore also happens on any error / signal.
//
//   node supabase/tests/mutation-allow-carpool.mjs [--no-live]     (--no-live skips the live Google-backed test)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGET = path.join(ROOT, 'apps/web/app/carpool/actions.ts');
const WEB = path.join(ROOT, 'apps/web');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const original = readFileSync(TARGET);
const originalHash = sha(original);
let restored = false;
const restore = () => { if (!restored) { writeFileSync(TARGET, original); restored = true; } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130); });
process.on('exit', restore);

const text = original.toString('utf8');
const SELECT_OLD = 'trip_request:trip_requests(departure_at, origin, destination)';
const FILTER_OLD = '(offerRows ?? []).filter((row) => row.trip_request);';
if (!text.includes(SELECT_OLD) || !text.includes(FILTER_OLD)) { console.error('mutation anchors not found: actions.ts changed shape, update this script'); process.exit(2); }

const run = (args) => spawnSync('npx', ['vitest', 'run', ...args], { cwd: WEB, shell: true, encoding: 'utf8', timeout: 900000 });
const tail = (r) => (r.stdout + r.stderr).split('\n').filter((l) => /Tests|Test Files|FAIL|✓|×|passed|failed/.test(l)).slice(-6).map((l) => '    ' + l.replace(/\x1b\[[0-9;]*m/g, '').trim()).join('\n');

let failures = 0;
const expect = (name, cond, detail) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (detail) console.log(detail); if (!cond) failures += 1; };

try {
  // sanity: the tests pass on the real code
  const base = run(['app/carpool/actions.test.ts', '-t', 'allow_carpool']);
  expect('baseline: the unit regression test PASSES on the real code', base.status === 0, tail(base));

  // mutate = the OLD logic
  const mutated = text
    .replace(SELECT_OLD, 'trip_request:trip_requests(departure_at, origin, destination, allow_carpool)')
    .replace(FILTER_OLD, '(offerRows ?? []).filter((row) => row.trip_request && (row.trip_request as { allow_carpool?: boolean }).allow_carpool !== false);');
  writeFileSync(TARGET, mutated);
  console.log('mutation applied (offers of hosts who answered "No" are dropped again)');
  const unit = run(['app/carpool/actions.test.ts', '-t', 'allow_carpool']);
  expect('MUTANT: the unit regression test FAILS on the old logic', unit.status !== 0, tail(unit));
  if (!process.argv.includes('--no-live')) {
    const live = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.battery.config.ts', 'allow-carpool-offer'], { cwd: WEB, shell: true, encoding: 'utf8', timeout: 900000 });
    expect('MUTANT: the LIVE regression test (real DB + real Google) FAILS on the old logic', live.status !== 0, tail(live));
  }
} finally {
  restore();
  const after = sha(readFileSync(TARGET));
  expect(`file restored byte-for-byte (sha256 ${originalHash.slice(0, 12)}... == ${after.slice(0, 12)}...)`, after === originalHash);
  const post = run(['app/carpool/actions.test.ts', '-t', 'allow_carpool']);
  expect('after restore: the regression test passes again', post.status === 0, tail(post));
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nmutation check OK: the regression tests detect the old allow_carpool logic');
process.exit(failures ? 1 : 0);
