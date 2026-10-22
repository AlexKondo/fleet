// C6 (CNH x acesso), C7 (permissoes 0210 / isolamento / fluxos SP-Campinas-Rio / avaria / OS) e provas HTTP de C1-C4.
// PostgREST LOCAL com JWT reais do GoTrue local. Uso: node t1_c6c7_http.mjs <env> <creds>
import crypto from 'node:crypto';
import { loadEnv, loadCreds, Api, sql, ids, summarize } from './t1_lib.mjs';
const [envPath, credsPath] = process.argv.slice(2);
const api = new Api(loadEnv(envPath), loadCreds(credsPath));
const I = ids(); const out = [];
const rec = (id, desc, actor, expected, r, pass, extra = {}) => out.push({ id, desc, actor, expected, ...summarize(r), ...extra, result: pass ? 'PASS' : 'FAIL' });
const ok = r => r.status < 300, bad = r => r.status >= 400;
const pickup = (res, role, damage = false) => ({ p_reservation_id: res, p_odometer_km: role === 'security' ? null : 10010, p_fuel_level_percent: role === 'security' ? null : 80, p_battery_level_percent: null, p_has_damage: damage, p_damage_notes: damage ? 'T1 risco na porta' : null, p_missing_safety_equipment: role === 'security' ? null : [], p_is_dirty_exterior: role === 'security' ? null : false, p_is_dirty_interior: role === 'security' ? null : false, p_role: role });
const ret = (res, role) => ({ p_reservation_id: res, p_odometer_km: role === 'security' ? null : 10050, p_fuel_level_percent: role === 'security' ? null : 70, p_battery_level_percent: null, p_has_new_damage: false, p_damage_notes: null, p_missing_safety_equipment: role === 'security' ? null : [], p_is_dirty_exterior: role === 'security' ? null : false, p_is_dirty_interior: role === 'security' ? null : false, p_role: role, p_vehicle_event: '', p_workflow_tasks: [], p_current_location_id: null });
const gate = (res, kind) => ({ p_command: 'gate.record', p_payload: { reservation_id: res, kind }, p_request_id: crypto.randomUUID() });
const key = (res, kind) => ({ p_reservation_id: res, p_kind: kind, p_reason: null, p_request_id: crypto.randomUUID() });
const cnt = res => sql(`select (select count(*) from inspections where reservation_id='${res}')||'/'||(select count(*) from fm_key_events where reservation_id='${res}')||'/'||(select count(*) from fm_gate_events where reservation_id='${res}')`)[0][0];
const st = res => sql(`select r.status||'/'||v.status||'/dmg='||v.has_blocking_damage||' insp='||(select count(*) from inspections i where i.reservation_id=r.id)||' gate='||coalesce((select string_agg(kind,',' order by created_at) from fm_gate_events g where g.reservation_id=r.id),'-')||' keys='||coalesce((select string_agg(kind,',' order by created_at) from fm_key_events k where k.reservation_id=r.id),'-') from reservations r join vehicles v on v.id=r.vehicle_id where r.id='${res}'`)[0]?.[0];
const step = async (id, desc, actor, fn, args, expectOk) => { const r = await api.rpc(actor, fn, args); rec(id, desc, actor, expectOk ? 'sucesso' : 'negado', r, expectOk ? ok(r) : bad(r)); return r; };
const rows = r => Array.isArray(r.body) ? r.body.length : null;

