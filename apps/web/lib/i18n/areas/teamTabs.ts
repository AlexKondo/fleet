import type { AreaTexts } from "../areaText";

/** The three sections of "Equipe" (people and roles, drivers and license, direct manager and WhatsApp): one place, one menu item. */
type K = "aria" | "people" | "drivers" | "contact";

export const teamTabsTexts: AreaTexts<K> = {
  "pt-BR": { aria: "Seções da equipe", people: "Pessoas e perfis", drivers: "Motoristas e CNH", contact: "Gestor e WhatsApp" },
  "en-US": { aria: "Team sections", people: "People and roles", drivers: "Drivers and license", contact: "Manager and WhatsApp" },
  es: { aria: "Secciones del equipo", people: "Personas y perfiles", drivers: "Conductores y licencia", contact: "Gestor y WhatsApp" },
  "zh-CN": { aria: "团队栏目", people: "人员与角色", drivers: "司机与驾照", contact: "主管与WhatsApp" },
};
