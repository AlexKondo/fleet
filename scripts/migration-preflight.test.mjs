import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { planMigrations, topLevelSql } from './migration-preflight.mjs';
const file = (name, sql='select 1;') => ({name,sql});
test('missing, numeric and duplicate history fail closed',()=>{
  for (const history of [null,{},[28],['0028','0028']]) assert.throws(()=>planMigrations([],history));
});
test('actual historical wipe is blocked when pending',()=>{
  const sql = readFileSync(new URL('../supabase/migrations/0028_wipe_all_data.sql',import.meta.url),'utf8');
  const p = planMigrations([file('0028_wipe_all_data.sql',sql)],[]);
  assert.equal(p.status,'BLOCKED_REVIEW_REQUIRED');
  assert.ok(p.pending[0].reasons.includes('DATA_DESTRUCTIVE_SQL'));
  assert.equal(planMigrations([file('0028_wipe_all_data.sql',sql)],['0028']).pending.length,0);
});
test('function bodies/comments/literals are not top-level deletes',()=>{
  const sql = `-- truncate table x;\n/* delete from x; /* nested */ */ create function f() returns void as $body$ begin delete from x; end $body$ language plpgsql; select 'truncate table x;';`;
  assert.equal(planMigrations([file('0001_test.sql',sql)],[]).status,'PLAN_READY_FOR_ENVIRONMENT_VALIDATION');
  assert.throws(()=>topLevelSql('/* unfinished'));
  assert.throws(()=>topLevelSql('do $$ unfinished'));
});
test('procedural blocks, destructive DDL and history gaps need review',()=>{
  for (const sql of ['do $$ begin perform 1; end $$;', 'alter table "vehicles" drop column plate;', 'drop schema public cascade;', 'delete from auth.users;'])
    assert.equal(planMigrations([file('0001_test.sql',sql)],[]).status,'BLOCKED_REVIEW_REQUIRED');
  const p=planMigrations([file('0001_a.sql'),file('0002_b.sql')],['0002']);
  assert.ok(p.pending[0].reasons.includes('HISTORY_GAP'));
  assert.equal(planMigrations([],['0099']).status,'BLOCKED_REVIEW_REQUIRED');
});
test('renumbered package keeps legacy history and plans only 0174/0175',()=>{
  const directory=new URL('../supabase/migrations/',import.meta.url);
  const files=readdirSync(directory).filter(n=>/^\d+_.+\.sql$/.test(n) && (Number(n.split('_')[0])<74 || ['0174','0175'].includes(n.split('_')[0]))).map(name=>file(name,readFileSync(new URL(name,directory),'utf8')));
  const history=files.map(f=>f.name.split('_')[0]).filter(v=>Number(v)<74);
  const p=planMigrations(files,history);
  assert.deepEqual(p.pending.map(f=>f.version),['0174','0175']);
  assert.equal(p.status,'PLAN_READY_FOR_ENVIRONMENT_VALIDATION');
  assert.equal(p.executesSql,false);
});

test('account access migration requires review of its procedural RLS block',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/0176_preserve_member_accounts.sql',import.meta.url),'utf8');
 const p=planMigrations([file('0176_preserve_member_accounts.sql',sql)],[]);
 assert.equal(p.status,'BLOCKED_REVIEW_REQUIRED');
 assert.ok(p.pending[0].reasons.includes('PROCEDURAL_BLOCK_REQUIRES_REVIEW'));
});
