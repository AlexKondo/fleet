// C1 concorrencia REAL: sessoes psql paralelas com inicio sincronizado, Org T1B (ficticia).
// aprovacao x cancelamento x retirada x liberacao. Uso: node t1_c1_concurrency.mjs <iteracoes_por_cenario=30>
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { sql } from './t1_lib.mjs';
const N = Number(process.argv[2] ?? 30);
const ORGB = '7b000000-0000-0000-0000-00000000000b';
const uid = k => sql(`select t1.uid('${k}')`)[0][0];
const ADMB = uid('t1adminb'), DRVB = uid('t1drvb');
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
const release = asService(`public.fm_release_expired_reservations('${ORGB}'::uuid)`);

const scen = {
  // vencida ha 2h, pendente: aprovacao deve ser recusada (0218), liberacao cancela
  pending_expired: { grace: 60, status: 'pending_approval', veh: 'available', end: () => `now()-interval '2 hours'`,
    sess: r => ({ release, approve: asUser(ADMB, `approve_reservation('${r}')`), cancel: asUser(DRVB, `cancel_reservation('${r}','T1 concorrencia')`), pickup: asUser(DRVB, pickupCall(r)) }) },
  // vencida ha 2h, confirmada: um unico cancelamento (usuario OU liberacao)
  confirmed_expired: { grace: 60, status: 'confirmed', veh: 'reserved', end: () => `now()-interval '2 hours'`,
    sess: r => ({ release, cancel: asUser(DRVB, `cancel_reservation('${r}','T1 concorrencia')`), pickup: asUser(DRVB, pickupCall(r)), approve: asUser(ADMB, `approve_reservation('${r}')`) }) },
  // fronteira (tolerancia 0, fim = instante sincronizado +-30ms), pendente: aprovacao x cancelamento x liberacao
  pending_boundary: { grace: 0, status: 'pending_approval', veh: 'available', end: T => `'${T}'::timestamptz + interval '${Math.floor(Math.random() * 60) - 30} milliseconds'`,
    sess: r => ({ release, approve: asUser(ADMB, `approve_reservation('${r}')`), cancel: asUser(DRVB, `cancel_reservation('${r}','T1 concorrencia')`), pickup: asUser(DRVB, pickupCall(r)) }) },
  // fronteira, confirmada com checklist preparado: retirada x cancelamento x liberacao
  confirmed_boundary: { grace: 0, status: 'confirmed', veh: 'reserved', prepare: true, end: T => `'${T}'::timestamptz + interval '${Math.floor(Math.random() * 60) - 30} milliseconds'`,
    sess: r => ({ release, pickup: asUser(DRVB, pickupCall(r)), cancel: asUser(DRVB, `cancel_reservation('${r}','T1 concorrencia')`), approve: asUser(ADMB, `approve_reservation('${r}')`) }) },
  // sem cancelamento do usuario: liberacao x aprovacao x retirada (fronteira)
  pending_boundary_nocancel: { grace: 0, status: 'pending_approval', veh: 'available', end: T => `'${T}'::timestamptz + interval '${Math.floor(Math.random() * 60) - 30} milliseconds'`,
    sess: r => ({ release, approve: asUser(ADMB, `approve_reservation('${r}')`), pickup: asUser(DRVB, pickupCall(r)) }) },
  confirmed_boundary_nocancel: { grace: 0, status: 'confirmed', veh: 'reserved', prepare: true, end: T => `'${T}'::timestamptz + interval '${Math.floor(Math.random() * 60) - 30} milliseconds'`,
    sess: r => ({ release, pickup: asUser(DRVB, pickupCall(r)), approve: asUser(ADMB, `approve_reservation('${r}')`) }) },
};
const summary = {};
for (const [name, s] of Object.entries(scen)) {
  sql(`update organization_settings set auto_release_enabled=true, no_show_release_grace_minutes=${s.grace} where organization_id='${ORGB}'`);
  const agg = { iterations: 0, deadlocks: 0, inconsistent: 0, outcomes: {}, errors: {}, release_released: 0, release_locked: 0, samples: [] };
  for (let i = 1; i <= N; i++) {
    const k = `cc_${name}_${i}_${Date.now()}`;
    const [[T]] = sql(`select (clock_timestamp()+interval '1800 milliseconds')::text`);
    const [[v]] = sql(`select t1.mkveh('${k}','b')`);
    sql(`update vehicles set status='${s.veh}' where id='${v}'`);
    const [[r]] = sql(`select t1.mkres('${k}','t1drvb','${k}','${s.status}',now()-interval '3 hours',${s.end(T)})`);
    if (s.prepare) sql(`begin; select set_config('request.jwt.claims','${claims(DRVB)}',true); set local role authenticated; select fm_prepare_equipment_checklist('${r}') is not null; commit;`);
    const sess = s.sess(r); const names = Object.keys(sess);
    const results = await Promise.all(names.map(n => psql(wait(T) + sess[n])));
    const errs = {};
    names.forEach((n, j) => { const e = results[j].err; if (e) { const m = e.match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]+)/); errs[n] = m ? `${m[1]} ${m[2].slice(0, 70)}` : e.slice(0, 80); } });
    for (const [n, e] of Object.entries(errs)) { const key = `${n}: ${e.replace(/[0-9a-f-]{36}/g, '<id>')}`; agg.errors[key] = (agg.errors[key] ?? 0) + 1; if (/40P01|deadlock/i.test(e)) agg.deadlocks++; }
    const [[rs, reason, vs, nRel, nCancel, nApprove, nInsp, nNotif]] = sql(`select r.status, coalesce(r.cancellation_reason,'-'), v.status,
      (select count(*) from audit_log where entity_id=r.id and action='reservation.no_show_released'),
      (select count(*) from audit_log where entity_id=r.id and action in ('reservation_cancelled','reservation.cancelled')),
      (select count(*) from audit_log where entity_id=r.id and action='reservation_approved'),
      (select count(*) from inspections where reservation_id=r.id),
      (select count(*) from notifications where entity_id=r.id and title in ('Reserva não retirada','Solicitação de reserva expirada'))
      from reservations r join vehicles v on v.id=r.vehicle_id where r.id='${r}'`);
    const relOut = results[names.indexOf('release')].out.split(/\r?\n/).filter(l => l.startsWith('{')).pop() ?? '';
    try { const j = JSON.parse(relOut); agg.release_locked += j.skipped_locked; agg.release_released += j.released; } catch {}
    const who = reason === 'T1 concorrencia' ? 'user_cancel' : reason;
    const outcome = `${rs}/${who}/veh=${vs}/insp=${nInsp}/appr=${nApprove}`;
    agg.outcomes[outcome] = (agg.outcomes[outcome] ?? 0) + 1;
    const bad = [];
    if (Number(nRel) > 1 || Number(nNotif) > 1) bad.push('auditoria/notificacao duplicada');
    if (rs === 'cancelled' && reason === 'no_show_auto' && Number(nInsp) > 0) bad.push('liberou reserva com atividade');
    if (rs === 'cancelled' && reason.startsWith('expired') === false && reason !== 'no_show_auto' && who !== 'user_cancel') bad.push('motivo inesperado');
    if ((reason === 'no_show_auto' || reason === 'expired_unapproved') && Number(nRel) !== 1) bad.push('liberado sem auditoria');
    if (rs === 'cancelled' && Number(nInsp) === 0 && vs !== 'available') bad.push('cancelada mas veiculo nao disponivel');
    if (rs === 'confirmed' && Number(nInsp) === 0 && vs !== 'reserved') bad.push('confirmada mas veiculo nao reservado');
    if (rs === 'pending_approval' && vs !== 'available') bad.push('pendente mas veiculo alterado');
    if (s.status === 'pending_approval' && rs === 'confirmed' && name === 'pending_expired') bad.push('aprovou pedido vencido');
    if (bad.length) { agg.inconsistent++; if (agg.samples.length < 8) agg.samples.push({ i, r, rs, reason, vs, nRel, nCancel, nApprove, nInsp, bad, errs }); }
    agg.iterations++;
  }
  summary[name] = agg;
}
sql(`update organization_settings set auto_release_enabled=true, no_show_release_grace_minutes=60 where organization_id='${ORGB}'`);
summary.org_b_settings_after = sql(`select auto_release_enabled||'/'||no_show_release_grace_minutes from organization_settings where organization_id='${ORGB}'`)[0][0];
console.log(JSON.stringify(summary, null, 1));
