// C7b: the CNH "magnifying glass" and "confetti" animations under BOTH prefers-reduced-motion settings, measured
// with getAnimations() + bounding boxes (not screenshots), through the REAL upload form (synthetic CNH image,
// real vision call) on the local `next dev` server (BASE_URL, default http://localhost:3100) and live Supabase.
//
//   node testing/live-demo/c7b-animations.mjs [--expect-before | --expect-after]
//
// --expect-before: documents the bug (reduce suppresses magnifier + confetti)   -> exit 0 when the bug reproduces
// --expect-after : the fix (both decorative animations always play, other animations stay under the preference)
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE, ROOT, T, record, results, sql, provisionOrg, cleanupOrgs, login } from "./carpool-c5-lib.mjs";

const mode = process.argv.includes("--expect-before") ? "before" : "after";
const SHOTS = path.join(ROOT, "resultado_de_testes", "carpool-c7b");
mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- synthetic CNH image
const require = createRequire(path.join(ROOT, "apps/web/package.json"));
const { createCanvas } = require("@napi-rs/canvas");
function makeCnh(file) {
  const c = createCanvas(1200, 760);
  const g = c.getContext("2d");
  g.fillStyle = "#f4f1e6"; g.fillRect(0, 0, 1200, 760);
  g.fillStyle = "#1b5e20"; g.fillRect(0, 0, 1200, 90);
  g.fillStyle = "#fff"; g.font = "bold 34px sans-serif";
  g.fillText("REPÚBLICA FEDERATIVA DO BRASIL", 30, 40);
  g.font = "bold 28px sans-serif"; g.fillText("CARTEIRA NACIONAL DE HABILITAÇÃO", 30, 78);
  g.fillStyle = "#000";
  const lab = (t, x, y) => { g.font = "20px sans-serif"; g.fillStyle = "#444"; g.fillText(t, x, y); };
  const val = (t, x, y, color = "#000") => { g.font = "bold 34px sans-serif"; g.fillStyle = color; g.fillText(t, x, y); };
  g.strokeStyle = "#999"; g.strokeRect(30, 130, 250, 320); g.fillStyle = "#ccc"; g.fillRect(31, 131, 248, 318);
  lab("1/2 NOME E SOBRENOME", 320, 160); val("JOAO TESTE DA SILVA", 320, 200);
  lab("3 DATA, LOCAL E UF DE NASCIMENTO", 320, 250); val("01/02/1985, SAO PAULO, SP", 320, 290);
  lab("4a DATA EMISSÃO", 320, 345); val("10/03/2024", 320, 385);
  lab("4b VALIDADE", 640, 345); val("10/03/2034", 640, 385, "#c00000");
  lab("4c ÓRGÃO EMISSOR / UF", 320, 430); val("DETRAN SP", 320, 468);
  lab("5 Nº REGISTRO", 30, 530); val("01234567890", 30, 575);
  lab("9 CAT. HAB.", 520, 530); val("B", 520, 575);
  lab("1ª HABILITAÇÃO", 760, 530); val("15/05/2005", 760, 575);
  lab("OBSERVAÇÕES", 30, 640); val("EAR", 30, 685);
  writeFileSync(file, c.toBuffer("image/jpeg"));
}
const CNH_FILE = path.join(SHOTS, "synthetic-cnh.jpg");
makeCnh(CNH_FILE);

