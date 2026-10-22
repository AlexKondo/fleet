// S3-02: rider search with the corporate points unreadable (temporary REVOKE SELECT on the LOCAL db, restored in finally).
// Usage: node s302_points.mjs BEFORE|AFTER
import { chromium, login, go, shot, save, sql } from './common.mjs';
const tag = process.argv[2] ?? 'RUN';
const grants = () => sql("select grantee||':'||string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='corporate_mobility_points' group by grantee order by grantee");
const before = grants();
const browser = await chromium.launch();
const { ctx, page, log } = await login(browser, 'thiago');
const out = { tag, grantsBefore: before.split('\n') };
try {
  await go(page, '/carpool');
  if (!process.env.NOREVOKE) sql('revoke select on public.corporate_mobility_points from authenticated');
  out.revokedAt = new Date().toISOString();
  const logBefore = sql('select count(*) from carpool_search_log');
  await page.locator('#fm-origin').fill('Matriz Faria Lima'); await page.keyboard.press('Escape').catch(() => {});
  await page.locator('#fm-destination').fill('Centro Técnico Campinas'); await page.keyboard.press('Escape').catch(() => {});
  await page.locator('#fm-when').fill('2026-10-24T08:00');
  await page.locator('#fm-seats').fill('1');
  await page.locator('[data-testid=buscar-submit]').click();
  await page.locator('[data-testid=carpool-unavailable], [data-testid=buscar-failed], [data-testid=carpool-places]').first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  out.banner = (await page.locator('[data-testid=carpool-unavailable]').innerText().catch(() => '')).trim();
  out.blamesGoogle = /Google/.test(out.banner);
  out.searchesReachingEngine = Number(sql('select count(*) from carpool_search_log')) - Number(logBefore);
  await shot(page, `S3-02_${tag}_points_revoked`);
} finally {
  sql('grant select on public.corporate_mobility_points to authenticated');
  out.grantsAfter = grants().split('\n');
  out.grantsRestored = out.grantsAfter.join('|') === out.grantsBefore.join('|');
}
out.log = log; save(`S3-02_${tag}`, out);
console.log(JSON.stringify({ ...out, log: { c: log.console.length, e: log.pageerrors.length, s: log.http5xx } }));
await ctx.close(); await browser.close();
