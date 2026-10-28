/**
 * The side menu has one item per AREA (Painel, Frota, Manutenção, Portaria, Equipe, Viagens, Configurações). What used to be separate menu items
 * (Motoristas, Energia, Chaves, Planejamento, Histórico da Portaria, Analytics, Administração...) are SECTIONS of an area and appear as tabs at the
 * top of the area's screens. Pure rules, used by the shell; no I/O.
 */
export type SectionId = "team" | "fleet" | "trips" | "dashboard" | "settings";

/** Menu keys that are no longer menu items: they are tabs of an area (or already have their own tabs: maintenance, gate). */
export const TAB_ONLY_KEYS = [
  "planning", "orders", "vehicleHistory", // Manutenção: its own tabs
  "gateExceptions", "gateHistory", // Portaria: its own tabs
  "energy", "incidents", "keyManagement", "drivers", "carpool", // Frota / Equipe / Viagens tabs
  "analytics", "admin", // Painel / Configurações tabs
  "book", "myCarpools", // Viagens tabs
] as const;

/** Which menu item is "current" for a screen that reports `active` (a tab-only key belongs to its area's item). */
export function menuKeyFor(active: string): string {
  switch (active) {
    case "drivers": return "team";
    case "planning": case "orders": case "vehicleHistory": return "maintenance";
    case "gateExceptions": case "gateHistory": return "gate";
    case "energy": case "incidents": case "keyManagement": case "carpool": return "fleet";
    case "book": case "myCarpools": return "trips";
    case "analytics": return "dashboard";
    case "admin": return "settings";
    default: return active;
  }
}

/** The area whose tabs a screen shows (null: no tabs; maintenance and gate already have their own). */
export function sectionFor(active: string, isFleetManager: boolean): SectionId | null {
  // "carpool" is the rider's "Buscar carona" for a plain user and the managers' "Gestão de caronas" for a fleet manager
  if (active === "carpool") return isFleetManager ? "fleet" : "trips";
  switch (menuKeyFor(active)) {
    case "team": return isFleetManager ? "team" : null;
    case "fleet": return isFleetManager ? "fleet" : null;
    case "trips": return "trips";
    case "dashboard": return isFleetManager ? "dashboard" : null;
    case "settings": return isFleetManager ? "settings" : null;
    default: return null;
  }
}

export interface TabDef {
  id: string;
  href: string;
  visible: boolean;
}

export function sectionTabs(section: SectionId, f: { isAdministrator: boolean }): TabDef[] {
  const a = f.isAdministrator;
  switch (section) {
    case "team":
      return [
        { id: "people", href: "/settings/users", visible: a },
        { id: "drivers", href: "/fleet/drivers", visible: true },
        { id: "contact", href: "/settings/approvals", visible: a },
      ].filter((t) => t.visible);
    case "fleet":
      return [
        { id: "vehicles", href: "/fleet", visible: true },
        { id: "carpools", href: "/fleet/carpools", visible: true },
        { id: "energy", href: "/fleet/energy", visible: true },
        { id: "keys", href: "/fleet/keys", visible: true },
        { id: "incidents", href: "/fleet/incidents", visible: true },
      ];
    case "trips":
      return [
        { id: "book", href: "/trips/new", visible: true },
        { id: "mine", href: "/trips", visible: true },
        { id: "myCarpools", href: "/carpool/mine", visible: true },
        { id: "find", href: "/carpool", visible: true },
      ];
    case "dashboard":
      return [
        { id: "overview", href: "/dashboard/command-center", visible: true },
        { id: "reports", href: "/analytics", visible: true },
        { id: "carpoolReports", href: "/analytics/carpool", visible: true },
      ];
    case "settings":
      return [
        { id: "policies", href: "/settings", visible: true },
        { id: "adminOverview", href: "/admin", visible: a },
        { id: "integrations", href: "/admin/integrations", visible: a },
        { id: "audit", href: "/admin/audit", visible: a },
        { id: "ai", href: "/admin/ai", visible: a },
        { id: "units", href: "/admin/units", visible: a },
        { id: "mobility", href: "/settings/mobility-points", visible: true },
      ].filter((t) => t.visible);
  }
}

/** The tab for a path: the exact one, else the longest tab path that contains it ("/fleet/energy/x" -> "/fleet/energy"). */
export function activeTabHref(tabs: readonly { href: string }[], pathname: string): string | null {
  let best: string | null = null;
  for (const t of tabs) {
    if (pathname === t.href || pathname.startsWith(`${t.href}/`)) {
      if (best === null || t.href.length > best.length) best = t.href;
    }
  }
  return best;
}
