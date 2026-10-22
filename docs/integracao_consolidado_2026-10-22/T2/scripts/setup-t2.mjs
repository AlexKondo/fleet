// T2 — fixtures PRÓPRIAS (prefixo T2/TDA) no banco LOCAL descartável. Idempotente.
// Uso: node setup-t2.mjs <env do `supabase status -o env`> <arquivo de credenciais (scratchpad)>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const API = env.API_URL; if (!/^http:\/\/127\.0\.0\.1:/.test(API)) throw new Error('not local');
const K = env.SERVICE_ROLE_KEY; const CRED = process.argv[3];
const psql = (s) => execSync('docker exec -i supabase_db_fleet-homolog psql -U postgres -d postgres -At -q -v ON_ERROR_STOP=1', { input: s }).toString().trim();
const ORG = '00000000-0000-0000-0000-000000000001', ORGB = '00000000-0000-0000-0000-0000000000b2';
let cred = fs.existsSync(CRED) ? JSON.parse(fs.readFileSync(CRED, 'utf8')) : {};
const defs = [['t2sp', 'T2 Motorista SP', 'employee', ORG], ['t2camp', 'T2 Motorista Campinas', 'employee', ORG], ['t2rio', 'T2 Motorista Rio', 'employee', ORG], ['t2other', 'T2 Outro Colaborador', 'employee', ORG], ['t2orgb', 'T2 Admin Org B', 'administrator', ORGB]];
for (const [k, name] of defs) {
  if (cred[k]) continue;
  const password = crypto.randomBytes(18).toString('base64url') + 'aA1!'; const email = `${k}@t2-fotos.test`;
  const r = await fetch(API + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }) });
  const j = await r.json(); if (!j.id) throw new Error('create user ' + k + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  cred[k] = { id: j.id, email, password }; fs.writeFileSync(CRED, JSON.stringify(cred));
}
const prof = defs.map(([k, n, r, o]) => `('${cred[k].id}','${o}','${n}','${r}',true,'9${String(Math.abs(cred[k].id.charCodeAt(0)*7919)).padStart(10,'0').slice(0,10)}','B',current_date+400,'manual')`).join(',');
psql(`begin;
create schema if not exists t2;
insert into organizations(id,name) values ('${ORGB}','Org B (ficticia, local)') on conflict do nothing;
insert into profiles(id,organization_id,full_name,role,driver_authorized,drivers_license_number,drivers_license_category,drivers_license_expiration,drivers_license_expiration_source) values ${prof} on conflict (id) do nothing;
create table if not exists t2.v(k text primary key, plate text, unit int);
insert into t2.v values ('sp_photo','TDA1A01',1),('sp_pick1','TDA1A02',1),('sp_pick2','TDA1A03',1),('sp_api','TDA1A04',1),('camp_photo','TDA2A01',2),('camp_pick','TDA2A02',2),('rio_photo','TDA3A01',3),('rio_pick','TDA3A02',3),('sp_new_dummy','TDA1A09',1) on conflict do nothing;
insert into vehicles(organization_id,plate,category_id,status,odometer_km,fuel_level_percent,battery_level_percent,estimated_range_km,next_service_odometer_km,home_location_id,current_location_id,has_blocking_damage,documentation_valid,is_clean_exterior,is_clean_interior,name,color,next_service_date)
select '${ORG}',plate,'c1000000-0000-0000-0000-000000000001','available',10000,80,null,600,50000,('e1000000-0000-0000-0000-00000000000'||unit)::uuid,('e1000000-0000-0000-0000-00000000000'||unit)::uuid,false,true,true,true,'T2 '||k,'Branco',current_date+180 from t2.v where k<>'sp_new_dummy' on conflict do nothing;
insert into fm_vehicle_units(vehicle_id,organization_id,unit_id) select v.id,'${ORG}',('d1000000-0000-0000-0000-00000000000'||t.unit)::uuid from t2.v t join vehicles v on v.plate=t.plate on conflict do nothing;
commit;`);
console.log('ok', psql(`select count(*) from vehicles where plate like 'TDA%'`), Object.keys(cred).join(','));
