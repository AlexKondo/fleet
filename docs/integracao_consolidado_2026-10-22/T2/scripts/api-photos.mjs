// T2 — Cenários 3/4/5 pela rota REAL /api/photos (app em :3100, sessão por cookie de login real) + Storage/GoTrue/PostgREST LOCAIS.
// Simula exatamente o que o navegador faz (directPhotoUpload.ts): begin (JSON) → upload direto ao Storage (sem upsert) → finish (JSON).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';
const FILE = 'api-photos.json';
const MiB = 1024 * 1024;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; const run = (id) => !ONLY || ONLY.includes(id);
const RES = Object.fromEntries(L.psql(`select k||'='||rid from t2.r`).split(String.fromCharCode(10)).map(l => l.split('=')));
const inspOf = (rid, type = 'pickup', role = 'traveler') => L.psql(`select id from inspections where reservation_id='${rid}' and type='${type}' and performed_by_role='${role}' order by created_at desc limit 1`);
const INS = inspOf(RES.sp1); // inspeção de retirada do t2sp (C01)
const VEH = L.vid('TDA1A04'), VEH_CAMP = L.vid('TDA2A01'), VEH_RIO = L.vid('TDA3A01');
const b = await L.chromium.launch({ headless: true });
const S = {}; for (const k of ['t2sp', 't2other', 'admin', 'fmall', 'fmcampinas', 'security', 't2orgb']) S[k] = await L.login(b, k);

async function begin(s, kind, target, angle, buf, mime = 'image/png') { return L.apiPhotos(s, { phase: 'begin', kind, target, angle, sha: L.sha(buf), size: buf.length, mime }); }
async function full(s, kind, target, angle, buf, mime = 'image/png') {
  const bg = await begin(s, kind, target, angle, buf, mime); if (bg.status !== 200) return { bg };
  const up = bg.body.state !== 'linked' ? await L.storageUpload(s.token, bg.body.path, buf, mime) : null;
  const fin = await L.apiPhotos(s, { phase: 'finish', id: bg.body.id });
  return { bg, up, fin, j: L.journal(`id='${bg.body.id}'`)[0] };
}
const short = (x) => JSON.stringify(x).slice(0, 300);

