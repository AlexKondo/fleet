import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { needsAttention, REVIEW_NEAR } from "./attention";

const page = readFileSync(path.resolve("app/dashboard/page.tsx"), "utf8");
const css = readFileSync(path.resolve("app/fm-ops.css"), "utf8");

describe("which vehicles need attention", () => {
  it("a vehicle with any reason other than 'maintenance due soon' needs attention", () => {
    expect(needsAttention(["cleaning_required"])).toBe(true);
    expect(needsAttention(["energy_low", REVIEW_NEAR])).toBe(true);
    expect(needsAttention(["damage_blocking_trip"])).toBe(true);
  });
  it("no reasons, or only 'maintenance due soon' (shown by Próximas manutenções), is not attention", () => {
    expect(needsAttention([])).toBe(false);
    expect(needsAttention([REVIEW_NEAR])).toBe(false);
  });
});

describe("the 'Veículos que precisam de atenção' card of the Painel", () => {
  it("takes the person to the vehicle cards, not to the list that is already on the screen", () => {
    const kpi = /<a href="([^"]+)" className="fm-kpi" data-testid="cc-kpi-attention">/.exec(page);
    expect(kpi?.[1]).toBe("#fleet-vehicles");
    expect(page).toMatch(/<section className="[^"]*" id="fleet-vehicles">/);
  });
  it("the number, the list and the glow use the same rule", () => {
    expect(page).toContain("vehiclesWithAttention.filter((v) => needsAttention(v.attention)).length");
    expect(page).toContain('data-attention={needsAttention(attention) ? "true" : undefined}');
    expect(page).not.toMatch(/const REVIEW_NEAR\b/);
  });
  it("a vehicle card that needs attention glows orange", () => {
    const rule = /\.cc-fleet-grid \[data-card\]\[data-attention="true"\] \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("border-color: #ff8c1a");
    expect(rule).toContain("box-shadow:");
    expect(rule).toContain("255, 140, 26");
  });
  it("…and the rule outweighs the theme's own list-card rule, which sets the shadow (otherwise the glow never shows)", () => {
    const theme = 'ul[class*="grid"] > li[class*="border-line-800"][class*="rounded"]';
    expect(css).toContain(`.fm-theme .fm-legacy ${theme}[data-card][data-attention="true"]`);
    // the stronger rule comes after the theme's, so it also wins a tie
    expect(css.indexOf(`${theme}[data-card][data-attention="true"]`)).toBeGreaterThan(css.indexOf(`.fm-theme .fm-legacy ${theme} {`));
  });
});