// ================= C6 CNH x acesso =================
for (const [id, desc, a, fn, args, res] of [
  ['C6-01', 'retirada (checklist do condutor) CNH vencida', 't1drvexp', 'record_pickup', pickup(I.r_cnh_sp_exp, 'traveler'), I.r_cnh_sp_exp],
  ['C6-02', 'retirada CNH NULL', 't1drvnull', 'record_pickup', pickup(I.r_cnh_sp_null, 'traveler'), I.r_cnh_sp_null],
  ['C6-03', 'gestor registra checklist em nome de condutor com CNH vencida', 't1fmall', 'record_pickup', pickup(I.r_cnh_sp_exp, 'traveler'), I.r_cnh_sp_exp],
  ['C6-04', 'Seguranca registra checklist para condutor com CNH vencida', 't1sec', 'record_pickup', pickup(I.r_cnh_sp_exp, 'security'), I.r_cnh_sp_exp],
  ['C6-05', 'custodiante entrega chave para condutor com CNH vencida (Campinas)', 't1custcp', 'fm_key_command', key(I.r_cnh_cp_exp, 'delivered'), I.r_cnh_cp_exp],
  ['C6-06', 'saida fisica para condutor com CNH vencida', 't1sec', 'fm_v3_command', gate(I.r_cnh_sp_exp, 'departure'), I.r_cnh_sp_exp],
  ['C6-07', 'admin SEM CNH retira o veiculo da propria reserva', 't1adminnocnh', 'record_pickup', pickup(I.r_adm_self, 'traveler'), I.r_adm_self],
]) { const before = cnt(res); const r = await api.rpc(a, fn, args); const after = cnt(res); rec(id, `${desc} [insp/key/gate ${before}->${after}]`, a, 'negado sem efeito', r, bad(r) && before === after); }
// CNH vence entre os checklists e a saida fisica
await step('C6-08a', 'condutor (CNH valida) prepara checklist', 't1req2', 'fm_prepare_equipment_checklist', { p_reservation_id: I.r_cnh_gate_late }, true);
await step('C6-08b', 'condutor (CNH valida) checklist', 't1req2', 'record_pickup', pickup(I.r_cnh_gate_late, 'traveler'), true);
await step('C6-08c', 'Seguranca checklist', 't1sec', 'record_pickup', pickup(I.r_cnh_gate_late, 'security'), true);
sql(`update profiles set drivers_license_expiration=current_date-1 where id=t1.uid('t1req2')`);
{ const b = cnt(I.r_cnh_gate_late); const r = await api.rpc('t1sec', 'fm_v3_command', gate(I.r_cnh_gate_late, 'departure')); rec('C6-08d', `CNH venceu apos os checklists: Seguranca tenta saida fisica [${b}->${cnt(I.r_cnh_gate_late)}]`, 't1sec', 'negado', r, bad(r)); }
// controles positivos
await step('C6-09a', 'CNH valida: prepara checklist', 't1drvok', 'fm_prepare_equipment_checklist', { p_reservation_id: I.r_cnh_sp_ok }, true);
await step('C6-09b', 'CNH valida: retirada', 't1drvok', 'record_pickup', pickup(I.r_cnh_sp_ok, 'traveler'), true);
// administrativo e passageiro sem CNH
for (const [id, a, fn, args] of [
  ['C6-10', 't1adminnocnh', 'approve_reservation', { p_reservation_id: I.r_pend_adm }],
  ['C6-11', 't1fmnocnh', 'approve_reservation', { p_reservation_id: I.r_pend_fm }],
  ['C6-12', 't1adminnocnh', 'list_member_licenses', {}],
  ['C6-13', 't1adminnocnh', 'list_member_license_sources', {}],
  ['C6-14', 't1fmnocnh', 'fm_key_management_workspace', {}],
  ['C6-15', 't1adminnocnh', 'fm_update_vehicle', { p_id: I.v_iso_sp, p_payload: { color: 'Prata' }, p_correction_reason: null }],
  ['C6-16', 't1emp', 'fm_availability_windows', { p_from: new Date().toISOString() }],
  ['C6-17', 't1drvexp', 'fm_availability_windows', { p_from: new Date().toISOString() }],
]) { const r = await api.rpc(a, fn, args); rec(id, 'sem CNH (ou CNH vencida) - atividade administrativa/consulta: ' + fn, a, 'sucesso', r, ok(r)); }
const hostTrip = sql(`select trip_request_id from reservations where id='${I.r_host}'`)[0][0];
const tripArgs = { p_departure_at: new Date(Date.now() + 2 * 864e5).toISOString(), p_expected_return_at: new Date(Date.now() + 2 * 864e5 + 3 * 36e5).toISOString(), p_origin: 'T1 origem', p_destination: 'T1 destino', p_distance_km: 30, p_passenger_count: 1, p_requires_cargo: false, p_justification: 'T1 carona como passageiro', p_existing_trip_request_id: hostTrip };
for (const a of ['t1emp', 't1adminnocnh', 't1fmnocnh', 't1drvexp', 't1drvnull']) { const r = await api.rpc(a, 'create_carpool_participation', tripArgs); rec('C6-18', 'pedir carona como PASSAGEIRO sem CNH valida', a, 'sucesso', r, ok(r)); }
for (const [a, t, q] of [['t1adminnocnh', 'audit_log', 'select=id&limit=5'], ['t1adminnocnh', 'reservations', 'select=id,status&limit=5'], ['t1fmnocnh', 'vehicles', 'select=id,plate&limit=50'], ['t1emp', 'vehicles', 'select=id,plate&limit=50'], ['t1emp', 'trip_requests', 'select=id&limit=50'], ['t1drvexp', 'reservations', 'select=id,status&limit=50']]) {
  const r = await api.get(a, t, q); rec('C6-19', `consulta ${t}`, a, '200 com linhas', r, r.status === 200 && rows(r) > 0, { rows: rows(r) });
}
// conta desativada sem acesso
for (const [a, t] of [['t1deact', 'vehicles'], ['t1deact', 'reservations'], ['t1deact', 'profiles'], ['t1deact', 'notifications']]) { const r = await api.get(a, t, 'select=id&limit=5'); rec('C6-20', `conta desativada le ${t}`, a, '0 linhas', r, r.status >= 400 || rows(r) === 0, { rows: rows(r) }); }
{ const r = await api.rpc('t1deact', 'create_carpool_participation', tripArgs); rec('C6-21', 'conta desativada pede carona', 't1deact', 'negado', r, bad(r)); }
{ const r = await api.rpc('t1deact', 'fm_availability_windows', { p_from: new Date().toISOString() }); rec('C6-22', 'conta desativada consulta disponibilidade', 't1deact', 'negado ou vazio', r, bad(r) || rows(r) === 0, { rows: rows(r) }); }
// antifraude
{ const r = await api.patch('t1drvexp', 'profiles', `id=eq.${I.u_t1drvexp}`, { drivers_license_expiration: '2099-12-31', driver_authorized: true }); rec('C6-23', 'motorista CNH vencida renova via PATCH profiles', 't1drvexp', 'sem efeito', r, bad(r) || r.rows === 0); }
{ const r = await api.patch('t1admin', 'profiles', `id=eq.${I.u_t1custrj}`, { drivers_license_expiration: '2099-12-31' }); rec('C6-24', 'admin altera CNH lida por IA (profiles_license_lock_trg)', 't1admin', 'negado/sem efeito', r, bad(r) || r.rows === 0); }
for (const a of ['t1drvok', 't1admin', 'anon']) {
  const r1 = await api.rpc(a, 'apply_ai_license_read', { p_user_id: I.u_t1drvexp, p_full_name: 'x', p_number: '1', p_category: 'B', p_expiration: '2099-01-01', p_authorized: true });
  rec('C6-25', 'apply_ai_license_read direto', a, '42501', r1, bad(r1) && r1.code === '42501');
  const r2 = await api.rpc(a, 'reset_ai_license', { p_user_id: I.u_t1custrj });
  rec('C6-26', 'reset_ai_license direto', a, '42501', r2, bad(r2) && r2.code === '42501');
}
{ const r = await api.rpc('t1admin', 'list_member_license_sources', {}); const mine = Array.isArray(r.body) ? r.body.find(x => Object.values(x).includes(I.u_t1custrj)) : null; rec('C6-27', 'list_member_license_sources mostra a origem ai', 't1admin', 'linha com ai', r, ok(r) && mine && JSON.stringify(mine).includes('ai'), { sample: mine }); }
{ const r = await api.rpc('t1drvok', 'list_member_license_sources', {}); rec('C6-28', 'list_member_license_sources por empregado', 't1drvok', 'negado ou vazio', r, bad(r) || rows(r) === 0, { rows: rows(r) }); }
{ const r = await api.rpc('t1adminb', 'list_member_license_sources', {}); const leak = Array.isArray(r.body) && JSON.stringify(r.body).includes(I.u_t1custrj); rec('C6-29', 'admin Org B lista fontes de CNH (sem Org A)', 't1adminb', 'sem linhas da Org A', r, !leak); }
out.push({ id: 'C6-30', desc: 'criar reserva de VEICULO (conducao) com CNH vencida via create_vehicle_reservation', actor: 't1drvexp', ...summarize(await api.rpc('t1drvexp', 'create_vehicle_reservation', { p_departure_at: new Date(Date.now() + 5 * 864e5).toISOString(), p_expected_return_at: new Date(Date.now() + 5 * 864e5 + 36e5).toISOString(), p_origin: 'T1', p_destination: 'T1', p_distance_km: 10, p_passenger_count: 1, p_requires_cargo: false, p_justification: 'T1 teste CNH', p_vehicle_id: I.v_iso_sp, p_allow_carpool: false })), result: 'INFO' });
out.push({ id: 'C6-lic', desc: 'licencas apos os testes', state: sql(`select string_agg(full_name||':'||coalesce(drivers_license_expiration::text,'null')||':'||driver_authorized||':'||coalesce(drivers_license_expiration_source,'-'),' | ' order by full_name) from profiles where id in (t1.uid('t1drvexp'),t1.uid('t1custrj'),t1.uid('t1drvnull'))`)[0][0], result: 'INFO' });

