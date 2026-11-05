import type { AreaTexts } from "../areaText";

export type DashboardMiscKey =
  | "energyUnavailable" | "battery" | "fuel"
  | "leftByPassenger" | "carpoolOrgScope";

/** Small leftovers of dashboard / trips / analytics screens (the rest of those screens uses the shared dictionaries). */
export const dashboardMiscTexts: AreaTexts<DashboardMiscKey> = {
  "pt-BR": {
    energyUnavailable: "Dado de energia indisponível",
    battery: "Carga da bateria",
    fuel: "Nível de combustível",
    leftByPassenger: "Cancelada pelo passageiro",
    carpoolOrgScope: "Os registros históricos de busca e provedor não possuem atribuição confiável por unidade. Esta consulta organizacional está restrita à gestão central.",
  },
  "en-US": {
    energyUnavailable: "Energy data unavailable",
    battery: "Battery charge",
    fuel: "Fuel level",
    leftByPassenger: "Cancelled by the passenger",
    carpoolOrgScope: "Historical search and provider records have no reliable attribution by unit. This organization-wide query is restricted to central management.",
  },
  es: {
    energyUnavailable: "Dato de energía no disponible",
    battery: "Carga de la batería",
    fuel: "Nivel de combustible",
    leftByPassenger: "Cancelada por el pasajero",
    carpoolOrgScope: "Los registros históricos de búsqueda y de proveedor no tienen una atribución confiable por unidad. Esta consulta organizacional está restringida a la gestión central.",
  },
  "zh-CN": {
    energyUnavailable: "能源数据不可用",
    battery: "电池电量",
    fuel: "燃油量",
    leftByPassenger: "已被乘客取消",
    carpoolOrgScope: "历史搜索和服务商记录无法可靠地按单位归属。此组织级查询仅限中央管理人员使用。",
  },
};
