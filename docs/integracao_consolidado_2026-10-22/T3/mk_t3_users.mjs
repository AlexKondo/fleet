// T3: cria usuarios de teste proprios (prefixo t3-) no Auth LOCAL (127.0.0.1:55321) e os perfis na org de homologacao.
// Saida (fora do git): C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json (contem senha ficticia local).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const env = Object.fromEntries(fs.readFileSync('C:/projects/fleet/_local/homolog/tests/keys.env', 'utf8').split('\n').filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const API = 'http://127.0.0.1:55321', K = env.SERVICE_ROLE_KEY;
const PW = 'T3@Local-' + 'Homolog2026';
const OUT = 'C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json';
// k, nome, papel, cnh: valid|expired|null|ai_null, extra
const defs = [
  ['t3admin', 'T3 Admin SemCNH', 'administrator', 'null'],
  ['t3fmtotal', 'T3 Gestor Total SemCNH', 'fleet_manager', 'null', 'all_units'],
  ['t3fmlim', 'T3 Gestor Limitado SemCNH', 'fleet_manager', 'null', 'campinas'],
  ['t3maint', 'T3 Manutencao SemCNH', 'maintenance_operator', 'null'],
  ['t3sec', 'T3 Seguranca', 'security', 'null'],
  ['t3cust', 'T3 Custodiante SemCNH', 'employee', 'null', 'custodian'],
  ['t3valid', 'T3 Colab Valida', 'employee', 'valid'],
  ['t3exp', 'T3 Colab Vencida', 'employee', 'expired'],
  ['t3null', 'T3 Colab SemCNH', 'employee', 'null'],
  ['t3off', 'T3 Colab Desativado', 'employee', 'valid', 'disabled'],
  ['t3pwd', 'T3 Colab TrocaSenha', 'employee', 'null', 'must_change'],
  ['t3up', 'T3 Colab Upload', 'employee', 'null'],
  ['t3ai', 'T3 Colab LidaPorIA', 'employee', 'ai'],
];
const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const out = { ...existing };
for (const [k, name, role, cnh, extra] of defs) {
  if (out[k]) continue;
  const email = `${k}@t3.frota-aurora.test`;
  const body = { email, password: PW, email_confirm: true, user_metadata: { full_name: name } };
  if (extra === 'must_change') body.app_metadata = { must_change_password: true };
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.id) throw new Error(k + ' ' + JSON.stringify(j).slice(0, 200));
  out[k] = { id: j.id, email, password: PW, full_name: name, role, cnh, extra: extra || null };
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const org = '00000000-0000-0000-0000-000000000001';
const admin = "(select id from seedv.u where k='admin')";
const lic = (c) => c === 'valid' ? `true,'77700011122','B',current_date+400,'manual'` : c === 'expired' ? `true,'77700011133','B',current_date-20,'manual'` : c === 'ai' ? `true,'77700011144','B',current_date+500,'ai'` : `false,null,null,null,null`;
let sql = 'begin;\n';
for (const [k, v] of Object.entries(out)) {
  sql += `insert into profiles(id,organization_id,full_name,role,driver_authorized,drivers_license_number,drivers_license_category,drivers_license_expiration,drivers_license_expiration_source) values ('${v.id}','${org}','${v.full_name}','${v.role}',${lic(v.cnh)}) on conflict (id) do nothing;\n`;
  if (v.extra === 'all_units') sql += `insert into fm_manager_scopes(user_id,organization_id,mode,version,updated_by) values ('${v.id}','${org}','all_units',1,${admin}) on conflict do nothing;\n`;
  if (v.extra === 'campinas') sql += `insert into fm_manager_scopes(user_id,organization_id,mode,version,updated_by) values ('${v.id}','${org}','selected_units',1,${admin}) on conflict do nothing;\ninsert into fm_manager_scope_units(user_id,organization_id,unit_id,enabled) values ('${v.id}','${org}','d1000000-0000-0000-0000-000000000002',true) on conflict do nothing;\n`;
  if (v.extra === 'custodian') sql += `insert into fm_key_custodians(organization_id,unit_id,user_id,enabled,assigned_by) values ('${org}','d1000000-0000-0000-0000-000000000002','${v.id}',true,${admin}) on conflict do nothing;\n`;
  if (v.extra === 'disabled') sql += `insert into fm_member_access(user_id,organization_id,enabled,version,reason,updated_by) values ('${v.id}','${org}',false,1,'T3 teste conta desativada',${admin}) on conflict do nothing;\n`;
}
sql += 'commit;\n';
fs.writeFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.sql', sql);
console.log(execSync('docker exec -i supabase_db_fleet-homolog psql -U postgres -d postgres -v ON_ERROR_STOP=1', { input: sql }).toString().split('\n').filter(l => /ERROR|COMMIT/.test(l)).join('\n'));
console.log('users', Object.keys(out).length);
