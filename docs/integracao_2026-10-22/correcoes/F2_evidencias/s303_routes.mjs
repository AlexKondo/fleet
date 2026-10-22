// S3-03: admin without CNH and manager with expired CNH vs administrative/driving routes. Usage: node s303_routes.mjs BEFORE|AFTER
import { chromium, login, go, shot, save, sql } from './common.mjs';
const tag = process.argv[2] ?? 'RUN';
const ADMIN = ['/admin', '/admin/units', '/admin/integrations', '/admin/audit', '/admin/ai', '/analytics', '/analytics/carpool', '/dashboard', '/dashboard/command-center', '/gate', '/gate/exceptions', '/gate/history', '/fleet', '/fleet/carpools', '/settings', '/maintenance'];
const DRIVING = ['/trips/new', '/trips', '/carpool'];
const lic = sql("select u.email||' role='||p.role||' cnh='||coalesce(drivers_license_expiration::text,'NULL')||' auth='||driver_authorized from profiles p join auth.users u on u.id=p.id where u.email like 's3%'");
const browser = await chromium.launch();
const out = { tag, at: new Date().toISOString(), licenses: lic.split('\n'), users: {} };
for (const key of ['s3admin', 's3fmexp']) {
  const { ctx, page, log, landed } = await login(browser, key);
  const r = { landed, admin: {}, driving: {} };
  for (const p of ADMIN) r.admin[p] = (await go(page, p)).path;
  for (const p of DRIVING) r.driving[p] = (await go(page, p)).path;
  await go(page, '/admin/audit'); await shot(page, `S3-03_${tag}_${key}_admin_audit`);
  await go(page, '/dashboard'); await shot(page, `S3-03_${tag}_${key}_dashboard`);
  r.blockedAdmin = Object.entries(r.admin).filter(([p, to]) => to.startsWith('/account/license')).map(([p]) => p);
  r.drivingGated = Object.entries(r.driving).filter(([p, to]) => to.startsWith('/account/license')).map(([p]) => p);
  r.log = log; out.users[key] = r; await ctx.close();
}
await browser.close();
save(`S3-03_${tag}`, out);
for (const [k, r] of Object.entries(out.users)) console.log(tag, k, 'adminBlocked=', r.blockedAdmin.length, JSON.stringify(r.blockedAdmin), 'drivingGated=', JSON.stringify(r.drivingGated), '5xx=', r.log.http5xx.length, 'pageerr=', r.log.pageerrors.length);
