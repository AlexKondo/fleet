#!/usr/bin/env node
// F4: generates the 0068 / 0069 rollback files from the REAL before-state ACLs of the live DB (pg_proc.proacl,
// pg_class.relacl, pg_attribute.attacl), so a rollback restores exactly what existed - no over-grants, nothing missed
// (PUBLIC, sequences, MAINTAIN, column grants). Run ONLY while the migration is NOT applied.
//
//   node supabase/tests/gen-acl-rollback.mjs 0068|0069 > supabase/migrations-pending/rollback/00xx_rollback.sql
import { sql } from './lib/live.mjs';

const which = process.argv[2];
const ident = (s) => s;
const roleName = (r) => (r === 'PUBLIC' ? 'public' : `"${r}"`);

async function funcs() {
  const names = ['update_member_role', 'lock_and_require_multiple_administrators', 'auto_reassign_reservation_vehicle', 'rls_auto_enable', 'log_audit_event',
    'approve_reservation', 'block_vehicle', 'unblock_vehicle', 'cancel_reservation', 'cancel_workflow_task', 'complete_workflow_task', 'create_vehicle_reservation',
    'post_reservation_message', 'record_pickup', 'record_return', 'swap_reservation_vehicle', 'transfer_reservation', 'create_carpool_participation', 'respond_to_carpool_request'];
  const rows = await sql(`select p.oid::regprocedure::text sig, coalesce((select jsonb_agg(jsonb_build_object('grantee', case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end, 'priv', a.privilege_type, 'grant', a.is_grantable))
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee <> p.proowner), '[]'::jsonb) acl
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${names.map((n) => `'${n}'`).join(',')}) order by 1`);
  const out = [`-- Rollback for 0068_s1_revoke_internal_definer_rpcs.sql (NOT auto-applied). GENERATED from the live ACLs that existed before 0068`,
    `-- (supabase/tests/gen-acl-rollback.mjs 0068): restores EXACTLY the original EXECUTE grants of PUBLIC / anon / authenticated / service_role on`,
    `-- ${rows.length} functions - no more, no less. Verified by the preflight ACL diff (supabase/tests/preflight-role-simulation.mjs --rollback).`,
    `-- WARNING: this re-opens the update_member_role privilege escalation (anon/authenticated can call it again). Use only briefly.`];
  for (const r of rows) {
    out.push(`revoke all on function ${r.sig} from public, anon, authenticated, service_role;`);
    for (const a of r.acl.filter((x) => ['PUBLIC', 'anon', 'authenticated', 'service_role'].includes(x.grantee)))
      out.push(`grant execute on function ${r.sig} to ${roleName(a.grantee)}${a.grant ? ' with grant option' : ''};`);
  }
  return out.join('\n') + '\n';
}

async function rels() {
  const rows = await sql(`select c.oid::regclass::text rel, c.relkind::text kind, coalesce((select jsonb_agg(jsonb_build_object('grantee', a.grantee::regrole::text, 'priv', a.privilege_type, 'grant', a.is_grantable))
      from aclexplode(coalesce(c.relacl, acldefault(case c.relkind when 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a where a.grantee in ('anon'::regrole, 'authenticated'::regrole)), '[]'::jsonb) acl,
      coalesce((select jsonb_agg(jsonb_build_object('col', t.attname, 'grantee', t.grantee::regrole::text, 'priv', t.privilege_type))
        from (select at.attname, x.grantee, x.privilege_type from pg_attribute at, aclexplode(at.attacl) x where at.attrelid = c.oid and at.attacl is not null) t
        where t.grantee in ('anon'::regrole, 'authenticated'::regrole)), '[]'::jsonb) cols
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S') order by 1`);
  const out = [`-- Rollback for 0069_l5_revoke_anon_table_privileges.sql (NOT auto-applied). GENERATED from the live ACLs that existed before 0069`,
    `-- (supabase/tests/gen-acl-rollback.mjs 0069): restores EXACTLY the table / sequence / column privileges of anon and authenticated on all`,
    `-- ${rows.length} public relations (including MAINTAIN, sequences and column-level grants). Verified by the preflight ACL diff.`];
  const kindWord = (k) => (k === 'S' ? 'sequence' : 'table');
  for (const r of rows) {
    out.push(`revoke all on ${kindWord(r.kind)} ${r.rel} from anon, authenticated;`);
    for (const who of ['anon', 'authenticated']) {
      const privs = r.acl.filter((a) => a.grantee === who);
      if (privs.length) out.push(`grant ${[...new Set(privs.map((p) => p.priv))].join(', ')} on ${kindWord(r.kind)} ${r.rel} to ${who};`);
      for (const c of r.cols.filter((x) => x.grantee === who)) out.push(`grant ${c.priv} ("${c.col}") on table ${r.rel} to ${who};`);
    }
  }
  return out.join('\n') + '\n';
}

if (which === '0068') process.stdout.write(await funcs());
else if (which === '0069') process.stdout.write(await rels());
else { console.error('usage: gen-acl-rollback.mjs 0068|0069'); process.exit(2); }
void ident;
