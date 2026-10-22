// C5: fotos no banco (0212/0214/0216/0219/0221/0224/0227) via PostgREST + Storage LOCAIS com JWT reais.
// A etapa "servidor" (download + hash + fm_photo_attest de 6 argumentos com service_role + fm_photo_finalize do usuario)
// reproduz lib/domain/storedPhoto.ts (finishStoredPhoto). Uso: node t1_c5_photos.mjs <env> <creds>
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadEnv, loadCreds, Api, sql } from './t1_lib.mjs';
const [envPath, credsPath, itersArg] = process.argv.slice(2);
const ITER = Number(itersArg ?? 30);
const api = new Api(loadEnv(envPath), loadCreds(credsPath));
const out = []; let fails = 0;
const rec = (id, desc, expected, got, pass, extra = {}) => { if (!pass) fails++; out.push({ id, desc, expected, got, result: pass ? 'PASS' : 'FAIL', ...extra }); };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const jpeg = (n, seed) => { const b = crypto.randomBytes(n); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; if (seed) b.write(seed, 3); return b; };
const msg = r => r.status < 300 ? `${r.status} OK` : `${r.status} ${r.code ?? ''} ${(r.msg ?? JSON.stringify(r.body)).toString().slice(0, 90)}`;
const V = k => sql(`select t1.vid('${k}')`)[0][0];
const U = k => sql(`select t1.uid('${k}')`)[0][0];

async function begin(actor, kind, target, angle, bytes, mime = 'image/jpeg') {
  return api.rpc(actor, 'fm_photo_begin', { p_kind: kind, p_target: target, p_angle: angle, p_sha256: sha(bytes), p_size: bytes.length, p_mime: mime });
}
// reproduz finishStoredPhoto: info (usuario) -> download (usuario) -> hash no servidor -> attest(6, service) -> finalize(usuario)
async function finish(actor, id) {
  const info = await api.rpc(actor, 'fm_photo_info', { p_id: id });
  if (info.status >= 300) return { step: 'info', r: msg(info) };
  const j = info.body;
  if (j.state === 'linked' && j.kind === 'inspection') return { step: 'done', path: j.path };
  const dl = await api.download(actor, 'vehicle-photos', j.path);
  if (dl.status >= 300) return { step: 'download', r: `${dl.status}` };
  const h = sha(dl.bytes);
  if (dl.bytes.length !== j.size || h !== j.sha256) {
    // camada do servidor recusa; prova extra: o banco tambem recusa se o servidor atestasse o hash real
    const a = await api.rpc('service', 'fm_photo_attest', { p_id: j.id, p_actor: U(actor), p_sha256: h, p_size: dl.bytes.length, p_mime: j.mime, p_path: j.path });
    return { step: 'server_hash_mismatch', db_attest_with_real_hash: msg(a) };
  }
  const a = await api.rpc('service', 'fm_photo_attest', { p_id: j.id, p_actor: U(actor), p_sha256: h, p_size: j.size, p_mime: j.mime, p_path: j.path });
  if (a.status >= 300) return { step: 'attest', r: msg(a) };
  const f = await api.rpc(actor, 'fm_photo_finalize', { p_id: j.id, p_sha256: h });
  if (f.status >= 300) return { step: 'finalize', r: msg(f) };
  return { step: 'done', path: j.path };
}
const vehPhoto = v => sql(`select coalesce(photo_storage_path,'-') from vehicles where id='${v}'`)[0][0];

// ---------- fixture ----------
sql(`select t1.mkveh(k,u) from (values ('ph_sp','sp'),('ph_cp','cp'),('ph_sp_ins','sp'),('ph_conc','sp')) t(k,u) where not exists(select 1 from t1.v where t1.v.k=t.k)`);
const vsp = V('ph_sp'), vcp = V('ph_cp');

