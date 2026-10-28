import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clampSidebarWidth, parseSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, sidebarCookieName } from "./sidebarWidth";

describe("side menu width", () => {
  it("is kept between the minimum and the maximum, and unreadable values fall back to the default", () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(251.6)).toBe(252);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
    expect(parseSidebarWidth("310")).toBe(310);
    expect(parseSidebarWidth("999")).toBe(SIDEBAR_MAX);
    for (const bad of [undefined, null, "", "abc", "24", "12345", "310px", "-300"]) expect(parseSidebarWidth(bad as string | undefined), String(bad)).toBe(SIDEBAR_DEFAULT);
  });
  it("is saved per user: one cookie name per user id, made only of safe characters", () => {
    const a = sidebarCookieName("8f181904-4536-4f3b-b653-727016ff3150");
    const b = sidebarCookieName("b3276548-fabf-41ac-96d8-764b6b1d4fd1");
    expect(a).not.toBe(b);
    expect(a).toBe("fm_sidebar_w_8f181904-4536-4f3b-b653-727016ff3150");
    expect(sidebarCookieName('x; path=/; evil=1')).toBe("fm_sidebar_w_xpathevil1");
    expect(sidebarCookieName(null)).toBe("fm_sidebar_w_anon");
  });
});

describe("one side menu on every screen", () => {
  const read = (f: string) => readFileSync(path.resolve("app", f), "utf8");
  it("the operations / manager screens no longer have their own menu or top bar layout", () => {
    const ops = read("operations/operations.css");
    expect(ops).not.toMatch(/\.fm-workspace-operations\s+\.fm-(sidebar|nav|topbar|brand)/);
    expect(ops).not.toMatch(/\.fm-workspace-manager\s+\.fm-(sidebar|nav)/);
  });
  it("the operations screens set nothing on the shell root: the menu colour and the assistant box are the shell's own", () => {
    const ops = read("operations/operations.css");
    expect(ops).not.toMatch(/\.fm-workspace\s*\{[^}]*--fm-/);
    expect(ops).not.toMatch(/\.fm-workspace\s*\{[^}]*font-size/);
  });
  it("the width comes from one variable (default 240) and the shell draws the saved width with a resize handle", () => {
    expect(read("carpool/fm-theme.css")).toMatch(/\.fm-sidebar\s*\{[^}]*width:\s*var\(--fm-sidebar-w,\s*240px\)/s);
    const shell = read("carpool/FmShell.tsx");
    expect(shell).toContain("<SidebarResizer");
    expect(shell).toContain('"--fm-sidebar-w"');
    expect(shell).toContain("sidebarCookieName(userId)");
  });
});
