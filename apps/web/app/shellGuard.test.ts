import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FIX-VISUAL guard: every authenticated screen renders inside the FleetMind shell (FmShell). The legacy AppShell
 * (black sidebar + uppercase page title such as "VIAGEM") must not come back through a page or through a component
 * that a page imports directly. A page that genuinely has to keep it goes into ALLOWED with a justification.
 */
const ALLOWED: Record<string, string> = {};

const appDir = path.resolve(__dirname);
const rel = (p: string) => path.relative(appDir, p).split(path.sep).join("/");

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (/^(page|layout|error|loading|not-found|template)\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

function directImports(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1]!;
    let base: string | null = null;
    if (spec.startsWith("@/app/")) base = path.join(appDir, spec.slice("@/app/".length));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(file), spec);
    if (!base) continue;
    for (const ext of [".tsx", "/index.tsx"]) {
      if (existsSync(base + ext)) {
        out.push(base + ext);
        break;
      }
    }
  }
  return out;
}

const usesAppShell = (src: string) => /<AppShell\b/.test(src);

describe("shell guard: no route renders the legacy AppShell", () => {
  const files = routeFiles(appDir);

  it("finds the route files (sanity)", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.map(rel)).toContain("reservations/[id]/page.tsx");
  });

  it("no page/layout/error/loading (nor a component it imports directly) renders <AppShell outside the allow-list", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const r = rel(f);
      if (usesAppShell(src) && !ALLOWED[r]) offenders.push(r);
      for (const dep of directImports(f, src)) {
        if (/AppShell\.tsx$/.test(dep)) continue;
        if (usesAppShell(readFileSync(dep, "utf8")) && !ALLOWED[rel(dep)]) offenders.push(`${r} -> ${rel(dep)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allow-list is empty (every route was migrated to FmShell)", () => {
    expect(Object.keys(ALLOWED)).toEqual([]);
  });

  it("the reservation detail no longer branches the shell by role", () => {
    const src = readFileSync(path.join(appDir, "reservations/[id]/page.tsx"), "utf8");
    expect(src).not.toMatch(/import\s*\{\s*AppShell\s*\}/);
    expect(src.match(/<FmShell\b/g)?.length).toBe(1);
  });
});
