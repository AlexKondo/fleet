// T3 - copia adaptada de C:/projects/fleet/_local/homolog/design/capture.mjs (login/probe identicos); saida em T3/shots/screens e T3/screens_index.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('C:/projects/fleet/testing/live-demo/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
const DIR = 'C:/projects/fleet/_local/homolog/design';
const SHOTD = 'C:/projects/fleet/_local/homolog/conclusao/T3'; // PNGs grandes fora do git
const OUTD = 'C:/projects/fleet/_local/fleet-integ/docs/integracao_consolidado_2026-10-22/T3';
const users = JSON.parse(fs.readFileSync(DIR + '/users.json', 'utf8'));
const q = (s) => execSync(`docker exec supabase_db_fleet-homolog psql -U postgres -d postgres -Atc "${s}"`).toString().trim();
const R = Object.fromEntries(q("select k||'='||rid from seedv.r").split('\n').map(l => l.split('=')));
const VEH = q("select id from vehicles where plate='GWM1H61'");

// [screen, route, role]
const T = [
  ['SCR-FM-001', '/dashboard/command-center', 'fmall'],
  ['SCR-FM-002', '/fleet', 'fmall'],
  ['SCR-FM-002', `/fleet/vehicles/${VEH}`, 'fmall'],
  ['SCR-FM-003', '/dashboard', 'fmall'],
  ['SCR-FM-003', '/trips', 'fmall'],
  ['SCR-FM-003', `/reservations/${R.f2}`, 'fmall'],
  ['SCR-FM-004', '/fleet/carpools', 'fmall'],
  ['SCR-FM-004', '/analytics/carpool', 'fmall'],
  ['SCR-FM-004', '/carpool', 'fmall'],
  ['SCR-FM-005', '/fleet/maintenance', 'fmall'],
  ['SCR-FM-005', '/maintenance/planning', 'fmall'],
  ['SCR-FM-006', '/fleet/energy', 'fmall'],
  ['SCR-FM-007', '/fleet/drivers', 'fmall'],
  ['SCR-FM-007', '/settings/users', 'fmall'],
  ['SCR-FM-008', '/fleet/incidents', 'fmall'],
  ['SCR-FM-009', '/analytics', 'fmall'],
  ['SCR-USR-001', '/dashboard', 'lucas'],
  ['SCR-USR-002', '/trips/new', 'lucas'],
  ['SCR-USR-003', '/carpool', 'lucas'],
  ['SCR-USR-004', '/trips', 'lucas'],
  ['SCR-USR-004', `/reservations/${R.f2}`, 'lucas'],
  ['SCR-USR-005', `/reservations/${R.u3}/pickup`, 'thiago'],
  ['SCR-USR-005', `/reservations/${R.u2}/return`, 'mariana'],
  ['SCR-USR-006', '/carpool/mine', 'lucas'],
  ['SCR-SEC-001', '/gate', 'security'],
  ['SCR-SEC-002', '/gate/exceptions', 'security'],
  ['SCR-SEC-003', '/gate/history', 'security'],
  ['SCR-MNT-001', '/maintenance', 'maint'],
  ['SCR-MNT-002', '/maintenance/planning', 'maint'],
  ['SCR-MNT-003', '/maintenance/work-orders', 'maint'],
  ['SCR-MNT-004', '/maintenance/vehicles', 'maint'],
  ['SCR-ADM-001', '/admin', 'admin'],
  ['SCR-ADM-002', '/settings/users', 'admin'],
  ['SCR-ADM-003', '/settings', 'admin'],
  ['SCR-ADM-003', '/settings/mobility-points', 'admin'],
  ['SCR-ADM-003', '/admin/units', 'admin'],
  ['SCR-ADM-004', '/admin/integrations', 'admin'],
  ['SCR-ADM-005', '/admin/audit', 'admin'],
  ['SCR-ADM-005', '/account/privacy', 'admin'],
  ['SCR-ADM-006', '/admin/ai', 'admin'],
  // extras (role-scope variants)
  ['EXTRA', '/fleet', 'fmcampinas'],
  ['EXTRA', '/account/keys', 'custodian'],
  ['EXTRA', '/fleet/keys', 'fmall'],
];
const LOC = [['/dashboard/command-center', 'fmall'], ['/trips/new', 'lucas'], ['/maintenance/work-orders', 'maint']];
const slug = (r) => r.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID').replace(/^\//, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '') || 'root';

const probe = () => {
  const out = { horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, keys: [], broken: 0, tiny: [] };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const re = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;
  let n; const seen = new Set();
  while ((n = w.nextNode())) {
    const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) continue;
    const t = n.textContent.trim();
    if (t && t.length < 100 && re.test(t) && !/\.(js|css|png|jpg|svg|com|org|net|br|json|csv|pdf)$/i.test(t) && !seen.has(t)) { seen.add(t); out.keys.push(t); }
  }
  for (const el of document.querySelectorAll('input[placeholder],[aria-label],[title]')) {
    for (const a of ['placeholder', 'aria-label', 'title']) { const t = (el.getAttribute(a) || '').trim(); if (t && re.test(t) && !seen.has(t)) { seen.add(t); out.keys.push(t + ' [' + a + ']'); } }
  }
  for (const img of document.images) { if (!img.getAttribute('src') || (img.complete && img.naturalWidth === 0)) out.broken++; }
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const cs = getComputedStyle(el);
      if (!/sr-only/.test(el.className.toString()) && !(el.closest && el.closest('.sr-only')) && (cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.clientWidth < 60 && (el.textContent || '').trim()) {
        out.tiny.push(`${el.tagName.toLowerCase()}.${(el.className && el.className.toString().slice(0, 40)) || ''} "${el.textContent.trim().slice(0, 30)}" ${el.clientWidth}/${el.scrollWidth}`);
        if (out.tiny.length > 10) break;
      }
    }
  }
  return out;
};

