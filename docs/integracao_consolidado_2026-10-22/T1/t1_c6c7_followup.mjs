// Reexecucao corrigida de 2 entradas de teste do t1_c6c7_http.mjs:
//  (a) devolucao exige p_current_location_id (o app envia o local escolhido) -> refeita com o local da unidade;
//  (b) pedir carona exige oferta de carona ativa do anfitriao (o app so oferece viagens com oferta) -> oferta criada pelo anfitriao.
import crypto from 'node:crypto';
import { loadEnv, loadCreds, Api, sql, ids, summarize } from './t1_lib.mjs';
const [envPath, credsPath] = process.argv.slice(2);
const api = new Api(loadEnv(envPath), loadCreds(credsPath));
const I = ids(); const out = [];
const rec = (id, desc, actor, expected, r, pass, extra = {}) => out.push({ id, desc, actor, expected, ...summarize(r), ...extra, result: pass ? 'PASS' : 'FAIL' });
const ok = r => r.status < 300;
const st = res => sql(`select r.status||'/'||v.status||' insp='||(select string_agg(type::text||':'||performed_by_role,',' order by created_at) from inspections i where i.reservation_id=r.id)||' gate='||coalesce((select string_agg(kind,',' order by created_at) from fm_gate_events g where g.reservation_id=r.id),'-')||' keys='||coalesce((select string_agg(kind,',' order by created_at) from fm_key_events k where k.reservation_id=r.id),'-') from reservations r join vehicles v on v.id=r.vehicle_id where r.id='${res}'`)[0]?.[0];
const LOC = { sp: '7a000000-0000-0000-0000-0000000000c1', cp: '7a000000-0000-0000-0000-0000000000c2', rj: '7a000000-0000-0000-0000-0000000000c3' };
const ret = (res, loc) => ({ p_reservation_id: res, p_odometer_km: 10050, p_fuel_level_percent: 70, p_battery_level_percent: null, p_has_new_damage: false, p_damage_notes: null, p_missing_safety_equipment: [], p_is_dirty_exterior: false, p_is_dirty_interior: false, p_role: 'traveler', p_vehicle_event: '', p_workflow_tasks: [], p_current_location_id: loc });
{ const r = await api.rpc('t1drvok', 'record_return', ret(I.r_ops_sp, '7b000000-0000-0000-0000-0000000000c1')); rec('G12x', 'devolucao com local de OUTRA org', 't1drvok', 'INVALID_CURRENT_LOCATION', r, r.status >= 400); }
for (const [id, k, loc, unit] of [['G12b', 'ops_sp', LOC.sp, 'SP (apos chegada fisica)'], ['K7b', 'ops_cp', LOC.cp, 'Campinas (chave ja recebida)'], ['R7b', 'ops_rj', LOC.rj, 'Rio (chave ja recebida)']]) {
  const r = await api.rpc('t1drvok', 'record_return', ret(I['r_' + k], loc));
  rec(id, `${unit}: checklist de devolucao do condutor com local`, 't1drvok', 'sucesso', r, ok(r), { state: st(I['r_' + k]) });
}
// carona como passageiro
const hostTrip = sql(`select trip_request_id from reservations where id='${I.r_host}'`)[0][0];
{ const r = await api.rpc('t1drvok', 'enable_carpool_offer', { p_trip_request_id: hostTrip, p_seats: 3 }); rec('C6-18o', 'anfitriao (CNH valida) habilita oferta de carona', 't1drvok', 'sucesso', r, ok(r)); }
const tripArgs = { p_departure_at: new Date(Date.now() + 2 * 864e5).toISOString(), p_expected_return_at: new Date(Date.now() + 2 * 864e5 + 3 * 36e5).toISOString(), p_origin: 'T1 origem', p_destination: 'T1 destino', p_distance_km: 30, p_passenger_count: 1, p_requires_cargo: false, p_justification: 'T1 carona como passageiro', p_existing_trip_request_id: hostTrip };
for (const a of ['t1emp', 't1drvexp', 't1drvnull', 't1adminnocnh']) { const r = await api.rpc(a, 'create_carpool_participation', tripArgs); rec('C6-18b', 'pedir carona como PASSAGEIRO (oferta ativa) sem CNH valida', a, 'sucesso', r, ok(r)); }
{ const r = await api.get('t1emp', 'trip_requests', 'select=id'); rec('C6-19b', 'empregado sem CNH consulta as proprias solicitacoes', 't1emp', '200 com linhas', r, r.status === 200 && Array.isArray(r.body) && r.body.length > 0, { rows: Array.isArray(r.body) ? r.body.length : null }); }
{ const r = await api.rpc('t1deact', 'create_carpool_participation', tripArgs); rec('C6-21b', 'conta desativada pede carona (oferta ativa)', 't1deact', 'negado', r, r.status >= 400); }
console.log(JSON.stringify({ fails: out.filter(x => x.result === 'FAIL').length, out }, null, 1));
