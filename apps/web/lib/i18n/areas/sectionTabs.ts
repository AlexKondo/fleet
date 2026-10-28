import type { AreaTexts } from "../areaText";

/** Tab labels of the areas of the side menu (see lib/nav/sections.ts). */
type K =
  | "aria"
  | "people" | "drivers" | "contact"
  | "vehicles" | "carpools" | "energy" | "keys" | "incidents"
  | "book" | "mine" | "myCarpools" | "find"
  | "overview" | "reports" | "carpoolReports"
  | "queue" | "exceptions" | "history"
  | "policies" | "adminOverview" | "integrations" | "audit" | "ai" | "units" | "mobility";

export const sectionTabsTexts: AreaTexts<K> = {
  "pt-BR": {
    aria: "Seções desta área",
    people: "Pessoas e perfis", drivers: "Motoristas e CNH", contact: "Gestor e WhatsApp",
    vehicles: "Veículos", carpools: "Caronas", energy: "Energia e recarga", keys: "Chaves", incidents: "Ocorrências e checklists",
    book: "Reservar veículo", mine: "Minhas viagens", myCarpools: "Minhas caronas", find: "Buscar carona",
    overview: "Visão geral", reports: "Relatórios", carpoolReports: "Caronas",
    queue: "Movimentações", exceptions: "Ocorrências da Portaria", history: "Histórico",
    policies: "Políticas", adminOverview: "Administração", integrations: "Integrações", audit: "Auditoria e privacidade", ai: "Governança de IA", units: "Unidades e chaves", mobility: "Locais de mobilidade",
  },
  "en-US": {
    aria: "Sections of this area",
    people: "People and roles", drivers: "Drivers and license", contact: "Manager and WhatsApp",
    vehicles: "Vehicles", carpools: "Carpools", energy: "Energy and charging", keys: "Keys", incidents: "Incidents and checklists",
    book: "Book a vehicle", mine: "My trips", myCarpools: "My carpools", find: "Find a carpool",
    overview: "Overview", reports: "Reports", carpoolReports: "Carpools",
    queue: "Movements", exceptions: "Gate incidents", history: "History",
    policies: "Policies", adminOverview: "Administration", integrations: "Integrations", audit: "Audit and privacy", ai: "AI governance", units: "Units and keys", mobility: "Mobility places",
  },
  es: {
    aria: "Secciones de esta área",
    people: "Personas y perfiles", drivers: "Conductores y licencia", contact: "Gestor y WhatsApp",
    vehicles: "Vehículos", carpools: "Viajes compartidos", energy: "Energía y recarga", keys: "Llaves", incidents: "Incidencias y checklists",
    book: "Reservar vehículo", mine: "Mis viajes", myCarpools: "Mis viajes compartidos", find: "Buscar viaje compartido",
    overview: "Resumen", reports: "Informes", carpoolReports: "Viajes compartidos",
    queue: "Movimientos", exceptions: "Incidencias de portería", history: "Historial",
    policies: "Políticas", adminOverview: "Administración", integrations: "Integraciones", audit: "Auditoría y privacidad", ai: "Gobernanza de IA", units: "Unidades y llaves", mobility: "Lugares de movilidad",
  },
  "zh-CN": {
    aria: "本栏目分区",
    people: "人员与角色", drivers: "司机与驾照", contact: "主管与WhatsApp",
    vehicles: "车辆", carpools: "拼车", energy: "能源与充电", keys: "钥匙", incidents: "事件与检查清单",
    book: "预订车辆", mine: "我的行程", myCarpools: "我的拼车", find: "查找拼车",
    overview: "概览", reports: "报表", carpoolReports: "拼车",
    queue: "出入记录", exceptions: "门岗事件", history: "历史",
    policies: "政策", adminOverview: "管理", integrations: "集成", audit: "审计与隐私", ai: "AI 治理", units: "单位与钥匙", mobility: "出行地点",
  },
};