// ================= C7 isolamento / 0210 =================
const actors = ['t1admin', 't1adminnocnh', 't1fmall', 't1fmsp', 't1fmcp', 't1sec', 't1maint', 't1custcp', 't1drvok', 't1emp', 't1deact', 't1adminb', 't1drvb', 't1secb', 'anon'];
const vT = { sp: I.v_iso_sp, cp: I.v_iso_cp, b: I.v_iso_b };
const canEdit = { t1admin: ['sp', 'cp'], t1adminnocnh: ['sp', 'cp'], t1fmall: ['sp', 'cp'], t1fmsp: ['sp'], t1fmcp: ['cp'], t1adminb: ['b'] };
const snap = () => sql(`select string_agg(v.id||':'||status||':'||has_blocking_damage||':'||documentation_valid||':'||coalesce(cardinality(missing_safety_equipment),0)||':'||coalesce(photo_storage_path,'-')||':'||coalesce(current_location_id::text,'-')||':'||coalesce(archived_at::text,'-')||':'||odometer_km||':'||coalesce(fuel_level_percent::text,'-'),';' order by v.id) from vehicles v where id in ('${vT.sp}','${vT.cp}','${vT.b}')`)[0][0];
const before = snap(); let nOp = 0, nOpPass = 0;
for (const a of actors) for (const [vk, vid] of Object.entries(vT)) {
  for (const body of [{ status: 'available' }, { has_blocking_damage: true }, { documentation_valid: false }, { missing_safety_equipment: ['x'] }, { photo_storage_path: 'x' }, { current_location_id: null }, { archived_at: new Date().toISOString() }, { odometer_km: 1 }, { fuel_level_percent: 1 }, { battery_level_percent: 1 }, { estimated_range_km: 1 }]) {
    const r = await api.patch(a, 'vehicles', `id=eq.${vid}`, body); nOp++; const pass = bad(r) || r.rows === 0; if (pass) nOpPass++;
    if (!pass) rec('C7-01', `PATCH operacional ${Object.keys(body)[0]} em ${vk}`, a, 'negado/0 linhas', r, false);
  }
  const r = await api.patch(a, 'vehicles', `id=eq.${vid}`, { name: `T1 iso ${vk} ${a}` });
  const exp = (canEdit[a] ?? []).includes(vk);
  rec('C7-02', `PATCH cadastro (name) em ${vk}`, a, exp ? '200, 1 linha' : 'negado/0 linhas', r, exp ? (r.status === 200 && r.rows === 1) : (bad(r) || r.rows === 0));
}
rec('C7-01', `PATCH de 11 colunas operacionais x ${actors.length} atores x 3 veiculos`, 'todos', 'todos negados/0 linhas', { status: 0 }, nOp === nOpPass && snap() === before, { cases: nOp, passed: nOpPass, state_unchanged: snap() === before });
// RPC fora do escopo sem efeito
for (const [a, fn, args, label] of [
  ['t1fmsp', 'approve_reservation', { p_reservation_id: I.r_iso_cp_pend }, 'gestor SP aprova pedido CP'],
  ['t1fmcp', 'approve_reservation', { p_reservation_id: I.r_iso_sp_pend }, 'gestor CP aprova pedido SP'],
  ['t1adminb', 'approve_reservation', { p_reservation_id: I.r_iso_sp_pend }, 'admin Org B aprova pedido Org A'],
  ['t1admin', 'approve_reservation', { p_reservation_id: I.r_iso_b_pend }, 'admin Org A aprova pedido Org B'],
  ['t1sec', 'approve_reservation', { p_reservation_id: I.r_iso_sp_pend }, 'Seguranca aprova'],
  ['t1drvok', 'approve_reservation', { p_reservation_id: I.r_iso_sp_pend }, 'empregado aprova'],
  ['t1fmsp', 'block_vehicle', { p_vehicle_id: I.v_iso_cp, p_reason: 'T1 fora do escopo' }, 'gestor SP bloqueia veiculo CP'],
  ['t1adminb', 'block_vehicle', { p_vehicle_id: I.v_iso_sp, p_reason: 'T1 outra org' }, 'admin Org B bloqueia veiculo Org A'],
  ['t1fmsp', 'complete_workflow_task', { p_task_id: I.t_iso_task_cp }, 'gestor SP conclui tarefa CP'],
  ['t1adminb', 'complete_workflow_task', { p_task_id: I.t_iso_task_sp }, 'admin Org B conclui tarefa Org A'],
  ['t1fmcp', 'fm_claim_workflow_task', { p_task_id: I.t_iso_task_sp }, 'gestor CP assume tarefa SP'],
  ['t1admin', 'fm_claim_workflow_task', { p_task_id: I.t_iso_task_b }, 'admin Org A assume tarefa Org B'],
  ['t1fmsp', 'fm_update_vehicle', { p_id: I.v_iso_cp, p_payload: { odometer_km: 99999 }, p_correction_reason: null }, 'gestor SP edita medicao CP'],
  ['t1admin', 'fm_update_vehicle', { p_id: I.v_iso_b, p_payload: { odometer_km: 99999 }, p_correction_reason: null }, 'admin A edita medicao Org B'],
  ['t1admin', 'fm_release_expired_reservations', { p_organization_id: null }, 'admin executa liberacao'],
  ['t1fmall', 'fm_release_expired_reservations', {}, 'gestor executa liberacao'],
]) { const r = await api.rpc(a, fn, args); rec('C7-03', `RPC fora do escopo: ${label}`, a, 'negado', r, bad(r)); }
const isoState = sql(`select string_agg(x.k||'='||r.status,',' order by x.k) from t1.r x join reservations r on r.id=x.id where x.k like 'iso_%'`)[0][0] + ' | ' + sql(`select string_agg(x.k||'='||w.status||':'||coalesce(w.assigned_to::text,'-'),',' order by x.k) from t1.t x join workflow_tasks w on w.id=x.id where x.k like 'iso_%'`)[0][0];
out.push({ id: 'C7-03s', desc: 'estado apos RPCs fora do escopo (tudo pendente/aberto, sem atribuicao)', state: isoState + ' | ' + sql(`select string_agg(status::text||':'||odometer_km,',') from vehicles where id in ('${I.v_iso_cp}','${I.v_iso_b}','${I.v_iso_sp}')`)[0][0], result: /confirmed|done|:[0-9a-f]{8}-/.test(isoState) ? 'FAIL' : 'PASS' });
// anon nada
for (const t of ['vehicles', 'reservations', 'workflow_tasks', 'profiles', 'fm_operation_exceptions', 'audit_log', 'fm_photo_uploads', 'inspection_photos', 'organization_settings']) { const r = await api.get('anon', t, 'select=*&limit=3'); rec('C7-04', `anon le ${t}`, 'anon', '401/403 ou 0 linhas', r, bad(r) || rows(r) === 0, { rows: rows(r) }); }
for (const fn of ['fm_release_expired_reservations', 'fm_claim_workflow_task', 'fm_update_vehicle', 'fm_photo_begin', 'fm_photo_pending', 'fm_not_departed_reservations', 'approve_reservation']) { const r = await api.rpc('anon', fn, {}); rec('C7-05', `anon RPC ${fn}`, 'anon', '401/404 negado', r, bad(r)); }
// HTTP: tarefas e motivo interno
for (const a of ['t1drvok', 't1emp', 't1sec', 't1custcp', 't1fmcp']) { const r = await api.get(a, 'workflow_tasks', `select=id,notes&id=eq.${I.t_iso_task_sp}`); rec('C2-H1', 'HTTP: notas internas de tarefa SP', a, '0 linhas', r, r.status >= 400 || rows(r) === 0, { rows: rows(r) }); }
{ const r = await api.get('t1fmsp', 'workflow_tasks', `select=id,notes&id=eq.${I.t_iso_task_sp}`); rec('C2-H2', 'HTTP: gestor SP le notas da tarefa SP', 't1fmsp', '1 linha', r, rows(r) === 1); }
for (const a of ['t1admin', 't1fmsp', 't1maint', 't1drvok']) {
  const r1 = await fetch(`${api.API}/rest/v1/workflow_tasks`, { method: 'POST', headers: { ...(await api.headers(a)), 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: '7a000000-0000-0000-0000-00000000000a', vehicle_id: I.v_iso_sp, type: 'cleaning', notes: 'T1 injetada' }) });
  rec('C2-H3', 'HTTP: POST workflow_tasks', a, '401/403', { status: r1.status, msg: (await r1.text()).slice(0, 80) }, r1.status >= 400);
  const r2 = await api.patch(a, 'workflow_tasks', `id=eq.${I.t_iso_task_sp}`, { assigned_to: I['u_' + a] ?? null });
  rec('C2-H4', 'HTTP: PATCH workflow_tasks.assigned_to', a, 'negado', r2, bad(r2) || r2.rows === 0);
}
{ const r = await api.get('t1drvok', 'reservations', `select=id,status,cancellation_reason&id=eq.${I.r_ex_sp}`); rec('C4-H1', 'HTTP: solicitante le reservations.cancellation_reason da reserva encerrada por excecao', 't1drvok', 'motivo interno NAO exposto', r, !(JSON.stringify(r.body).includes('SIGILOSO')), { body: r.body }); }
{ const r = await api.get('t1drvok', 'notifications', `select=title,body&entity_id=eq.${I.r_ex_sp}`); rec('C4-H2', 'HTTP: notificacao recebida pelo solicitante', 't1drvok', 'motivo interno NAO exposto', r, !(JSON.stringify(r.body).includes('SIGILOSO')), { body: r.body }); }
{ const r = await api.rpc('t1drvok', 'fm_not_departed_reservations', { p_ids: [I.r_ex_sp] }); rec('C4-H3', 'HTTP: rotulo fm_not_departed_reservations', 't1drvok', 'contem a reserva', r, ok(r) && JSON.stringify(r.body).includes(I.r_ex_sp)); }
{ const r = await api.get('t1drvok', 'fm_operation_exceptions', `select=reason&reservation_id=eq.${I.r_ex_sp}`); rec('C4-H4', 'HTTP: solicitante le fm_operation_exceptions', 't1drvok', '0 linhas', r, rows(r) === 0 || bad(r)); }

