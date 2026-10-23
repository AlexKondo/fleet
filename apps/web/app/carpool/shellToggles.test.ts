import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Language and theme controls must be on EVERY authenticated screen (the topbar lives in FmShell), and the FleetMind look must
 * really have a dark theme (otherwise the toggle would do nothing).
 */
const read = (f: string) => readFileSync(path.resolve("app", f), "utf8");

describe("topbar toggles", () => {
  const shell = read("carpool/FmShell.tsx");
  it("the language toggle is always rendered in the topbar", () => {
    expect(shell).toMatch(/<LanguageToggle locale=\{locale\} dict=\{dict\} \/>/);
  });
  it("the theme toggle is rendered on every screen, including the `legacy` ones (no condition around it)", () => {
    expect(shell).toMatch(/<ThemeToggle dict=\{dict\} \/>/);
    expect(shell).not.toMatch(/legacy\s*\?\s*null\s*:\s*<ThemeToggle/);
  });
  it("the language button shows the current language code next to the globe", () => {
    expect(read("ui/LanguageToggle.tsx")).toContain('data-testid="language-code"');
  });
});

describe("FleetMind dark theme", () => {
  const css = read("carpool/fm-theme.css");
  it("defines dark tokens for the .fm-theme wrapper and the derived palette for the hard-coded light colours", () => {
    expect(css).toContain(':root[data-theme="dark"] .fm-theme {');
    expect(css).toContain("--fm-surface: #142036");
    expect(css).toContain("generated palette");
    expect(css.match(/--lt-[0-9a-f]{6}:/g)!.length).toBeGreaterThan(200);
  });
  it("every --lt-xxxxxx used by the stylesheets has both a light and a dark definition", () => {
    const files = ["carpool/fm-theme.css", "carpool/fm-shared.css", "fm-ops.css", "fleet/vehicle-workspace.css", "operations/operations.css", "trips/new/reservar.css", "dashboard/home.css", "dashboard/command-center/command-center.css"];
    const used = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/var\(--lt-([0-9a-f]{6})/g)) used.add(m[1]!);
    const block = css.slice(css.indexOf("generated palette"));
    const lightPart = block.slice(0, block.indexOf(':root[data-theme="dark"]'));
    const darkPart = block.slice(block.indexOf(':root[data-theme="dark"]'));
    for (const c of used) {
      expect(lightPart, `light ${c}`).toContain(`--lt-${c}: #${c};`);
      expect(darkPart, `dark ${c}`).toContain(`--lt-${c}: #`);
    }
  });
});
