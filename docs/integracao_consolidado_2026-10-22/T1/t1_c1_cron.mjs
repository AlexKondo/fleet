// C1: rota /api/cron/reservation-expiry LOCAL (localhost:3100). Le CRON_SECRET de apps/web/.env.local sem imprimir.
import fs from 'node:fs';
const envTxt = fs.readFileSync('C:/projects/fleet/_local/fleet-integ/apps/web/.env.local', 'utf8');
const secret = envTxt.split(/\r?\n/).find(l => l.startsWith('CRON_SECRET='))?.slice(12).replace(/^"|"$/g, '');
const url = 'http://localhost:3100/api/cron/reservation-expiry';
const call = async (label, headers) => { const r = await fetch(url, { headers }); const t = await r.text(); return { label, status: r.status, body: t.slice(0, 300) }; };
const out = [];
out.push(await call('sem Authorization', {}));
out.push(await call('segredo errado', { authorization: 'Bearer errado-' + Date.now() }));
out.push(await call('Bearer vazio', { authorization: 'Bearer ' }));
out.push(await call('com CRON_SECRET local', { authorization: 'Bearer ' + secret }));
out.push(await call('com CRON_SECRET local (2a vez, idempotente)', { authorization: 'Bearer ' + secret }));
console.log(JSON.stringify({ secret_present: !!secret, out }, null, 1));