// ================= C7 fluxos =================
const SP = I.r_ops_sp, BEH = I.r_ops_beh, CP = I.r_ops_cp, RJ = I.r_ops_rj, DMG = I.r_dmg_sp;
await step('G1', 'condutor prepara checklist SP', 't1drvok', 'fm_prepare_equipment_checklist', { p_reservation_id: SP }, true);
await step('G2', 'checklist do condutor', 't1drvok', 'record_pickup', pickup(SP, 'traveler'), true);
await step('G3', 'saida fisica sem checklist da Seguranca', 't1sec', 'fm_v3_command', gate(SP, 'departure'), false);
await step('G4', 'gestor tenta checklist como Seguranca', 't1fmall', 'record_pickup', pickup(SP, 'security'), false);
await step('G5', 'admin tenta checklist como Seguranca', 't1admin', 'record_pickup', pickup(SP, 'security'), false);
await step('G6', 'checklist independente da Seguranca', 't1sec', 'record_pickup', pickup(SP, 'security'), true);
await step('G7', 'gestor registra saida fisica', 't1fmall', 'fm_v3_command', gate(SP, 'departure'), false);
await step('G8', 'admin registra saida fisica', 't1admin', 'fm_v3_command', gate(SP, 'departure'), false);
await step('G9', 'condutor registra a propria saida', 't1drvok', 'fm_v3_command', gate(SP, 'departure'), false);
await step('G10', 'Seguranca da Org B registra saida na Org A', 't1secb', 'fm_v3_command', gate(SP, 'departure'), false);
await step('G11', 'Seguranca registra saida fisica', 't1sec', 'fm_v3_command', gate(SP, 'departure'), true);
out.push({ id: 'G11s', desc: 'estado apos saida', state: st(SP), result: /\/in_use\//.test(st(SP)) ? 'PASS' : 'FAIL' });
await step('G12', 'condutor checklist de devolucao', 't1drvok', 'record_return', ret(SP, 'traveler'), true);
await step('G13', 'gestor registra chegada fisica', 't1fmall', 'fm_v3_command', gate(SP, 'arrival'), false);
await step('G14', 'Seguranca registra chegada fisica', 't1sec', 'fm_v3_command', gate(SP, 'arrival'), true);
out.push({ id: 'G14s', desc: 'estado final SP', state: st(SP), result: 'INFO' });
await step('B1', 'gestor CP prepara checklist em nome (veiculo SP)', 't1fmcp', 'fm_prepare_equipment_checklist', { p_reservation_id: BEH }, false);
await step('B2', 'gestor SP prepara checklist em nome', 't1fmsp', 'fm_prepare_equipment_checklist', { p_reservation_id: BEH }, true);
await step('B3', 'gestor SP checklist do condutor em nome dele', 't1fmsp', 'record_pickup', pickup(BEH, 'traveler'), true);
await step('B4', 'Seguranca checklist', 't1sec', 'record_pickup', pickup(BEH, 'security'), true);
await step('B5', 'gestor SP registra saida fisica', 't1fmsp', 'fm_v3_command', gate(BEH, 'departure'), false);
await step('B6', 'Seguranca registra saida', 't1sec', 'fm_v3_command', gate(BEH, 'departure'), true);
for (const [pfx, R, cust, other, unit] of [['K', CP, 't1custcp', 't1custrj', 'Campinas'], ['R', RJ, 't1custrj', 't1custcp', 'Rio']]) {
  await step(pfx + '1', `${unit}: Seguranca tenta portaria em unidade de chaves`, 't1sec', 'fm_v3_command', gate(R, 'departure'), false);
  await step(pfx + '2', `${unit}: gestor (nao custodiante) entrega chave`, 't1fmall', 'fm_key_command', key(R, 'delivered'), false);
  await step(pfx + '3', `${unit}: custodiante de outra unidade entrega chave`, other, 'fm_key_command', key(R, 'delivered'), false);
  await step(pfx + '4', `${unit}: condutor prepara checklist`, 't1drvok', 'fm_prepare_equipment_checklist', { p_reservation_id: R }, true);
  await step(pfx + '5', `${unit}: custodiante entrega a chave real`, cust, 'fm_key_command', key(R, 'delivered'), true);
  await step(pfx + '6', `${unit}: condutor faz retirada digital`, 't1drvok', 'record_pickup', pickup(R, 'traveler'), true);
  out.push({ id: pfx + '6s', desc: `${unit}: estado apos retirada`, state: st(R), result: /\/in_use\//.test(st(R)) ? 'PASS' : 'FAIL' });
  await step(pfx + '7', `${unit}: condutor registra devolucao`, 't1drvok', 'record_return', ret(R, 'traveler'), true);
  await step(pfx + '8', `${unit}: condutor registra recebimento da propria chave`, 't1drvok', 'fm_key_command', key(R, 'received'), false);
  await step(pfx + '9', `${unit}: custodiante registra recebimento real`, cust, 'fm_key_command', key(R, 'received'), true);
  out.push({ id: pfx + '9s', desc: `${unit}: estado final`, state: st(R), result: 'INFO' });
}
// Avaria: somente pelo comando auditado e independente
await step('D1', 'gestor SP prepara checklist em nome', 't1fmsp', 'fm_prepare_equipment_checklist', { p_reservation_id: DMG }, true);
await step('D2', 'gestor SP registra checklist COM avaria em nome do condutor', 't1fmsp', 'record_pickup', pickup(DMG, 'traveler', true), true);
const [[task]] = sql(`select id from workflow_tasks where vehicle_id=t1.vid('dmg_sp') and type='repair' and status='open' order by created_at desc limit 1`);
out.push({ id: 'D2s', desc: 'estado com avaria', state: st(DMG), task, result: /dmg=true/.test(st(DMG)) ? 'PASS' : 'FAIL' });
await step('D3', 'Seguranca checklist', 't1sec', 'record_pickup', pickup(DMG, 'security'), true);
await step('D4', 'Seguranca tenta saida com avaria bloqueante', 't1sec', 'fm_v3_command', gate(DMG, 'departure'), false);
{ const r = await api.patch('t1fmall', 'workflow_tasks', `id=eq.${task}`, { status: 'done' }); rec('D5', 'gestor PATCH direto tarefa de reparo done', 't1fmall', 'negado', r, bad(r) || r.rows === 0); }
{ const r = await api.patch('t1fmall', 'vehicles', `id=eq.${I.v_dmg_sp}`, { has_blocking_damage: false }); rec('D6', 'gestor PATCH direto has_blocking_damage=false', 't1fmall', 'negado', r, bad(r) || r.rows === 0); }
await step('D7', 'gestor de outra unidade conclui reparo', 't1fmcp', 'complete_workflow_task', { p_task_id: task }, false);
await step('D8', 'gestor que registrou a avaria tenta liberar', 't1fmsp', 'complete_workflow_task', { p_task_id: task }, false);
await step('D9', 'Seguranca conclui reparo', 't1sec', 'complete_workflow_task', { p_task_id: task }, false);
await step('D10', 'gestor independente assume a tarefa (comando auditado 0225)', 't1fmall', 'fm_claim_workflow_task', { p_task_id: task }, true);
await step('D11', 'gestor independente conclui reparo -> libera retencao', 't1fmall', 'complete_workflow_task', { p_task_id: task }, true);
out.push({ id: 'D11s', desc: 'estado apos liberacao + auditoria', state: st(DMG), audit: sql(`select string_agg(action,',' order by created_at) from audit_log where entity_id in (t1.vid('dmg_sp'),'${task}') and action in ('vehicle.damage_hold_released','workflow_task.claimed')`)[0]?.[0], result: /dmg=false/.test(st(DMG)) ? 'PASS' : 'FAIL' });
// OS sem orcamento a passageiro/condutor
for (const a of ['t1drvok', 't1emp', 't1sec', 't1custcp']) {
  const wo = await api.get(a, 'fm_work_orders', 'select=id,description,quote_total');
  rec('O1', 'leitura direta fm_work_orders', a, '0 linhas', wo, wo.status >= 400 || rows(wo) === 0, { rows: rows(wo) });
  const wl = await api.get(a, 'fm_work_order_lines', 'select=id,description,unit_price');
  rec('O2', 'leitura direta fm_work_order_lines', a, '0 linhas', wl, wl.status >= 400 || rows(wl) === 0, { rows: rows(wl) });
  const aw = await api.rpc(a, 'fm_availability_windows', { p_from: new Date().toISOString() });
  const keys = Array.isArray(aw.body) && aw.body[0] ? Object.keys(aw.body[0]).sort().join(',') : '';
  const has = Array.isArray(aw.body) && aw.body.some(x => x.vehicle_id === I.v_wo_sp);
  rec('O3', 'fm_availability_windows: so janela (sem descricao/orcamento)', a, 'colunas end_at,kind,start_at,vehicle_id', aw, ok(aw) && keys === 'end_at,kind,start_at,vehicle_id' && !JSON.stringify(aw.body).includes('1234.56') && !JSON.stringify(aw.body).includes('DESCRICAO INTERNA'), { columns: keys, os_window_visible: has });
}
{ const wo = await api.get('t1fmsp', 'fm_work_orders', `select=id,quote_total&vehicle_id=eq.${I.v_wo_sp}`); rec('O4', 'gestor SP le a OS (controle positivo)', 't1fmsp', '1 linha', wo, rows(wo) === 1); }
{ const wo = await api.get('t1fmcp', 'fm_work_orders', `select=id,quote_total&vehicle_id=eq.${I.v_wo_sp}`); rec('O5', 'gestor CP le OS de veiculo SP', 't1fmcp', '0 linhas', wo, rows(wo) === 0 || bad(wo)); }
const fails = out.filter(x => x.result === 'FAIL');
console.log(JSON.stringify({ total: out.filter(x => x.result !== 'INFO').length, fails: fails.length, out }, null, 1));
