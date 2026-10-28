import { describe, expect, it } from "vitest";
import { activeTabHref, menuKeyFor, sectionFor, sectionTabs, TAB_ONLY_KEYS } from "./sections";
import { sectionTabsTexts } from "../i18n/areas/sectionTabs";

describe("one menu item per area", () => {
  it("a screen that used to be a menu item is a tab of its area: the area's item is the current one", () => {
    expect(menuKeyFor("drivers")).toBe("team");
    for (const k of ["planning", "orders", "vehicleHistory"]) expect(menuKeyFor(k)).toBe("maintenance");
    for (const k of ["gateExceptions", "gateHistory"]) expect(menuKeyFor(k)).toBe("gate");
    for (const k of ["energy", "incidents", "keyManagement", "carpool"]) expect(menuKeyFor(k)).toBe("fleet");
    for (const k of ["book", "myCarpools"]) expect(menuKeyFor(k)).toBe("trips");
    expect(menuKeyFor("analytics")).toBe("dashboard");
    expect(menuKeyFor("admin")).toBe("settings");
    expect(menuKeyFor("team")).toBe("team");
  });
  it("tab-only keys never include an area's own item", () => {
    for (const area of ["dashboard", "fleet", "maintenance", "gate", "team", "trips", "settings"]) expect(TAB_ONLY_KEYS as readonly string[]).not.toContain(area);
  });
  it("tabs belong to the right area; maintenance and gate keep their own tabs; a plain user has only Viagens", () => {
    expect(sectionFor("team", true)).toBe("team");
    expect(sectionFor("drivers", true)).toBe("team");
    expect(sectionFor("energy", true)).toBe("fleet");
    expect(sectionFor("carpool", true)).toBe("fleet"); // Gestão de caronas
    expect(sectionFor("carpool", false)).toBe("trips"); // Buscar carona
    expect(sectionFor("analytics", true)).toBe("dashboard");
    expect(sectionFor("admin", true)).toBe("settings");
    for (const k of ["maintenance", "planning", "orders", "vehicleHistory", "gate", "gateHistory"]) expect(sectionFor(k, true), k).toBeNull();
    for (const k of ["team", "fleet", "dashboard", "settings", "analytics"]) expect(sectionFor(k, false), k).toBeNull();
    expect(sectionFor("trips", false)).toBe("trips");
  });
});

describe("tabs", () => {
  it("administration tabs are for the administrator; the fleet manager keeps Políticas and Locais de mobilidade, and Motoristas", () => {
    expect(sectionTabs("settings", { isAdministrator: true }).map((t) => t.id)).toEqual(["policies", "adminOverview", "integrations", "audit", "ai", "units", "mobility"]);
    expect(sectionTabs("settings", { isAdministrator: false }).map((t) => t.id)).toEqual(["policies", "mobility"]);
    expect(sectionTabs("team", { isAdministrator: false }).map((t) => t.id)).toEqual(["drivers"]);
    expect(sectionTabs("team", { isAdministrator: true }).map((t) => t.id)).toEqual(["people", "drivers", "contact"]);
  });
  it("every tab has a label in every language", () => {
    for (const section of ["team", "fleet", "trips", "dashboard", "settings"] as const) {
      for (const t of sectionTabs(section, { isAdministrator: true })) {
        for (const lang of ["pt-BR", "en-US", "es", "zh-CN"] as const) expect((sectionTabsTexts[lang] as Record<string, string>)[t.id], `${section}.${t.id}.${lang}`).toBeTruthy();
      }
    }
  });
  it("the current tab is the exact address, else the longest tab that contains it", () => {
    const tabs = sectionTabs("fleet", { isAdministrator: false });
    expect(activeTabHref(tabs, "/fleet")).toBe("/fleet");
    expect(activeTabHref(tabs, "/fleet/energy")).toBe("/fleet/energy");
    expect(activeTabHref(tabs, "/fleet/vehicles/abc")).toBe("/fleet");
    expect(activeTabHref(tabs, "/fleet/energy/x")).toBe("/fleet/energy");
    expect(activeTabHref(tabs, "/settings")).toBeNull();
  });
});
