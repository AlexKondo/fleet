// F1: REAL concurrency (parallel psql sessions, synchronized start) on the routines changed by 0215, Org B (fictitious S1 org).
// Each iteration uses a new vehicle + reservation (additive rows in Org B only). Usage: node f1_concurrency.mjs <iterations=30>
// Scenarios:
//  A release_unsafe : doc-invalid vehicle, expired confirmed reservation  | release x cancel x exception x approve
//  B task_damage    : maintenance vehicle, damage reported by s1drvb      | complete_workflow_task x cancel_reservation x block_vehicle x release
//  C key_unsafe     : office unit, doc-invalid vehicle, window open       | key delivered x pickup x cancel x exception
//  D key_safe_race  : office unit, safe vehicle, key already delivered     | pickup x block_vehicle x key received x exception
import { spawn } from 'node:child_process';
import { sql } from 'file:///C:/projects/_homolog/conclusao/S1/s1_lib.mjs';
const N = Number(process.argv[2] ?? 30);
const ORGB = 'b5000000-0000-0000-0000-00000000000b', GATE = 'b5000000-0000-0000-0000-0000000000a1', OFFICE = 'b5000000-0000-0000-0000-0000000000f1';
const uid = k => sql(`select s1.uid('${k}')`)[0][0];
const ADMB = uid('s1adminb'), DRVB = uid('s1drvb');
const claims = u => JSON.stringify({ sub: u, role: 'authenticated' });
function psql(script) {
  return new Promise(res => {
    const p = spawn('docker', ['exec', '-i', 'supabase_db_fleet-homolog', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'VERBOSITY=verbose']);
    let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d);
    p.on('close', () => res({ out: o.trim(), err: e.trim() })); p.stdin.end(script);
  });
}
const wait = T => `select pg_sleep(greatest(0, extract(epoch from ('${T}'::timestamptz - clock_timestamp()))));\n`;
const asUser = (u, call) => `begin;\nselect set_config('request.jwt.claims','${claims(u)}',true);\nset local role authenticated;\nselect ${call};\ncommit;\n`;
const asService = call => `begin;\nset local role service_role;\nselect ${call};\ncommit;\n`;
const pickupCall = r => `record_pickup('${r}',10001,80,null,false,null,'{}'::text[],false,false,'traveler')`;
const rid = () => crypto.randomUUID();

// --- one-time fixture: key-custody unit in Org B with s1adminb as custodian (additive, fictitious org) ---
sql(`begin;
set local session_replication_role=replica;
insert into fm_units(id,organization_id,name,workflow) values ('${OFFICE}','${ORGB}','F1 B Escritorio (custodia)','key_custody') on conflict (id) do nothing;
insert into fm_key_custodians(organization_id,unit_id,user_id,enabled,version,assigned_by) values ('${ORGB}','${OFFICE}','${ADMB}',true,1,'${ADMB}') on conflict do nothing;
commit;`);
sql(`update organization_settings set auto_release_enabled=true, no_show_release_grace_minutes=60 where organization_id='${ORGB}'`);

function mkveh(k, unit, status) {
  const [[v]] = sql(`select s1.mkveh('${k}','${ORGB}','${unit}','${status}')`);
  sql(`insert into fm_equipment_profiles(target_kind,target_id,organization_id,enabled,required_ids,optional_ids,version,updated_by) values('vehicle','${v}','${ORGB}',true,'{}','{}',1,'${ADMB}')`);
  return v;
}
const mkres = (k, v, start, end) => sql(`select s1.mkres('${k}','${ORGB}','${DRVB}','${v}','confirmed',${start},${end})`)[0][0];

