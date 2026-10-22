// S3-04 / S3-05 / S3-07 / S3-10 / S3-11 browser checks. Usage: node s3_p3.mjs BEFORE|AFTER <fixtureN>
import { chromium, login, go, shot, save, sql } from './common.mjs';
const tag = process.argv[2] ?? 'RUN';
const fx = `f2000000-0000-0000-0000-0000000000b${process.argv[3] ?? '1'}`;
const custody = 'e3000000-0000-0000-0000-0000000000b2';
const out = { tag, fixture: fx };
const browser = await chromium.launch();
const formVisible = async (page) => (await page.locator('summary', { hasText: /Regularizar saída impedida/ }).count()) > 0;

// S3-04: security in key_custody (RPC refuses) vs gate_visual (RPC accepts)
{
  const { ctx, page } = await login(browser, 'security');
  await go(page, `/reservations/${custody}`); out.s304_security_keyCustody_formVisible = await formVisible(page);
  await shot(page, `S3-04_${tag}_security_key_custody`);
  await go(page, `/reservations/${fx}`); out.s304_security_gateVisual_formVisible = await formVisible(page);
  await ctx.close();
}
// S3-10: raw audit codes on /admin and /admin/audit
{
  const codes = sql('select distinct action from audit_log').split('\n').filter(Boolean);
  const { ctx, page } = await login(browser, 'admin');
  for (const route of ['/admin', '/admin/audit']) {
    await go(page, route);
    const text = await page.locator('main').innerText().catch(() => '');
    const options = await page.locator('select[name=action] option').allInnerTexts().catch(() => []);
    const all = text + '\n' + options.join('\n');
    out[`s310_raw_codes_${route}`] = codes.filter((c) => new RegExp(`(^|[\s>|(])${c.replace(/\./g, '\.')}($|[\s<|)])`, 'm').test(all));
    await shot(page, `S3-10_${tag}${route.replace(/\//g, '_')}`);
  }
  await ctx.close();
}
// S3-11: archived vehicles listed as underutilized on /analytics
{
  const archived = sql("select plate from vehicles where archived_at is not null and organization_id='00000000-0000-0000-0000-000000000001'").split('\n').filter(Boolean);
  const { ctx, page } = await login(browser, 'fmall');
  await go(page, '/analytics');
  const text = await page.locator('main').innerText().catch(() => '');
  out.s311_archived_in_db = archived.length;
  out.s311_archived_plates_on_analytics = archived.filter((p) => text.includes(p));
  await shot(page, `S3-11_${tag}_analytics`);
  await ctx.close();
}
// S3-07 (error keeps the checkbox) and S3-05 (persistent success notice) as fmall on the gate_visual fixture
{
  const veh = sql(`select vehicle_id from reservations where id='${fx}'`);
  const { ctx, page, log } = await login(browser, 'fmall');
  await go(page, `/reservations/${fx}`);
  out.s305_formVisible_before_submit = await formVisible(page);
  if (out.s305_formVisible_before_submit) {
    await page.locator('summary', { hasText: /Regularizar saída impedida/ }).click();
    await page.locator('textarea[name=reason]').fill('F2: veículo não saiu, teste local');
    await page.locator('input[name=not_departed]').check();
    sql(`update vehicles set status='in_use' where id='${veh}'`);
    try {
      await page.getByRole('button', { name: /Encerrar por exceção/ }).click();
      await page.locator('details.fm-panel [role=alert]').waitFor({ timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1500);
      out.s307_error_message = (await page.locator('details.fm-panel [role=alert]').innerText().catch(() => '')).trim();
      out.s307_checkbox_checked_after_error = await page.locator('input[name=not_departed]').isChecked();
      out.s307_reason_kept = await page.locator('textarea[name=reason]').inputValue();
      await shot(page, `S3-07_${tag}_after_error`);
    } finally {
      sql(`update vehicles set status='reserved' where id='${veh}'`);
    }
    if (!out.s307_checkbox_checked_after_error) await page.locator('input[name=not_departed]').check();
    await page.getByRole('button', { name: /Encerrar por exceção/ }).click();
    await page.waitForTimeout(8000);
    out.s305_reservation_status_db = sql(`select status from reservations where id='${fx}'`);
    const notice = async () => (await page.locator('[data-testid=operation-exception-notice], details.fm-panel [role=status]').allInnerTexts()).join(' | ');
    out.s305_notice_after_submit = await notice();
    await shot(page, `S3-05_${tag}_after_success`);
    await go(page, `/reservations/${fx}`);
    out.s305_notice_after_reload = await notice();
    await shot(page, `S3-05_${tag}_after_reload`);
  }
  out.log = log; await ctx.close();
}
await browser.close();
save(`S3-P3_${tag}`, out); console.log(JSON.stringify({ ...out, log: { c: out.log.console.length, e: out.log.pageerrors.length, s: out.log.http5xx } }, null, 1));