// P1 caminho feliz (foto de veiculo pela edicao da Frota)
const A = jpeg(4096, 'A'), B = jpeg(5000, 'B');
let bA = await begin('t1fmsp', 'vehicle', vsp, null, A);
rec('P1a', 'gestor SP fm_photo_begin (veiculo no escopo)', '200 + path', msg(bA), bA.status === 200, { path: bA.body?.path });
let up = await api.upload('t1fmsp', 'vehicle-photos', bA.body.path, A, 'image/jpeg');
rec('P1b', 'upload direto ao Storage no path retornado', '200', `${up.status}`, up.status === 200);
let fin = await finish('t1fmsp', bA.body.id);
rec('P1c', 'finalizacao (download+hash servidor, attest 6 args, finalize)', 'done + foto vinculada', JSON.stringify(fin), fin.step === 'done' && vehPhoto(vsp) === bA.body.path);
const aud = sql(`select count(*) from audit_log where entity_id='${vsp}' and action='photo.linked'`)[0][0];
rec('P1d', 'auditoria photo.linked', '1', aud, aud === '1');

// P2 assinatura antiga de atestacao fechada (0224)
let old5 = await api.rpc('service', 'fm_photo_attest', { p_id: bA.body.id, p_actor: U('t1fmsp'), p_sha256: sha(A), p_size: A.length, p_mime: 'image/jpeg' });
rec('P2a', 'service_role chama fm_photo_attest de 5 argumentos', 'negado (42501/PGRST)', msg(old5), old5.status >= 400);
let u6 = await api.rpc('t1fmsp', 'fm_photo_attest', { p_id: bA.body.id, p_actor: U('t1fmsp'), p_sha256: sha(A), p_size: A.length, p_mime: 'image/jpeg', p_path: bA.body.path });
rec('P2b', 'usuario autenticado chama fm_photo_attest de 6 argumentos', 'negado', msg(u6), u6.status >= 400);
let an6 = await api.rpc('anon', 'fm_photo_attest', { p_id: bA.body.id, p_actor: U('t1fmsp'), p_sha256: sha(A), p_size: A.length, p_mime: 'image/jpeg', p_path: bA.body.path });
rec('P2c', 'anon chama fm_photo_attest', 'negado', msg(an6), an6.status >= 400);
let lk = await api.rpc('t1fmsp', 'fm_photo_link', { p_id: bA.body.id, p_declared_sha256: sha(A) });
rec('P2d', 'usuario chama fm_photo_link diretamente', 'negado', msg(lk), lk.status >= 400);
const privs = sql(`select string_agg(r||'='||has_function_privilege(r,'public.fm_photo_attest(uuid,uuid,text,integer,text)','execute'),',') from unnest(array['anon','authenticated','service_role']) r`)[0][0];
rec('P2e', 'privilegio de execucao da assinatura antiga', 'todos false', privs, !/true/.test(privs));

// P3 A -> B -> A (mesmo gestor)
let bB = await begin('t1fmsp', 'vehicle', vsp, null, B);
await api.upload('t1fmsp', 'vehicle-photos', bB.body.path, B, 'image/jpeg');
fin = await finish('t1fmsp', bB.body.id);
rec('P3a', 'A -> B: foto B vinculada', 'path B', vehPhoto(vsp), vehPhoto(vsp) === bB.body.path);
let bA2 = await begin('t1fmsp', 'vehicle', vsp, null, A);
rec('P3b', 'B -> A: begin com o hash de A devolve a referencia antiga (linked, sem novo upload)', 'mesmo id/path, state linked', msg(bA2) + ' ' + JSON.stringify(bA2.body), bA2.body?.id === bA.body.id && bA2.body?.state === 'linked');
fin = await finish('t1fmsp', bA2.body.id);
rec('P3c', 'B -> A: finalizacao reaponta a foto para A', 'path A', vehPhoto(vsp) + ' ' + JSON.stringify(fin), vehPhoto(vsp) === bA.body.path);
const nUploads = sql(`select count(*) from fm_photo_uploads where target_id='${vsp}'`)[0][0];
rec('P3d', 'sem duplicar jornal (2 linhas: A e B)', '2', nUploads, nUploads === '2');
// A -> B -> A por OUTRO gestor com escopo (fmall reseleciona a foto A enviada por fmsp)
let bA3 = await begin('t1fmall', 'vehicle', vsp, null, A);
out.push({ id: 'P3e', desc: 'outro gestor (all units) reseleciona a foto A enviada por fmsp', expected: 'observacao', got: msg(bA3), result: 'INFO' });