const scenarios = {
  release_unsafe(i) {
    const k = `f1cA_${i}_${Date.now()}`; const v = mkveh(k, GATE, 'reserved');
    sql(`update vehicles set documentation_valid=false where id='${v}'`);
    const r = mkres(k, v, `now()-interval '4 hours'`, `now()-interval '2 hours'`);
    return { v, r, sess: {
      release: asService(`public.fm_release_expired_reservations('${ORGB}'::uuid)`),
      cancel: asUser(DRVB, `cancel_reservation('${r}','F1 concorrencia')`),
      exception: asUser(ADMB, `fm_operation_exception('${r}','not_departed','F1 concorrencia excecao','${rid()}')`),
      approve: asUser(ADMB, `approve_reservation('${r}')`),
    } };
  },
  task_damage(i) {
    const k = `f1cB_${i}_${Date.now()}`; const v = mkveh(k, GATE, 'maintenance');
    const rd = mkres(k + 'd', v, `now()+interval '2 days'`, `now()+interval '2 days 2 hours'`);
    const r = mkres(k, v, `now()+interval '3 days'`, `now()+interval '3 days 2 hours'`);
    const [[ins]] = sql(`begin; set local session_replication_role=replica;
      insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role,has_new_damage,damage_notes)
      values('${ORGB}','${rd}','${v}','pickup','${DRVB}','traveler',true,'F1 avaria') returning id; commit;`).filter(x => x[0].length === 36);
    sql(`update vehicles set has_blocking_damage=true where id='${v}'`);
    const [[t]] = sql(`insert into workflow_tasks(organization_id,vehicle_id,type,notes,source_inspection_id) values('${ORGB}','${v}','repair','F1 reparo','${ins}') returning id`);
    return { v, r, t, sess: {
      complete: asUser(ADMB, `complete_workflow_task('${t}')`),
      cancel: asUser(DRVB, `cancel_reservation('${r}','F1 concorrencia')`),
      block: asUser(ADMB, `block_vehicle('${v}','F1 bloqueio concorrente')`),
      release: asService(`public.fm_release_expired_reservations('${ORGB}'::uuid)`),
    } };
  },
  key_unsafe(i) {
    const k = `f1cC_${i}_${Date.now()}`; const v = mkveh(k, OFFICE, 'reserved');
    sql(`update vehicles set documentation_valid=false where id='${v}'`);
    const r = mkres(k, v, `now()-interval '5 minutes'`, `now()+interval '2 hours'`);
    return { v, r, sess: {
      delivered: asUser(ADMB, `fm_key_command('${r}','delivered',null,'${rid()}')`),
      pickup: asUser(DRVB, pickupCall(r)),
      cancel: asUser(DRVB, `cancel_reservation('${r}','F1 concorrencia')`),
      exception: asUser(ADMB, `fm_operation_exception('${r}','not_departed','F1 concorrencia excecao','${rid()}')`),
    } };
  },
  key_safe_race(i) {
    const k = `f1cD_${i}_${Date.now()}`; const v = mkveh(k, OFFICE, 'reserved');
    const r = mkres(k, v, `now()-interval '5 minutes'`, `now()+interval '2 hours'`);
    sql(`begin; select set_config('request.jwt.claims','${claims(ADMB)}',true); set local role authenticated; select fm_key_command('${r}','delivered',null,'${rid()}'); commit;`);
    return { v, r, sess: {
      pickup: asUser(DRVB, pickupCall(r)),
      block: asUser(ADMB, `block_vehicle('${v}','F1 bloqueio concorrente')`),
      received: asUser(ADMB, `fm_key_command('${r}','received',null,'${rid()}')`),
      exception: asUser(ADMB, `fm_operation_exception('${r}','not_departed','F1 concorrencia excecao','${rid()}')`),
    } };
  },
};

