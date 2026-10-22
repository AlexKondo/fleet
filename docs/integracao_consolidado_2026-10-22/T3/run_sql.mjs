// T3: executa um .sql no banco LOCAL substituindo :'users' pelos ids dos usuarios T3 (sem senhas).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const u = JSON.parse(fs.readFileSync('C:/projects/fleet/_local/homolog/conclusao/T3/t3users.json', 'utf8'));
const m = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { id: v.id }]));
const sql = fs.readFileSync(process.argv[2], 'utf8').replace(":'users'", `'${JSON.stringify(m)}'`);
try {
  process.stdout.write(execSync('docker exec -i supabase_db_fleet-homolog psql -U postgres -d postgres', { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }).toString());
} catch (e) { process.stdout.write(String(e.stdout || '') + String(e.stderr || '')); }