// ---------- A01–A03: guarda da rota ----------
if (run('A01')) {
  const buf = L.pngOfSize(1000);
  const csrf = await L.apiPhotos(S.admin, { phase: 'begin' }, { origin: 'http://evil.example' });
  const big = await L.apiPhotos(S.admin, JSON.stringify({ phase: 'begin', pad: 'x'.repeat(5000) }));
  const anon = await (await b.newContext()).request.post(L.BASE + '/api/photos', { headers: { 'content-type': 'application/json', origin: L.BASE }, data: JSON.stringify({ phase: 'finish', id: crypto.randomUUID() }), maxRedirects: 0 });
  const bad = await L.apiPhotos(S.admin, '{not json');
  L.rec(FILE, { id: 'A01', cenario: 'Rota /api/photos: origem diferente, corpo > 4096 B, sem sessão, JSON inválido', papel: 'admin / anônimo', esperado: '403 / 413 / 401 / 400', obtido: `origem=${csrf.status}; corpo grande=${big.status}; anônimo=${anon.status()} ${anon.headers()['location'] ?? ''}; json inválido=${bad.status}`, status: csrf.status === 403 && big.status === 413 && [401, 307].includes(anon.status()) && bad.status === 400 ? 'PASS' : 'FAIL', evidencia: {} });
}
// ---------- A02: tipos ----------
if (run('A02')) {
  const out = [];
  for (const mime of ['image/heic', 'text/html', 'application/pdf', 'image/gif', 'image/svg+xml']) { const r = await begin(S.admin, 'vehicle', VEH, null, Buffer.from('x'.repeat(2000)), mime); out.push(`${mime}→${r.status}`); }
  // HTML declarado como PNG: Storage aceita o objeto (content-type é do cliente), mas o servidor recusa na verificação (assinatura PNG)
  const html = Buffer.from('<html><script>alert(1)</script>' + ' '.repeat(3000) + '</html>');
  const f = await full(S.admin, 'vehicle', VEH, null, html, 'image/png');
  // PDF/HEIC direto no Storage (sem jornal) – o bucket aceita image/heic, recusa application/pdf/text/html?
  const pth = `${L.ORG}/vehicles/${VEH}_t2probe_${Date.now()}.heic`;
  const heicUp = await L.storageUpload(S.admin.token, pth, Buffer.alloc(500, 1), 'image/heic');
  const pdfUp = await L.storageUpload(S.admin.token, `${L.ORG}/vehicles/${VEH}_t2probe_${Date.now()}.pdf`, Buffer.from('%PDF-1.4 x'), 'application/pdf');
  const htmlUp = await L.storageUpload(S.admin.token, `${L.ORG}/vehicles/${VEH}_t2probe_${Date.now()}.html`, html, 'text/html');
  L.rec(FILE, { id: 'A02', cenario: 'Tipos: begin com HEIC/HTML/PDF/GIF/SVG; HTML disfarçado de PNG; uploads diretos ao bucket fora do jornal', papel: 'admin', esperado: 'begin 400 para não-JPEG/PNG/WEBP; HTML-como-PNG recusado na verificação do servidor (sem vínculo); bucket recusa PDF/HTML', obtido: `${out.join(' ')}; HTML-como-PNG: upload=${f.up?.status} finish=${f.fin?.status} ${short(f.fin?.body)} jornal=${f.j?.state}/${f.j?.verified ? 'verificado' : 'não verificado'}; bucket: heic=${heicUp.status} pdf=${pdfUp.status} html=${htmlUp.status}`, status: out.every(x => x.endsWith('400')) && f.fin?.status === 409 && f.j?.state === 'pending' && !f.j?.verified && pdfUp.status >= 400 && htmlUp.status >= 400 ? 'PASS' : 'FAIL', evidencia: { f, heicUp, pdfUp, htmlUp, orphanHeic: heicUp.status === 200 ? pth : null } });
}
// ---------- A03: tamanhos + tempo/memória do servidor na verificação ----------
function serverPid() { const p = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 3100 -State Listen | Select-Object -First 1).OwningProcess']); return p.stdout.toString().trim(); }
function rss(pid) { const p = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`]); return Number(p.stdout.toString().trim()); }
if (run('A03')) {
  const rows = [];
  for (const size of [3 * MiB, Math.round(4.5 * MiB), Math.round(8.6 * MiB), 10 * MiB]) {
    const buf = L.pngOfSize(size); const r = await full(S.admin, 'vehicle', VEH, null, buf);
    rows.push({ MiB: (size / MiB).toFixed(1), begin: r.bg.status, upload: r.up?.status, finish: r.fin?.status, finishMs: r.fin?.ms, linked: r.j?.state, verified: r.j?.verified });
  }
  const over = L.pngOfSize(10 * MiB + 1); const bo = await begin(S.admin, 'vehicle', VEH, null, over);
  const so = await L.storageUpload(S.admin.token, `${L.ORG}/vehicles/${VEH}_t2over_${Date.now()}.png`, over, 'image/png');
  L.rec(FILE, { id: 'A03', cenario: 'Tamanhos 3 / 4,5 / 8,6 / 10 MiB e 10 MiB+1 (begin e Storage direto)', papel: 'admin', esperado: 'até 10 MiB linked+verificado sem 5xx; 10 MiB+1: begin 400 e bucket recusa', obtido: rows.map(r => `${r.MiB}MiB: ${r.begin}/${r.upload}/${r.finish} finish=${r.finishMs}ms ${r.linked}${r.verified ? '+v' : ''}`).join('; ') + `; +1B: begin=${bo.status} storage=${so.status}`, status: rows.every(r => r.finish === 200 && r.linked === 'linked') && bo.status === 400 && so.status >= 400 ? 'PASS' : 'FAIL', evidencia: rows });
  // memória/tempo: 5 verificações concorrentes de 10 MiB (inspeção do t2sp, ângulos distintos)
  const pid = serverPid(); const base = rss(pid); let peak = base; let sampling = true;
  const sampler = (async () => { while (sampling) { peak = Math.max(peak, rss(pid)); await new Promise(r => setTimeout(r, 150)); } })();
  const bufs = Array.from({ length: 5 }, () => L.pngOfSize(10 * MiB));
  const begun = []; for (const buf of bufs) { const bg = await begin(S.t2sp, 'inspection', INS, 'interior', buf); await L.storageUpload(S.t2sp.token, bg.body.path, buf, 'image/png'); begun.push(bg.body.id); }
  const t0 = Date.now(); const fins = await Promise.all(begun.map(id => L.apiPhotos(S.t2sp, { phase: 'finish', id })));
  const wall = Date.now() - t0; sampling = false; await sampler;
  L.rec(FILE, { id: 'A03m', cenario: 'Memória/tempo do servidor (next dev local) em 5 verificações concorrentes de 10 MiB (download + SHA-256)', papel: 't2sp', esperado: 'todas 200; medir pico de memória e tempo', obtido: `status=${fins.map(f => f.status).join(',')}; tempos=${fins.map(f => f.ms).join(',')}ms; parede=${wall}ms; RSS base=${(base / MiB).toFixed(0)}MiB pico=${(peak / MiB).toFixed(0)}MiB (Δ≈${((peak - base) / MiB).toFixed(0)}MiB)`, status: fins.every(f => f.status === 200) ? 'PASS' : 'FAIL', evidencia: { pid, base, peak, fins } });
}
// ---------- A04: 409 mesmo conteúdo / retry com a mesma identidade ----------
if (run('A04')) {
  const buf = L.pngOfSize(120_000);
  const b1 = await begin(S.t2sp, 'inspection', INS, 'wheels', buf); const b2 = await begin(S.t2sp, 'inspection', INS, 'wheels', buf);
  const u1 = await L.storageUpload(S.t2sp.token, b1.body.path, buf, 'image/png'); const u2 = await L.storageUpload(S.t2sp.token, b1.body.path, buf, 'image/png');
  const f1 = await L.apiPhotos(S.t2sp, { phase: 'finish', id: b1.body.id }); const f2 = await L.apiPhotos(S.t2sp, { phase: 'finish', id: b1.body.id });
  const n = L.psql(`select count(*) from inspection_photos where storage_path='${b1.body.path}'`);
  const b3 = await begin(S.t2sp, 'inspection', INS, 'wheels', buf);
  L.rec(FILE, { id: 'A04', cenario: 'Retry com a mesma identidade: begin 2×, upload 2× (2º = 409), finish 2×, begin após vínculo', papel: 't2sp', esperado: 'mesmo id/caminho; 2º upload recusado (sem sobrescrever); 1 único vínculo; begin posterior devolve linked', obtido: `mesmo id=${b1.body.id === b2.body.id}; uploads=${u1.status}/${u2.status} ${u2.body.slice(0, 60)}; finish=${f1.status}/${f2.status}; vínculos=${n}; begin pós=${b3.body.state}`, status: b1.body.id === b2.body.id && u1.status === 200 && u2.status >= 400 && f1.status === 200 && f2.status === 200 && n === '1' && b3.body.state === 'linked' ? 'PASS' : 'FAIL', evidencia: {} });
}
// ---------- A05: conteúdo diferente / adulterado de mesmo tamanho + recuperação por restart ----------
if (run('A05')) {
  const orig = L.pngOfSize(200_000); const fake = Buffer.from(orig); fake[150_000] ^= 0xff; // mesmo tamanho, 1 byte diferente, assinatura PNG intacta
  const bg = await begin(S.t2sp, 'inspection', INS, 'left_side', orig);
  const up = await L.storageUpload(S.t2sp.token, bg.body.path, fake, 'image/png');
  const fin = await L.apiPhotos(S.t2sp, { phase: 'finish', id: bg.body.id });
  const j1 = L.journal(`id='${bg.body.id}'`)[0];
  const upOrig = await L.storageUpload(S.t2sp.token, bg.body.path, orig, 'image/png');
  const fin2 = await L.apiPhotos(S.t2sp, { phase: 'finish', id: bg.body.id });
  const rs = await L.rpc(S.t2sp.token, 'fm_photo_restart', { p_id: bg.body.id });
  const j2 = L.journal(`id='${bg.body.id}'`)[0];
  const up3 = await L.storageUpload(S.t2sp.token, j2.path, orig, 'image/png');
  const fin3 = await L.apiPhotos(S.t2sp, { phase: 'finish', id: bg.body.id });
  const j3 = L.journal(`id='${bg.body.id}'`)[0]; const fakeObj = L.objects(bg.body.path); const fakeGet = await L.storageGet(S.t2sp.token, bg.body.path);
  const linkedPath = L.psql(`select coalesce(string_agg(storage_path,','),'') from inspection_photos where storage_path in ('${bg.body.path}','${j2.path}')`);
  L.rec(FILE, { id: 'A05', cenario: 'Arquivo ADULTERADO de mesmo tamanho no caminho do jornal → recusa; reenvio do original bloqueado (409); restart → novo caminho → original vinculado', papel: 't2sp', esperado: 'finish 409 sem atestar; objeto adulterado preservado e NUNCA vinculado; após restart, original vinculado no novo caminho', obtido: `upload adulterado=${up.status}; finish=${fin.status} jornal=${j1.state}/${j1.verified ? 'v' : 'não v'}; reenvio original=${upOrig.status}; finish=${fin2.status}; restart=${rs.status}; novo upload=${up3.status}; finish=${fin3.status}; final=${j3.state}+${j3.verified ? 'v' : '-'}; vinculado=${linkedPath === j2.path}; adulterado preservado=${fakeObj.length === 1 && fakeGet.sha === L.sha(fake)}`, status: fin.status === 409 && !j1.verified && upOrig.status >= 400 && fin2.status === 409 && rs.status < 300 && fin3.status === 200 && j3.state === 'linked' && linkedPath === j2.path ? 'PASS' : 'FAIL', evidencia: { j1, j2, j3 } });
}
// ---------- A06: metadados/owner/caminho errados ----------
if (run('A06')) {
  // (a) mimetype errado no objeto (bytes PNG, content-type image/jpeg)
  const a = L.pngOfSize(90_000); const bga = await begin(S.admin, 'vehicle', VEH_CAMP, null, a);
  const upa = await L.storageUpload(S.admin.token, bga.body.path, a, 'image/jpeg'); const fa = await L.apiPhotos(S.admin, { phase: 'finish', id: bga.body.id }); const ja = L.journal(`id='${bga.body.id}'`)[0];
  // (b) owner errado: outro gestor (fmall) ocupa o caminho do admin com os MESMOS bytes antes dele
  const bb = L.pngOfSize(91_000); const bgb = await begin(S.admin, 'vehicle', VEH_CAMP, null, bb);
  const squat = await L.storageUpload(S.fmall.token, bgb.body.path, bb, 'image/png');
  const own = await L.storageUpload(S.admin.token, bgb.body.path, bb, 'image/png'); const fb = await L.apiPhotos(S.admin, { phase: 'finish', id: bgb.body.id }); const jb = L.journal(`id='${bgb.body.id}'`)[0];
  const fbOther = await L.apiPhotos(S.fmall, { phase: 'finish', id: bgb.body.id });
  // (c) caminho errado: cliente envia para outro nome; finish procura o caminho do jornal
  const c = L.pngOfSize(92_000); const bgc = await begin(S.admin, 'vehicle', VEH_CAMP, null, c);
  const upc = await L.storageUpload(S.admin.token, `${L.ORG}/vehicles/${VEH_CAMP}_outro_${L.sha(c)}.png`, c, 'image/png'); const fc = await L.apiPhotos(S.admin, { phase: 'finish', id: bgc.body.id }); const jc = L.journal(`id='${bgc.body.id}'`)[0];
  const veh = L.psql(`select photo_storage_path from vehicles where id='${VEH_CAMP}'`);
  const linkedAny = [bga.body.path, bgb.body.path, bgc.body.path].includes(veh);
  L.rec(FILE, { id: 'A06', cenario: 'Metadados errados (mimetype), owner errado (caminho ocupado por outro gestor), caminho errado', papel: 'admin + fmall', esperado: 'nenhum vínculo; finish 409; jornal pending não verificado; finish por outra conta negado', obtido: `(a) upload=${upa.status} finish=${fa.status} ${ja.state}/${ja.verified ? 'v' : '-'}; (b) ocupação por fmall=${squat.status} admin=${own.status} finish=${fb.status} ${jb.state}/${jb.verified ? 'v' : '-'} finish por fmall=${fbOther.status}; (c) upload outro nome=${upc.status} finish=${fc.status} (${fc.ms}ms) ${jc.state}; veículo aponta p/ algum=${linkedAny}`, status: fa.status === 409 && !ja.verified && fb.status === 409 && !jb.verified && fc.status === 409 && !linkedAny && fbOther.status >= 400 ? 'PASS' : 'FAIL', evidencia: { squat, own } });
  L.rec(FILE, { id: 'A06b', cenario: 'Ocupação do caminho por outro gestor com escopo (bloqueio da pendência alheia)', papel: 'fmall vs admin', esperado: 'Storage não deveria permitir que outra conta crie o objeto no caminho do jornal de outra pessoa', obtido: `upload de fmall no caminho do jornal do admin=${squat.status}; consequência: pendência do admin fica bloqueada até "nova tentativa" (restart)`, status: squat.status === 200 ? 'FAIL' : 'PASS', evidencia: {} });
}
// ---------- A07: A → B → A (referência antiga selecionável) ----------
if (run('A07')) {
  const A = L.pngOfSize(150_000), B = L.pngOfSize(160_000);
  const ra = await full(S.fmall, 'vehicle', VEH, null, A); const p1 = L.psql(`select photo_storage_path from vehicles where id='${VEH}'`);
  const rb = await full(S.fmall, 'vehicle', VEH, null, B); const p2 = L.psql(`select photo_storage_path from vehicles where id='${VEH}'`);
  const ra2 = await full(S.fmall, 'vehicle', VEH, null, A); const p3 = L.psql(`select photo_storage_path from vehicles where id='${VEH}'`);
  const audits = L.psql(`select count(*) from audit_log where action='photo.linked' and entity_id='${VEH}' and (after->>'upload_id')='${ra.bg.body.id}'`);
  const objsA = L.objects(ra.bg.body.path).length, objsB = L.objects(rb.bg.body.path).length;
  L.rec(FILE, { id: 'A07', cenario: 'A → B → A na foto do veículo', papel: 'fmall', esperado: 'veículo aponta A, depois B, depois A de novo (sem novo upload: begin devolve linked); objetos A e B preservados; auditoria de cada vínculo', obtido: `p1=A:${p1 === ra.bg.body.path} p2=B:${p2 === rb.bg.body.path} p3=A:${p3 === ra.bg.body.path}; 2º A begin=${ra2.bg.body.state} upload=${ra2.up ? ra2.up.status : 'pulado'} finish=${ra2.fin.status}; objetos A=${objsA} B=${objsB}; auditorias A=${audits}`, status: p1 === ra.bg.body.path && p2 === rb.bg.body.path && p3 === ra.bg.body.path && objsA === 1 && objsB === 1 ? 'PASS' : 'FAIL', evidencia: {} });
}
// ---------- A08: restart concorrente à atestação (duas abas) ----------
if (run('A08')) {
  const outcomes = [];
  for (let i = 0; i < 6; i++) {
    const buf = L.pngOfSize(10 * MiB); const bg = await begin(S.t2sp, 'inspection', INS, 'right_side', buf); await L.storageUpload(S.t2sp.token, bg.body.path, buf, 'image/png');
    const delay = [0, 30, 80, 150, 300, 600][i];
    const [fin, rs] = await Promise.all([L.apiPhotos(S.t2sp, { phase: 'finish', id: bg.body.id }), new Promise(r => setTimeout(r, delay)).then(() => L.rpc(S.t2sp.token, 'fm_photo_restart', { p_id: bg.body.id }))]);
    const j = L.journal(`id='${bg.body.id}'`)[0]; const linked = L.psql(`select coalesce(string_agg(storage_path,','),'') from inspection_photos where storage_path like '%${L.sha(buf)}%'`);
    const consistent = j.state === 'linked' ? (linked === j.path && L.objects(j.path).length === 1) : (linked === '' && !j.verified);
    outcomes.push({ delay, finish: fin.status, restart: rs.status, restartErr: rs.body?.message, state: j.state, verified: j.verified, pathChanged: j.path !== bg.body.path, linked: linked ? (linked === bg.body.path ? 'caminho original' : 'novo caminho') : 'nenhum', consistent });
  }
  // determinístico: atestação com caminho antigo depois de restart (o que o servidor faria se tivesse baixado antes do restart)
  const buf = L.pngOfSize(50_000); const bg = await begin(S.t2sp, 'inspection', INS, 'right_side', buf); await L.storageUpload(S.t2sp.token, bg.body.path, buf, 'image/png');
  await L.rpc(S.t2sp.token, 'fm_photo_restart', { p_id: bg.body.id });
  const att = await fetch(`${L.API}/rest/v1/rpc/fm_photo_attest`, { method: 'POST', headers: { apikey: L.SERVICE, authorization: 'Bearer ' + L.SERVICE, 'content-type': 'application/json' }, body: JSON.stringify({ p_id: bg.body.id, p_actor: S.t2sp.uid, p_sha256: L.sha(buf), p_size: buf.length, p_mime: 'image/png', p_path: bg.body.path }) });
  const attBody = await att.json().catch(() => null);
  L.rec(FILE, { id: 'A08', cenario: 'Restart concorrente à atestação (2 abas: finish de 10 MiB × fm_photo_restart com atrasos 0–600 ms) + caso determinístico', papel: 't2sp', esperado: 'nunca vincular caminho não verificado; estado final consistente; atestação do caminho antigo após restart = PHOTO_ATTEMPT_CHANGED', obtido: outcomes.map(o => `d${o.delay}:fin${o.finish}/rs${o.restart} ${o.state}${o.verified ? '+v' : ''} vínculo=${o.linked} ok=${o.consistent}`).join('; ') + ` | determinístico: ${att.status} ${attBody?.message}`, status: outcomes.every(o => o.consistent) && /PHOTO_ATTEMPT_CHANGED/.test(attBody?.message ?? '') ? 'PASS' : 'FAIL', evidencia: outcomes });
}
// ---------- A09: queda após atestação e antes da finalização ----------
if (run('A09')) {
  const buf = L.pngOfSize(300_000); const bg = await begin(S.t2sp, 'inspection', INS, 'front', buf); await L.storageUpload(S.t2sp.token, bg.body.path, buf, 'image/png');
  // o servidor atesta (service_role, 6 argumentos) e "cai" antes de fm_photo_finalize
  const att = await fetch(`${L.API}/rest/v1/rpc/fm_photo_attest`, { method: 'POST', headers: { apikey: L.SERVICE, authorization: 'Bearer ' + L.SERVICE, 'content-type': 'application/json' }, body: JSON.stringify({ p_id: bg.body.id, p_actor: S.t2sp.uid, p_sha256: L.sha(buf), p_size: buf.length, p_mime: 'image/png', p_path: bg.body.path }) });
  const j1 = L.journal(`id='${bg.body.id}'`)[0];
  const pend = await L.rpc(S.t2sp.token, 'fm_photo_pending', {}); const listed = (pend.body ?? []).some(p => p.id === bg.body.id);
  const fin = await L.apiPhotos(S.t2sp, { phase: 'finish', id: bg.body.id }); const j2 = L.journal(`id='${bg.body.id}'`)[0];
  const n = L.psql(`select count(*) from inspection_photos where storage_path='${bg.body.path}'`);
  L.rec(FILE, { id: 'A09', cenario: 'Queda após a atestação e antes da finalização/vínculo; retomada pelo finish', papel: 't2sp', esperado: 'pendente+verificado, listado em fm_photo_pending; finish conclui 1 vínculo', obtido: `atestação=${att.status}; estado=${j1.state}/${j1.verified ? 'v' : '-'}; listado=${listed}; finish=${fin.status}; final=${j2.state}; vínculos=${n}`, status: att.status < 300 && j1.state === 'pending' && j1.verified && listed && fin.status === 200 && j2.state === 'linked' && n === '1' ? 'PASS' : 'FAIL', evidencia: {} });
}
// ---------- A10: sessão expirada/revogada e conta errada/desativada/outra organização ----------
function jwt(payload) { const env = Object.fromEntries(fs.readFileSync(L.SCR + '/env.txt', 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; })); const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'); const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${h}.${p}.${crypto.createHmac('sha256', env.JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`; }
if (run('A10')) {
  const buf = L.pngOfSize(80_000);
  const exp = jwt({ sub: S.t2sp.uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) - 60, iat: Math.floor(Date.now() / 1000) - 3600 });
  const bg = await begin(S.t2sp, 'inspection', INS, 'back', buf);
  const upExp = await L.storageUpload(exp, bg.body.path, buf, 'image/png');
  // sessão revogada (logout no GoTrue) e cookie antigo reaproveitado
  const s2 = await L.login(b, 't2sp'); const cookies = await s2.ctx.cookies();
  await fetch(`${L.API}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: L.ANON, authorization: 'Bearer ' + s2.token } });
  const finRevoked = await L.apiPhotos(s2, { phase: 'finish', id: bg.body.id });
  const upRevoked = await L.storageUpload(s2.token, bg.body.path, buf, 'image/png');
  const jAfter = L.journal(`id='${bg.body.id}'`)[0];
  L.rec(FILE, { id: 'A10', cenario: 'Sessão expirada (JWT vencido) e sessão revogada (logout) com cookie antigo', papel: 't2sp', esperado: 'Storage recusa JWT vencido; /api/photos recusa sessão revogada (401); nada vinculado', obtido: `upload JWT vencido=${upExp.status}; finish sessão revogada=${finRevoked.status} ${finRevoked.location ?? short(finRevoked.body)}; upload token revogado (ainda não expirado)=${upRevoked.status}; jornal=${jAfter.state}`, status: upExp.status >= 400 && [401, 307].includes(finRevoked.status) && jAfter.state === 'pending' ? 'PASS' : 'FAIL', evidencia: { upRevoked } });
  if (upRevoked.status === 200) L.rec(FILE, { id: 'A10b', cenario: 'Token de sessão revogada continua aceito pelo Storage até expirar', papel: 't2sp', esperado: 'observação: comportamento padrão do Supabase (JWT sem estado); o vínculo continua exigindo sessão válida', obtido: `upload=${upRevoked.status}; o objeto só é vinculado após finish com sessão válida`, status: 'OBS', evidencia: {} });
  // conta errada
  const other = await begin(S.t2other, 'inspection', INS, 'back', buf);
  const otherFin = await L.apiPhotos(S.t2other, { phase: 'finish', id: bg.body.id });
  const otherUp = await L.storageUpload(S.t2other.token, `${L.ORG}/${INS}/back_${'0'.repeat(64)}.png`, buf, 'image/png');
  const otherPend = await L.rpc(S.t2other.token, 'fm_photo_pending', {}); const otherRestart = await L.rpc(S.t2other.token, 'fm_photo_restart', { p_id: bg.body.id });
  const orgbBegin = await begin(S.t2orgb, 'vehicle', VEH, null, buf); const orgbUp = await L.storageUpload(S.t2orgb.token, `${L.ORG}/vehicles/${VEH}_${'1'.repeat(64)}.png`, buf, 'image/png');
  const outScope = await begin(S.fmcampinas, 'vehicle', VEH_RIO, null, buf); const outScopeUp = await L.storageUpload(S.fmcampinas.token, `${L.ORG}/vehicles/${VEH_RIO}_${'2'.repeat(64)}.png`, buf, 'image/png');
  const emp = await begin(S.t2other, 'vehicle', VEH, null, buf);
  L.rec(FILE, { id: 'A11', cenario: 'Conta errada: outro colaborador na inspeção alheia; outra organização; gestor limitado fora do escopo (Rio); colaborador na foto de veículo', papel: 't2other / t2orgb / fmcampinas', esperado: 'begin 403; finish do id alheio negado; Storage RLS nega; pendências alheias invisíveis; restart alheio negado', obtido: `outro begin=${other.status} finish id alheio=${otherFin.status} upload=${otherUp.status} pendências vistas=${(otherPend.body ?? []).length} restart=${otherRestart.status}; orgB begin=${orgbBegin.status} upload=${orgbUp.status}; fmcampinas→Rio begin=${outScope.status} upload=${outScopeUp.status}; colaborador→veículo begin=${emp.status}`, status: other.status === 403 && otherFin.status >= 400 && otherUp.status >= 400 && (otherPend.body ?? []).length === 0 && otherRestart.status >= 400 && orgbBegin.status === 403 && orgbUp.status >= 400 && outScope.status === 403 && outScopeUp.status >= 400 && emp.status === 403 ? 'PASS' : 'FAIL', evidencia: {} });
  L.rec(FILE, { id: 'A11b', cenario: 'Código HTTP do finish de upload alheio/inexistente', papel: 't2other', esperado: '403 (não autorizado)', obtido: `finish id alheio=${otherFin.status} ${short(otherFin.body)}`, status: otherFin.status === 403 ? 'PASS' : 'OBS', evidencia: {} });
  // conta desativada
  L.psql(`insert into fm_member_access(user_id,organization_id,enabled,version,reason,updated_by) values ('${S.t2other.uid}','${L.ORG}',false,1,'T2 teste conta desativada','16ddf868-9ee5-4447-930f-9801538eaa6a') on conflict (user_id) do update set enabled=false`);
  const dis = await L.apiPhotos(S.t2other, { phase: 'begin', kind: 'vehicle', target: VEH, angle: null, sha: L.sha(buf), size: buf.length, mime: 'image/png' });
  const disUp = await L.storageUpload(S.t2other.token, `${L.ORG}/${INS}/back_${'3'.repeat(64)}.png`, buf, 'image/png');
  L.psql(`update fm_member_access set enabled=true where user_id='${S.t2other.uid}'`);
  L.rec(FILE, { id: 'A12', cenario: 'Conta desativada', papel: 't2other', esperado: 'rota nega (401/403); Storage nega', obtido: `begin=${dis.status}; upload=${disUp.status}`, status: [401, 403].includes(dis.status) && disUp.status >= 400 ? 'PASS' : 'FAIL', evidencia: {} });
}
// ---------- A13: original preservado (UPDATE/DELETE negados) ----------
if (run('A13')) {
  const path = L.psql(`select storage_path from inspection_photos where inspection_id='${INS}' order by created_at limit 1`);
  const before = L.objects(path)[0]; const g0 = await L.storageGet(S.t2sp.token, path);
  const other = L.pngOfSize(Number(before.size));
  const ups = await L.storageUpload(S.t2sp.token, path, other, 'image/png', { upsert: true });
  const put = await L.storageUpload(S.t2sp.token, path, other, 'image/png', { method: 'PUT' });
  const del = await L.storageDelete(S.t2sp.token, path); const delAdmin = await L.storageDelete(S.admin.token, path);
  const g1 = await L.storageGet(S.t2sp.token, path); const after = L.objects(path)[0];
  const sqlTry = (uid, stmt) => L.psql(`begin; select set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true); set local role authenticated; do $t$ begin ${stmt}; raise notice 'R OK'; exception when others then raise notice 'R ERR %', sqlerrm; end $t$; rollback;`).match(/R (OK|ERR[^\n]*)/)?.[1] ?? '?';
  const r1 = L.psql(`begin; select set_config('request.jwt.claims', json_build_object('sub','${S.t2sp.uid}','role','authenticated')::text, true); set local role authenticated; with d as (delete from inspection_photos where inspection_id='${INS}' returning 1) select 'apagadas='||count(*) from d; rollback;`).split(String.fromCharCode(10)).find(l => l.startsWith('apagadas')) ?? 'ERR';
  const r2 = sqlTry(S.t2sp.uid, `update fm_photo_uploads set storage_path='x' where target_id='${INS}'`);
  const r3 = sqlTry(S.t2sp.uid, `insert into inspection_photos(organization_id,inspection_id,angle,storage_path) values('${L.ORG}','${INS}','front','${path}')`);
  const r4 = sqlTry(S.admin.uid, `delete from storage.objects where name='${path}'`);
  const cnt = L.psql(`select count(*) from inspection_photos where inspection_id='${INS}'`);
  const r5 = L.psql(`begin; do $t$ begin delete from fm_photo_attempt_history; raise notice 'R OK'; exception when others then raise notice 'R ERR %', sqlerrm; end $t$; rollback;`);
  L.rec(FILE, { id: 'A13', cenario: 'Original preservado: upsert, PUT (update), DELETE no Storage (dono e admin); DELETE/UPDATE/INSERT diretos nas tabelas', papel: 't2sp / admin', esperado: 'todos negados; bytes e metadados inalterados', obtido: `upsert=${ups.status} put=${put.status} delete dono=${del.status} ${del.body.slice(0, 40)} delete admin=${delAdmin.status} ${delAdmin.body.slice(0, 40)}; sha igual=${g0.sha === g1.sha} updated_at igual=${before.updated_at === after.updated_at}; SQL: delete fotos=${r1.slice(0, 60)}; update jornal=${r2.slice(0, 60)}; insert direto=${r3.slice(0, 60)}; delete storage.objects=${r4.slice(0, 60)}; histórico (postgres) ${(r5.match(/R (OK|ERR[^\n]*)/)?.[1] ?? '').slice(0, 60)}; linhas=${cnt}`, status: ups.status >= 400 && put.status >= 400 && g0.sha === g1.sha && before.updated_at === after.updated_at && /ERR/.test(r3) && /apagadas=0|ERR/.test(r1) ? 'PASS' : 'FAIL', evidencia: { del, delAdmin, r1, r2, r4 } });
}
// ---------- A14: pendência recuperável (fm_photo_pending / restart em linked) ----------
if (run('A14')) {
  const buf = L.pngOfSize(70_000); const bg = await begin(S.fmcampinas, 'vehicle', VEH_CAMP, null, buf);
  const p1 = await L.rpc(S.fmcampinas.token, 'fm_photo_pending', {}); const pAdmin = await L.rpc(S.admin.token, 'fm_photo_pending', {});
  await L.storageUpload(S.fmcampinas.token, bg.body.path, buf, 'image/png'); const fin = await L.apiPhotos(S.fmcampinas, { phase: 'finish', id: bg.body.id });
  const rsLinked = await L.rpc(S.fmcampinas.token, 'fm_photo_restart', { p_id: bg.body.id });
  // escopo removido depois do begin: a pendência deixa de ser listada/finalizável
  const buf2 = L.pngOfSize(71_000); const bg2 = await begin(S.fmcampinas, 'vehicle', VEH_CAMP, null, buf2); await L.storageUpload(S.fmcampinas.token, bg2.body.path, buf2, 'image/png');
  L.psql(`update fm_manager_scope_units set enabled=false where user_id='${S.fmcampinas.uid}' and unit_id='d1000000-0000-0000-0000-000000000002'`);
  const pOut = await L.rpc(S.fmcampinas.token, 'fm_photo_pending', {}); const finOut = await L.apiPhotos(S.fmcampinas, { phase: 'finish', id: bg2.body.id });
  L.psql(`update fm_manager_scope_units set enabled=true where user_id='${S.fmcampinas.uid}' and unit_id='d1000000-0000-0000-0000-000000000002'`);
  const pBack = await L.rpc(S.fmcampinas.token, 'fm_photo_pending', {}); const finBack = await L.apiPhotos(S.fmcampinas, { phase: 'finish', id: bg2.body.id });
  L.rec(FILE, { id: 'A14', cenario: 'fm_photo_pending: só as próprias pendências; restart em foto vinculada; perda/retorno de escopo', papel: 'fmcampinas / admin', esperado: 'pendência listada só para o autor; restart em linked negado; sem escopo: não lista e não finaliza; com escopo de volta: conclui', obtido: `autor vê=${(p1.body ?? []).some(x => x.id === bg.body.id)} admin vê=${(pAdmin.body ?? []).some(x => x.id === bg.body.id)}; finish=${fin.status}; restart linked=${rsLinked.status} ${rsLinked.body?.message}; sem escopo lista=${(pOut.body ?? []).some(x => x.id === bg2.body.id)} finish=${finOut.status}; escopo de volta lista=${(pBack.body ?? []).some(x => x.id === bg2.body.id)} finish=${finBack.status}`, status: (p1.body ?? []).some(x => x.id === bg.body.id) && !(pAdmin.body ?? []).some(x => x.id === bg.body.id) && fin.status === 200 && rsLinked.status >= 400 && !(pOut.body ?? []).some(x => x.id === bg2.body.id) && finOut.status >= 400 && finBack.status === 200 ? 'PASS' : 'FAIL', evidencia: {} });
}
// ---------- A15: contrato (CONTRACT 0224/0227) e escritores antigos ----------
if (run('A15')) {
  const buf = L.pngOfSize(60_000); const bg = await begin(S.t2sp, 'inspection', INS, 'wheels', buf); await L.storageUpload(S.t2sp.token, bg.body.path, buf, 'image/png');
  const old5 = await fetch(`${L.API}/rest/v1/rpc/fm_photo_attest`, { method: 'POST', headers: { apikey: L.SERVICE, authorization: 'Bearer ' + L.SERVICE, 'content-type': 'application/json' }, body: JSON.stringify({ p_id: bg.body.id, p_actor: S.t2sp.uid, p_sha256: L.sha(buf), p_size: buf.length, p_mime: 'image/png' }) });
  const old5b = await old5.json().catch(() => null);
  const fin0aa = await L.rpc(S.t2sp.token, 'fm_photo_finalize', { p_id: bg.body.id, p_sha256: L.sha(buf) }); // escritor 0aa2403: finaliza sem atestar
  const userAttest = await L.rpc(S.t2sp.token, 'fm_photo_attest', { p_id: bg.body.id, p_actor: S.t2sp.uid, p_sha256: L.sha(buf), p_size: buf.length, p_mime: 'image/png', p_path: bg.body.path });
  const directInsert = await fetch(`${L.API}/rest/v1/inspection_photos`, { method: 'POST', headers: { apikey: L.ANON, authorization: 'Bearer ' + S.t2sp.token, 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: L.ORG, inspection_id: INS, angle: 'wheels', storage_path: bg.body.path }) });
  const j = L.journal(`id='${bg.body.id}'`)[0];
  const fin = await L.apiPhotos(S.t2sp, { phase: 'finish', id: bg.body.id }); const j2 = L.journal(`id='${bg.body.id}'`)[0];
  L.rec(FILE, { id: 'A15', cenario: 'CONTRACT: atestação antiga de 5 argumentos (c6b26da); finalize sem atestação (0aa2403); atestação pelo usuário; INSERT direto; retomada pelo escritor novo', papel: 'service_role / t2sp', esperado: '5 args negado; finalize sem atestação negado; usuário não atesta; INSERT direto negado; jornal fica pending e o escritor novo conclui', obtido: `5 args=${old5.status} ${old5b?.message ?? ''}; finalize sem atestar=${fin0aa.status} ${fin0aa.body?.message ?? ''}; atestação pelo usuário=${userAttest.status}; INSERT direto=${directInsert.status}; jornal=${j.state}; retomada=${fin.status} ${j2.state}`, status: old5.status >= 400 && fin0aa.status >= 400 && userAttest.status >= 400 && directInsert.status >= 400 && j.state === 'pending' && j2.state === 'linked' ? 'PASS' : 'FAIL', evidencia: {} });
}
// ---------- A16: links de visualização por papel ----------
if (run('A16')) {
  const path = L.psql(`select storage_path from inspection_photos where inspection_id='${INS}' and angle='damage' limit 1`);
  const vpath = L.psql(`select photo_storage_path from vehicles where id='${VEH}'`);
  const out = [];
  for (const k of ['t2sp', 't2other', 'security', 'fmcampinas', 'fmall', 'admin', 't2orgb']) {
    const si = await L.signUrl(S[k].token, path); const sv = await L.signUrl(S[k].token, vpath); const ls = await L.storageList(S[k].token, `${L.ORG}/${INS}`);
    out.push(`${k}: inspeção=${si.status} veículo=${sv.status} listar=${Array.isArray(ls.body) ? ls.body.length : ls.status}`);
  }
  // signed URL é portador: funciona sem sessão
  const si = await L.signUrl(S.t2other.token, path); const anon = si.body?.signedURL ? await fetch(`${L.API}/storage/v1${si.body.signedURL}`) : null;
  L.rec(FILE, { id: 'A16', cenario: 'Links de visualização (signed URL) e listagem por papel: foto de AVARIA da inspeção do t2sp e foto de veículo', papel: 'todos', esperado: 'decisão: hoje a política de leitura do bucket (0181) permite a QUALQUER membro da organização ler/assinar evidências de inspeção; app só gera links em /fleet', obtido: out.join(' | ') + ` | link assinado por t2other aberto sem sessão=${anon?.status}`, status: 'OBS', evidencia: out });
}
for (const s of Object.values(S)) await s.ctx.close().catch(() => {});
await b.close();