async function loginCtx(browser, user, locale) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'light' });
  if (locale) await ctx.addCookies([{ name: 'fleet-locale', value: locale, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 120000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  return { ctx, page, landed: page.url() };
}

async function capture(page, route, file, vw, vh) {
  const rec = { consoleErrors: [], failedRequests: [] };
  const onC = (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300)); };
  const onE = (e) => rec.consoleErrors.push('pageerror: ' + String(e).slice(0, 300));
  const onF = (r) => r.failure()?.errorText === 'net::ERR_ABORTED' ? (rec.aborted=(rec.aborted||0)+1) : rec.failedRequests.push(`${r.method()} ${r.url().replace(BASE, '')} FAILED ${r.failure()?.errorText}`.slice(0, 250));
  let first = null, final = null;
  const onR = (r) => {
    if (r.status() >= 400) rec.failedRequests.push(`${r.request().method()} ${r.url().replace(BASE, '')} ${r.status()}`.slice(0, 250));
  };
  page.on('console', onC); page.on('pageerror', onE); page.on('requestfailed', onF); page.on('response', onR);
  await page.setViewportSize({ width: vw, height: vh });
  let resp = null, err = null;
  try { resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch (e) { err = String(e).slice(0, 200); }
  if (resp) { let rq = resp.request(); while (rq.redirectedFrom()) rq = rq.redirectedFrom(); first = (await rq.response())?.status() ?? null; final = resp.status(); }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const url = new URL(page.url());
  let pr = { horizontalOverflow: null, keys: [], broken: 0, tiny: [] };
  try { pr = await page.evaluate(probe); } catch (e) { rec.consoleErrors.push('probe failed ' + e); }
  await page.screenshot({ path: file, fullPage: true }).catch((e) => rec.consoleErrors.push('screenshot failed ' + e));
  page.off('console', onC); page.off('pageerror', onE); page.off('requestfailed', onF); page.off('response', onR);
  const redirected = url.pathname + url.search !== route ? url.pathname + url.search : null;
  return { httpStatus: final, initialStatus: first, redirectedTo: redirected, navError: err, consoleErrors: [...new Set(rec.consoleErrors)], failedRequests: [...new Set(rec.failedRequests)], abortedRequestsIgnored: rec.aborted||0, horizontalOverflow: pr.horizontalOverflow, visibleRawI18nKeys: pr.keys, emptyOrBrokenImages: pr.broken, textOverflowSuspects: pr.tiny };
}

const browser = await chromium.launch({ headless: true });
const index = { generatedAt: new Date().toISOString(), base: BASE, captures: [], locales: [] };
const byRole = {};
for (const t of T) (byRole[t[2]] ||= []).push(t);
for (const [role, list] of Object.entries(byRole)) {
  const { ctx, page, landed } = await loginCtx(browser, users[role]);
  console.log('login', role, '->', landed.replace(BASE, ''));
  for (const [screen, route] of list) {
    for (const [vw, vh] of [[1440, 900], [390, 844]]) {
      const rel = `shots/screens/${screen}_${slug(route)}_${role === 'thiago' || role === 'mariana' || role === 'fmcampinas' || role === 'custodian' ? role + '_' : ''}${vw}.png`.replace('__', '_');
      const r = await capture(page, route, SHOTD + '/' + rel, vw, vh);
      index.captures.push({ screen, route, role, viewport: `${vw}x${vh}`, file: rel, ...r });
      console.log(screen, route.slice(0, 40), role, vw, r.httpStatus, r.redirectedTo || '', 'err', r.consoleErrors.length, 'fail', r.failedRequests.length, 'keys', r.visibleRawI18nKeys.length);
    }
  }
  await ctx.close();
}
for (const locale of ['es', 'en-US', 'zh-CN']) {
  const byR = {};
  for (const l of LOC) (byR[l[1]] ||= []).push(l[0]);
  for (const [role, routes] of Object.entries(byR)) {
    const { ctx, page } = await loginCtx(browser, users[role], locale);
    for (const route of routes) {
      const rel = `shots/screens/i18n_${locale}_${slug(route)}_1440.png`;
      const r = await capture(page, route, SHOTD + '/' + rel, 1440, 900);
      index.locales.push({ locale, route, role, file: rel, ...r });
      console.log('LOC', locale, route, r.httpStatus, 'keys', r.visibleRawI18nKeys.length);
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(OUTD + '/screens_index.json', JSON.stringify(index, null, 1));
const bad = index.captures.filter((c) => !c.httpStatus || c.httpStatus >= 400 || c.redirectedTo);
console.log('TOTAL', index.captures.length, 'problem', bad.length);