// ---------------------------------------------------------------- helpers
const sampleMagnifier = (page) => page.evaluate(() => {
  const el = document.querySelector(".animate-magnifier-scan");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const a = el.getAnimations().map((x) => { const t = x.effect.getComputedTiming(); return { name: x.animationName, duration: t.duration, iterations: t.iterations, playState: x.playState }; });
  return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, animations: a };
});
const sampleConfetti = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll(".animate-confetti-piece")];
  if (els.length === 0) return null;
  const vis = els.filter((e) => Number(getComputedStyle(e).opacity) > 0.05).length;
  const tops = els.slice(0, 8).map((e) => Math.round(e.getBoundingClientRect().top));
  const a = els[0].getAnimations().map((x) => { const t = x.effect.getComputedTiming(); return { name: x.animationName, duration: t.duration, iterations: t.iterations, playState: x.playState }; });
  return { count: els.length, visible: vis, tops, animations: a };
});
const sampleBell = (page) => page.evaluate(() => {
  const el = document.querySelector(".animate-bell-shake");
  if (!el) return null;
  const a = el.getAnimations().map((x) => { const t = x.effect.getComputedTiming(); return { name: x.animationName, duration: t.duration, iterations: t.iterations, playState: x.playState }; });
  return { animations: a };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const orgs = [];
const report = {};
try {
  const A = await provisionOrg("anim", [["u1", "employee"], ["secnc", "security"]]);
  orgs.push(A);
  const U = A.users;
  for (const reducedMotion of ["no-preference", "reduce"]) {
    // fresh state: no CNH on file for the driver (so the real upload flow runs); security without CNH = bell-shake control
    await sql(`update profiles set drivers_license_number=null, drivers_license_category=null, drivers_license_expiration=null, driver_authorized=false where id in ('${U.u1.id}','${U.secnc.id}')`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR", reducedMotion });
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    await login(page, U.u1);
    await page.goto(BASE + "/account/license", { waitUntil: "load", timeout: 90000 });
    const pref = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    record(`[${reducedMotion}] browser reports prefers-reduced-motion: reduce = ${reducedMotion === "reduce"}`, pref === (reducedMotion === "reduce"), { pref });

    await page.setInputFiles('input[type="file"][accept="image/*,application/pdf"]', CNH_FILE);
    await page.waitForTimeout(400);
    // hold the analyze request for 3s (client-side route delay) so the "reading" indicator stays on screen long enough to sample
    await page.route("**/account/license", async (route) => { if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
    await page.getByRole("button", { name: "Ler", exact: true }).click();

    // ---- magnifier (while the vision request is in flight)
    let m1 = null;
    for (let i = 0; i < 60 && !m1; i++) { m1 = await sampleMagnifier(page); if (!m1) await sleep(100); }
    const ms = m1 ? [m1] : [];
    for (let i = 0; i < 5 && m1; i++) { await sleep(250); const m = await sampleMagnifier(page); if (m) ms.push(m); }
    if (m1) await page.screenshot({ path: path.join(SHOTS, `anim-${reducedMotion}-magnifier.png` ) });
    const [m2, m3] = [ms[1] ?? null, ms[ms.length - 1] ?? null];
    const magMoved = ms.length >= 3 && Math.max(...ms.map((m) => Math.abs(m.x - ms[0].x) + Math.abs(m.y - ms[0].y))) > 3;
    // "running" must hold in EVERY sample: the suppressed variant (0.01ms, 1 iteration) is "running" for one frame and then ends.
    const isMag = (a) => a.name === "magnifier-scan" && a.duration > 100 && (a.iterations === Infinity || a.iterations === null) && a.playState === "running"; // getComputedTiming().iterations is Infinity -> serialises as null
    const magRunning = ms.length >= 5 && ms.every((m) => m.animations.some(isMag));
    const lastThree = ms.slice(-3);
    const magSuppressed = ms.length >= 4 && !lastThree.some((m) => m.animations.some(isMag)) && lastThree.every((m) => m.x === lastThree[0].x && m.y === lastThree[0].y);
    report[reducedMotion] = { magnifier: { sample: ms[ms.length - 1] ?? m1, samples: ms.length, moved: magMoved, running: magRunning, suppressed: magSuppressed } };
    console.log(`  magnifier [${reducedMotion}]: samples=${ms.length}`, JSON.stringify({ m1, m2, m3 }));

    // ---- wait for the analysed state, confirm, sample the confetti
    await page.getByRole("checkbox").waitFor({ state: "visible", timeout: 120000 });
    await page.unroute("**/account/license");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    let c1 = null, c2 = null, c3 = null;
    for (let i = 0; i < 80 && !c1; i++) { c1 = await sampleConfetti(page); if (!c1) await sleep(50); }
    if (c1) { await sleep(250); c2 = await sampleConfetti(page); await sleep(250); c3 = await sampleConfetti(page); await page.screenshot({ path: path.join(SHOTS, `anim-${reducedMotion}-confetti.png`) }); }
    const isConf = (a) => a.name === "confetti-fall" && a.duration > 100 && a.playState === "running";
    const confettiRunning = [c1, c2, c3].every((c) => !!c && c.animations.some(isConf) && c.visible >= 5);
    const confettiMoved = !!(c1 && c2 && c3) && JSON.stringify(c1.tops) !== JSON.stringify(c2.tops) && JSON.stringify(c2.tops) !== JSON.stringify(c3.tops);
    // suppressed = by the last sample no piece has a running animation of real duration (0.01ms ones are already finished)
    const confettiSuppressed = !!c3 && !c3.animations.some(isConf);
    report[reducedMotion].confetti = { sample: c3 ?? c1, moved: confettiMoved, running: confettiRunning, suppressed: confettiSuppressed };
    console.log(`  confetti [${reducedMotion}]:`, JSON.stringify({ c1, c2, c3 }));
    await page.waitForTimeout(2600);
    const dbLicense = await sql(`select drivers_license_number n from profiles where id='${U.u1.id}'`);
    record(`[${reducedMotion}] the real flow reached the valid "analyzed -> confirmed" state (license saved)`, !!dbLicense[0]?.n, { saved: !!dbLicense[0]?.n });
    await context.close();

    // ---- control: an animation that must STAY under the preference (bell shake for the security user without CNH)
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR", reducedMotion });
    const p2 = await context2.newPage();
    await login(p2, U.secnc);
    await p2.goto(BASE + "/dashboard", { waitUntil: "load", timeout: 90000 });
    let bell = null;
    for (let i = 0; i < 40 && !bell; i++) { bell = await sampleBell(p2); if (!bell) await sleep(150); }
    const bellInfo = bell?.animations.find((a) => a.name === "bell-shake");
    report[reducedMotion].bellShake = bellInfo ?? null;
    console.log(`  bell-shake control [${reducedMotion}]:`, JSON.stringify(bellInfo));
    await context2.close();
  }

  // ---------------------------------------------------------------- verdicts
  const np = report["no-preference"], rd = report["reduce"];
  record("no-preference: magnifier animation RUNS (infinite, 1100ms, in every sample, position changes)", np.magnifier.running && np.magnifier.moved, np.magnifier.sample);
  record("no-preference: confetti RUNS (pieces visible, falling, running in every sample)", np.confetti.running && np.confetti.moved, np.confetti.sample);
  if (mode === "before") {
    record("BUG REPRODUCED: reduce suppresses the magnifier (0.01ms, ends at once, glass parked)", !rd.magnifier.running && rd.magnifier.suppressed, rd.magnifier.sample);
    record("BUG REPRODUCED: reduce suppresses the confetti (0.01ms, already finished, pieces parked/transparent)", !rd.confetti.running && rd.confetti.suppressed, rd.confetti.sample);
  } else {
    record("FIX: reduce -> magnifier STILL runs (decorative animation exempted)", rd.magnifier.running && rd.magnifier.moved, rd.magnifier.sample);
    record("FIX: reduce -> confetti STILL runs", rd.confetti.running && rd.confetti.moved, rd.confetti.sample);
  }
  record("control: bell-shake runs under no-preference (1800ms infinite)", !!np.bellShake && np.bellShake.duration > 1000, np.bellShake);
  record("control: bell-shake stays SUPPRESSED under reduce (every other animation keeps honoring the preference)", !!rd.bellShake && rd.bellShake.duration < 1 && rd.bellShake.iterations === 1, rd.bellShake);
} finally {
  await cleanupOrgs(orgs);
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