// P4 inspecao: varias fotos por checklist; INSERT direto negado (0216)
sql(`select t1.mkres('ph_ins','t1drvok','ph_sp_ins','confirmed',now()-interval '10 minutes',now()+interval '2 hours'); update vehicles set status='reserved' where id=t1.vid('ph_sp_ins')`);
const rIns = sql(`select t1.rid('ph_ins')`)[0][0];
await api.rpc('t1drvok', 'fm_prepare_equipment_checklist', { p_reservation_id: rIns });
const pk = await api.rpc('t1drvok', 'record_pickup', { p_reservation_id: rIns, p_odometer_km: 10010, p_fuel_level_percent: 80, p_battery_level_percent: null, p_has_damage: false, p_damage_notes: null, p_missing_safety_equipment: [], p_is_dirty_exterior: false, p_is_dirty_interior: false, p_role: 'traveler' });
const insp = pk.body;
rec('P4a', 'condutor registra checklist (inspecao)', '200 + id', msg(pk), pk.status === 200);
const angles = sql(`select string_agg(x::text,',') from unnest(enum_range(null::photo_angle)) x`)[0][0].split(',');
let linked = 0;
for (const ang of angles.slice(0, 3)) {
  const img = jpeg(3000 + linked, 'I' + ang);
  const b = await begin('t1drvok', 'inspection', insp, ang, img);
  await api.upload('t1drvok', 'vehicle-photos', b.body.path, img, 'image/jpeg');
  const f = await finish('t1drvok', b.body.id); if (f.step === 'done') linked++;
}
const nIP = sql(`select count(*) from inspection_photos where inspection_id='${insp}'`)[0][0];
rec('P4b', `3 fotos (${angles.slice(0, 3).join('/')}) no mesmo checklist`, '3 vinculadas', `${linked} / inspection_photos=${nIP}`, linked === 3 && nIP === '3');
const fake = sql(`select storage_path from fm_photo_uploads where target_id='${insp}' limit 1`)[0][0];
for (const a of ['t1drvok', 't1fmsp', 't1admin', 't1sec']) {
  const r = await fetch(`${api.API}/rest/v1/inspection_photos`, { method: 'POST', headers: { ...(await api.headers(a)), 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ organization_id: '7a000000-0000-0000-0000-00000000000a', inspection_id: insp, angle: angles[4], storage_path: fake }) });
  const t = await r.text();
  rec('P4c', `INSERT direto em inspection_photos (${a})`, 'negado', `${r.status} ${t.slice(0, 80)}`, r.status >= 400);
}
const bOther = await begin('t1req2', 'inspection', insp, angles[5], jpeg(2000, 'X'));
rec('P4d', 'outro empregado inicia foto na inspecao alheia', 'NOT_AUTHORIZED', msg(bOther), bOther.status >= 400);

