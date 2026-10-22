// T2 — A17: upload interrompido NO MEIO do corpo (socket destruído após ~30%) direto no Storage local.
import http from 'node:http';
import * as L from './lib.mjs';
const b = await L.chromium.launch(); const s = await L.login(b, 't2sp');
const INS = L.psql(`select id from inspections where reservation_id=(select rid from t2.r where k='sp1') and type='pickup' and performed_by_role='traveler' limit 1`);
const buf = L.pngOfSize(3 * 1024 * 1024);
const bg = await L.apiPhotos(s, { phase: 'begin', kind: 'inspection', target: INS, angle: 'back', sha: L.sha(buf), size: buf.length, mime: 'image/png' });
await new Promise((resolve) => {
  const req = http.request(`${L.API}/storage/v1/object/vehicle-photos/${bg.body.path}`, { method: 'POST', headers: { apikey: L.ANON, authorization: 'Bearer ' + s.token, 'content-type': 'image/png', 'content-length': buf.length, 'x-upsert': 'false' } });
  req.on('error', () => resolve()); req.on('response', (r) => { r.resume(); resolve(); });
  req.write(buf.subarray(0, Math.floor(buf.length * 0.3)), () => setTimeout(() => { req.destroy(); resolve(); }, 300));
});
await new Promise(r => setTimeout(r, 1500));
const objAfterCut = L.objects(bg.body.path);
const fin1 = await L.apiPhotos(s, { phase: 'finish', id: bg.body.id });
const up = await L.storageUpload(s.token, bg.body.path, buf, 'image/png');
const fin2 = await L.apiPhotos(s, { phase: 'finish', id: bg.body.id });
const j = L.journal(`id='${bg.body.id}'`)[0];
L.rec('api-photos.json', { id: process.env.ID ?? 'A17', cenario: 'Upload interrompido no meio do corpo (conexão cortada a ~30% de 3 MiB) e retomada com o mesmo arquivo', papel: 't2sp', esperado: 'nenhum objeto parcial; finish 409 (pendente); reenvio completo 200; finish 200; vínculo', obtido: `objeto após corte=${objAfterCut.length}${objAfterCut[0] ? ' (' + objAfterCut[0].size + 'B)' : ''}; finish=${fin1.status} (${fin1.ms}ms); reenvio=${up.status}; finish=${fin2.status}; jornal=${j.state}+${j.verified ? 'v' : '-'}`, status: objAfterCut.length === 0 && fin1.status === 409 && up.status === 200 && fin2.status === 200 && j.state === 'linked' ? 'PASS' : 'FAIL', evidencia: { objAfterCut } });
await b.close();
