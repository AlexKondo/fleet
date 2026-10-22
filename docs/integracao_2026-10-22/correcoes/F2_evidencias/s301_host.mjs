// S3-01: host (lucas) opens /reservations/f2 and reads "Passageiros confirmados". Usage: node s301_host.mjs BEFORE|AFTER
import { chromium, login, go, shot, save, sql } from './common.mjs';
const tag = process.argv[2] ?? 'RUN';
const f2 = sql("select rid from seedv.r where k='f2'");
const db = sql(`select string_agg(p.full_name, ', ' order by p.full_name) from trip_participants tp join profiles p on p.id=tp.passenger_id join reservations r on r.trip_request_id=tp.trip_request_id where r.id='${f2}' and tp.status='accepted'`);
const browser = await chromium.launch();
const { ctx, page, log } = await login(browser, 'lucas');
const nav = await go(page, `/reservations/${f2}`);
const sec = page.locator('[data-testid="carpool-host-section"]');
const text = (await sec.count()) ? await sec.innerText() : null;
const items = await page.locator('[data-testid="carpool-participants"] li').allInnerTexts();
await sec.scrollIntoViewIfNeeded().catch(() => {});
await shot(page, `S3-01_${tag}_host_f2`);
const out = { tag, nav, acceptedInDb: db, participantsListed: items, saysNone: /Nenhum passageiro confirmado/.test(text ?? ''), saysUnavailable: /Não conseguimos carregar os passageiros/.test(text ?? ''), log };
save(`S3-01_${tag}`, out); console.log(JSON.stringify({ ...out, log: { c: log.console.length, e: log.pageerrors.length, s: log.http5xx.length } }));
await ctx.close(); await browser.close();