// P5 caminho errado / P6 proprietario errado / P7 metadados errados / P8 adulterado mesmo tamanho / P9 conta errada
const C = jpeg(4500, 'C');
let bC = await begin('t1fmsp', 'vehicle', vsp, null, C);
const wrongPath = bC.body.path.replace(/\.jpg$/, '_x.jpg');
await api.upload('t1fmsp', 'vehicle-photos', wrongPath, C, 'image/jpeg');
fin = await finish('t1fmsp', bC.body.id);
rec('P5a', 'objeto enviado a um caminho diferente do retornado', 'nao vincula (download falha)', JSON.stringify(fin), fin.step !== 'done');
let at = await api.rpc('service', 'fm_photo_attest', { p_id: bC.body.id, p_actor: U('t1fmsp'), p_sha256: sha(C), p_size: C.length, p_mime: 'image/jpeg', p_path: wrongPath });
rec('P5b', 'atestacao com p_path diferente do jornal', 'PHOTO_ATTEMPT_CHANGED', msg(at), /PHOTO_ATTEMPT_CHANGED/.test(msg(at)));
// P6: outro gestor no escopo sobe o objeto no caminho do jornal de fmsp
await api.upload('t1fmall', 'vehicle-photos', bC.body.path, C, 'image/jpeg');
fin = await finish('t1fmsp', bC.body.id);
rec('P6', 'objeto no caminho certo mas com proprietario diferente (fmall)', 'PHOTO_INTEGRITY_MISMATCH', JSON.stringify(fin), /INTEGRITY/.test(JSON.stringify(fin)));
// P7: metadados (mimetype) errados
const D = jpeg(4600, 'D');
let bD = await begin('t1fmsp', 'vehicle', vsp, null, D);
await api.upload('t1fmsp', 'vehicle-photos', bD.body.path, D, 'image/png');
fin = await finish('t1fmsp', bD.body.id);
rec('P7a', 'objeto com mimetype diferente do declarado (png x jpeg)', 'PHOTO_INTEGRITY_MISMATCH', JSON.stringify(fin), /INTEGRITY/.test(JSON.stringify(fin)));
const E = jpeg(4700, 'E');
let bE = await begin('t1fmsp', 'vehicle', vsp, null, E);
await api.upload('t1fmsp', 'vehicle-photos', bE.body.path, jpeg(4701, 'E'), 'image/jpeg');
fin = await finish('t1fmsp', bE.body.id);
rec('P7b', 'objeto com tamanho diferente do declarado', 'recusado', JSON.stringify(fin), fin.step !== 'done');
at = await api.rpc('service', 'fm_photo_attest', { p_id: bE.body.id, p_actor: U('t1fmsp'), p_sha256: sha(E), p_size: E.length, p_mime: 'image/jpeg', p_path: bE.body.path });
rec('P7c', 'banco: atestacao de objeto com tamanho divergente (mesmo se o servidor errasse)', 'PHOTO_INTEGRITY_MISMATCH', msg(at), /INTEGRITY/.test(msg(at)));
// P8: adulterado de mesmo tamanho
const F = jpeg(4800, 'F'); const Ft = jpeg(4800, 'T');
let bF = await begin('t1fmsp', 'vehicle', vsp, null, F);
await api.upload('t1fmsp', 'vehicle-photos', bF.body.path, Ft, 'image/jpeg');
fin = await finish('t1fmsp', bF.body.id);
rec('P8a', 'objeto adulterado de mesmo tamanho', 'recusado no hash do servidor e no banco', JSON.stringify(fin), fin.step === 'server_hash_mismatch' && /INTEGRITY|MISMATCH/.test(fin.db_attest_with_real_hash ?? ''));
const fz = await api.rpc('t1fmsp', 'fm_photo_finalize', { p_id: bF.body.id, p_sha256: sha(F) });
rec('P8b', 'finalize sem atestacao do servidor', 'PHOTO_SERVER_VERIFICATION_REQUIRED', msg(fz), /SERVER_VERIFICATION_REQUIRED/.test(msg(fz)));
const ow = await fetch(`${api.API}/storage/v1/object/vehicle-photos/${bF.body.path}`, { method: 'PUT', headers: { ...(await api.headers('t1fmsp')), 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: F });
rec('P8c', 'sobrescrever objeto ja enviado (PUT/upsert) para "consertar" o hash', 'negado', `${ow.status}`, ow.status >= 400);
// P9: conta errada
for (const a of ['t1fmall', 't1drvok', 't1adminb']) {
  const i1 = await api.rpc(a, 'fm_photo_info', { p_id: bF.body.id });
  const i2 = await api.rpc(a, 'fm_photo_finalize', { p_id: bF.body.id, p_sha256: sha(F) });
  const i3 = await api.rpc(a, 'fm_photo_restart', { p_id: bF.body.id });
  rec('P9a', `${a}: info/finalize/restart do jornal de outro usuario`, 'NOT_AUTHORIZED x3', [msg(i1), msg(i2), msg(i3)].join(' | '), [i1, i2, i3].every(r => r.status >= 400));
}
at = await api.rpc('service', 'fm_photo_attest', { p_id: bA.body.id, p_actor: U('t1fmall'), p_sha256: sha(A), p_size: A.length, p_mime: 'image/jpeg', p_path: bA.body.path });
rec('P9b', 'atestacao com p_actor diferente do autor', 'NOT_AUTHORIZED', msg(at), /NOT_AUTHORIZED/.test(msg(at)));
const bcp = await begin('t1fmsp', 'vehicle', vcp, null, jpeg(1000, 'Z'));
rec('P9c', 'gestor SP inicia foto em veiculo de Campinas', 'NOT_AUTHORIZED', msg(bcp), bcp.status >= 400);
const bdeact = await begin('t1deact', 'vehicle', vsp, null, jpeg(1000, 'Y'));
rec('P9d', 'conta desativada inicia foto', 'negado', msg(bdeact), bdeact.status >= 400);
const upAnon = await api.upload('anon', 'vehicle-photos', `7a000000-0000-0000-0000-00000000000a/vehicles/${vsp}_anon.jpg`, jpeg(100), 'image/jpeg');
rec('P9e', 'anon envia objeto ao bucket', 'negado', `${upAnon.status}`, upAnon.status >= 400);
const upB = await api.upload('t1adminb', 'vehicle-photos', `7a000000-0000-0000-0000-00000000000a/vehicles/${vsp}_${sha(A)}.jpg`, A, 'image/jpeg');
rec('P9f', 'admin Org B envia objeto na pasta da Org A', 'negado', `${upB.status} ${upB.body}`, upB.status >= 400);

// P10 pendencia recuperavel (0221): pendente listado, restart preserva o original, nova tentativa conclui
const G = jpeg(5100, 'G');
let bG = await begin('t1fmsp', 'vehicle', vsp, null, G);
await api.upload('t1fmsp', 'vehicle-photos', bG.body.path, jpeg(5100, 'W'), 'image/jpeg'); // tentativa com conteudo errado (queda/arquivo corrompido)
fin = await finish('t1fmsp', bG.body.id);
let pend = await api.rpc('t1fmsp', 'fm_photo_pending', {});
const isPending = Array.isArray(pend.body) && pend.body.some(x => x.id === bG.body.id);
rec('P10a', 'tentativa falha fica pendente e listada em fm_photo_pending', 'listada', `${fin.step} pend=${isPending}`, fin.step !== 'done' && isPending);
const otherPend = await api.rpc('t1fmall', 'fm_photo_pending', {});
rec('P10b', 'pendencia nao aparece para outro usuario', 'nao listada', `${Array.isArray(otherPend.body) ? otherPend.body.some(x => x.id === bG.body.id) : otherPend.status}`, Array.isArray(otherPend.body) && !otherPend.body.some(x => x.id === bG.body.id));
const rs = await api.rpc('t1fmsp', 'fm_photo_restart', { p_id: bG.body.id });
const info2 = await api.rpc('t1fmsp', 'fm_photo_info', { p_id: bG.body.id });
const hist = sql(`select count(*)||':'||string_agg(storage_path,',') from fm_photo_attempt_history where upload_id='${bG.body.id}'`)[0][0];
const origObj = sql(`select count(*) from storage.objects where bucket_id='vehicle-photos' and name='${bG.body.path}'`)[0][0];
rec('P10c', 'restart gera novo caminho, preserva caminho/objeto originais', 'novo path; historico 1; objeto original presente', `${msg(rs)} newpath=${info2.body?.path !== bG.body.path} hist=${hist.split(':')[0]} orig=${origObj}`, rs.status < 300 && info2.body?.path !== bG.body.path && hist.startsWith('1:') && origObj === '1');
await api.upload('t1fmsp', 'vehicle-photos', info2.body.path, G, 'image/jpeg');
fin = await finish('t1fmsp', bG.body.id);
rec('P10d', 'nova tentativa com o arquivo correto conclui', 'done', JSON.stringify(fin), fin.step === 'done' && vehPhoto(vsp) === info2.body.path);
const rsl = await api.rpc('t1fmsp', 'fm_photo_restart', { p_id: bG.body.id });
rec('P10e', 'restart de foto ja vinculada', 'PHOTO_ALREADY_LINKED', msg(rsl), /ALREADY_LINKED/.test(msg(rsl)));

// P11 restart concorrente a atestacao (2 sessoes psql reais)
function psql(script) { return new Promise(res => { const p = spawn('docker', ['exec', '-i', 'supabase_db_fleet-homolog', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t']); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); p.on('close', () => res({ out: o.trim(), err: e.trim() })); p.stdin.end(script); }); }
const vconc = V('ph_conc'); const fmsp = U('t1fmsp');
const agg = { iterations: 0, attest_first: 0, restart_first: 0, both_failed: 0, inconsistent: 0, dup_rows: 0, errors: {}, samples: [] };
for (let i = 0; i < ITER; i++) {
  const img = jpeg(2048, 'K' + i);
  const b = await begin('t1fmsp', 'vehicle', vconc, null, img);
  await api.upload('t1fmsp', 'vehicle-photos', b.body.path, img, 'image/jpeg');
  const [[T]] = sql(`select (clock_timestamp()+interval '1200 milliseconds')::text`);
  const wait = `select pg_sleep(greatest(0, extract(epoch from ('${T}'::timestamptz - clock_timestamp()))));\n`;
  const sAtt = `${wait}begin; set local role service_role; select fm_photo_attest('${b.body.id}','${fmsp}','${sha(img)}',${img.length},'image/jpeg','${b.body.path}'); commit;`;
  const sRst = `${wait}begin; select set_config('request.jwt.claims','${JSON.stringify({ sub: fmsp, role: 'authenticated' })}',true); set local role authenticated; select fm_photo_restart('${b.body.id}'); commit;`;
  const [ra, rr] = await Promise.all([psql(sAtt), psql(sRst)]);
  const ea = (ra.err.match(/ERROR:\s+([^\n]+)/) ?? [])[1], er = (rr.err.match(/ERROR:\s+([^\n]+)/) ?? [])[1];
  if (ea) agg.errors['attest: ' + ea] = (agg.errors['attest: ' + ea] ?? 0) + 1;
  if (er) agg.errors['restart: ' + er] = (agg.errors['restart: ' + er] ?? 0) + 1;
  const [[path, verified, nh, nrows]] = sql(`select storage_path, (server_verified_at is not null)::text, (select count(*) from fm_photo_attempt_history h where h.upload_id=u.id), (select count(*) from fm_photo_uploads x where x.target_id=u.target_id and x.sha256=u.sha256) from fm_photo_uploads u where id='${b.body.id}'`);
  const bad = [];
  if (nrows !== '1') { bad.push('linhas duplicadas no jornal'); agg.dup_rows++; }
  if (!er && nh !== '1') bad.push('restart ok sem historico');
  if (er && nh !== '0') bad.push('restart falhou mas gravou historico');
  if (!er && path === b.body.path) bad.push('restart ok mas caminho nao mudou');
  if (verified === 'true' && path !== b.body.path) bad.push('verificado com caminho diferente do atestado');
  if (!ea && !er) agg.attest_first++; else if (ea && !er) agg.restart_first++; else agg.both_failed++;
  // tentativa de finalizar apos a corrida: so pode vincular se o caminho atual foi verificado
  const f = await api.rpc('t1fmsp', 'fm_photo_finalize', { p_id: b.body.id, p_sha256: sha(img) });
  const [[st, linkedPath]] = sql(`select state, coalesce((select photo_storage_path from vehicles where id='${vconc}'),'-') from fm_photo_uploads where id='${b.body.id}'`);
  if (st === 'linked' && verified !== 'true') bad.push('vinculou sem verificacao');
  if (st === 'linked' && linkedPath !== path) bad.push('vinculou caminho diferente do jornal');
  if (bad.length) { agg.inconsistent++; if (agg.samples.length < 5) agg.samples.push({ i, ea, er, path_changed: path !== b.body.path, verified, nh, nrows, finalize: msg(f), st, bad }); }
  agg.iterations++;
}
rec('P11', `restart x atestacao concorrentes (${ITER} iteracoes, 2 sessoes)`, 'sem duplicar, sem perder, sem verificar caminho errado', JSON.stringify(agg), agg.inconsistent === 0 && agg.iterations === ITER);

// P12 arquivo grande 8,6 MB (limite 10 MB) direto ao Storage
const big = jpeg(Math.round(8.6 * 1024 * 1024), 'BIG');
let bBig = await begin('t1fmsp', 'vehicle', vsp, null, big);
up = await api.upload('t1fmsp', 'vehicle-photos', bBig.body.path, big, 'image/jpeg');
fin = await finish('t1fmsp', bBig.body.id);
rec('P12', 'foto de 8,6 MB: begin + upload direto + finalizacao', 'done', `${msg(bBig)} upload=${up.status} ${JSON.stringify(fin)}`, fin.step === 'done');
const tooBig = await api.rpc('t1fmsp', 'fm_photo_begin', { p_kind: 'vehicle', p_target: vsp, p_angle: null, p_sha256: sha(A).replace(/^./, '0'), p_size: 10485761, p_mime: 'image/jpeg' });
rec('P12b', 'begin com 10 MB + 1 byte', 'INVALID_PHOTO', msg(tooBig), tooBig.status >= 400);

console.log(JSON.stringify({ fails, total: out.filter(x => x.result !== 'INFO').length, out }, null, 1));