function check(name, f) {
  const [[rs, reason, vs, dmg, doc, pre, nRel, nExc, nCancel, nKeyDel, nPickup, nHold, tstatus]] = sql(`select r.status, coalesce(r.cancellation_reason,'-'), v.status, v.has_blocking_damage, v.documentation_valid, coalesce(v.pre_block_status::text,'-'),
    (select count(*) from audit_log where entity_id=r.id and action='reservation.no_show_released'),
    (select count(*) from fm_operation_exceptions where reservation_id=r.id),
    (select count(*) from audit_log where entity_id=r.id and action='reservation_cancelled'),
    (select count(*) from fm_key_events where reservation_id=r.id and kind='delivered'),
    (select count(*) from inspections where reservation_id=r.id and type='pickup'),
    (select count(*) from audit_log where entity_id=v.id and action='vehicle.damage_hold_released'),
    coalesce((select status::text from workflow_tasks where id=${f.t ? `'${f.t}'` : 'null'}),'-')
    from reservations r join vehicles v on v.id=r.vehicle_id where r.id='${f.r}'`);
  const cancels = Number(nRel) + Number(nExc) + Number(nCancel);
  const bad = [];
  if (rs === 'cancelled' && cancels !== 1) bad.push('cancel_count');
  if (rs !== 'cancelled' && cancels !== 0) bad.push('cancel_without_status');
  if (doc === 'f' && ['available', 'reserved', 'in_use'].includes(vs) && rs === 'cancelled') bad.push('unsafe_doc_released');
  if (doc === 'f' && vs === 'in_use') bad.push('unsafe_doc_in_use');
  if (dmg === 't' && vs === 'available') bad.push('damage_available');
  if (name === 'release_unsafe' && rs === 'cancelled' && vs !== 'blocked') bad.push('release_unsafe_not_blocked');
  if (name === 'task_damage') {
    if (tstatus === 'done' && (dmg !== 'f' || nHold !== '1')) bad.push('task_done_without_audited_release');
    if (tstatus !== 'done' && (dmg !== 't' || nHold !== '0')) bad.push('damage_cleared_without_task');
    if (vs === 'blocked' && pre === '-') bad.push('blocked_without_pre');
  }
  if (name === 'key_unsafe' && (Number(nKeyDel) > 0 || Number(nPickup) > 0)) bad.push('unsafe_key_or_pickup');
  if (name === 'key_unsafe' && rs === 'cancelled' && vs !== 'blocked') bad.push('key_unsafe_cancel_not_blocked');
  if (name === 'key_safe_race') {
    if (Number(nPickup) > 0 && !['in_use', 'blocked'].includes(vs)) bad.push('pickup_vehicle_state');
    if (Number(nExc) > 0 && Number(nPickup) > 0) bad.push('exception_after_pickup');
  }
  return { outcome: `${rs}/${reason.startsWith('F1') ? (reason.includes('excecao') ? 'exception' : 'user_cancel') : reason}/veh=${vs}/dmg=${dmg}/task=${tstatus}/key=${nKeyDel}/pickup=${nPickup}`, bad };
}

const summary = { iterations_per_scenario: N };
for (const [name, build] of Object.entries(scenarios)) {
  const agg = { iterations: 0, deadlocks_40P01: 0, inconsistent: 0, outcomes: {}, errors: {}, samples: [] };
  for (let i = 1; i <= N; i++) {
    const f = build(i);
    const [[T]] = sql(`select (clock_timestamp()+interval '1500 milliseconds')::text`);
    const names = Object.keys(f.sess);
    const results = await Promise.all(names.map(n => psql(wait(T) + f.sess[n])));
    names.forEach((n, j) => { const e = results[j].err; if (e) { const m = e.match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]+)/); const key = `${n}: ${m ? `${m[1]} ${m[2].slice(0, 70)}` : e.slice(0, 90)}`; agg.errors[key] = (agg.errors[key] ?? 0) + 1; if (/40P01|deadlock/i.test(e)) agg.deadlocks_40P01++; } });
    const c = check(name, f);
    agg.outcomes[c.outcome] = (agg.outcomes[c.outcome] ?? 0) + 1;
    if (c.bad.length) { agg.inconsistent++; if (agg.samples.length < 5) agg.samples.push({ i, r: f.r, v: f.v, bad: c.bad, outcome: c.outcome }); }
    agg.iterations++;
  }
  summary[name] = agg;
}
sql(`update organization_settings set auto_release_enabled=false, no_show_release_grace_minutes=60 where organization_id='${ORGB}'`);
summary.org_b_flag_after = sql(`select auto_release_enabled||'/'||no_show_release_grace_minutes from organization_settings where organization_id='${ORGB}'`)[0][0];
console.log(JSON.stringify(summary, null, 1));
