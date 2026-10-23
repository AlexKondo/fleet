import type { AreaTexts } from "../areaText";

export type FleetKeysKey =
  | "title" | "subtitle" | "configure" | "unavailable" | "panel" | "intro" | "none" | "thUnit" | "thDriver" | "thPeriod" | "thKeys"
  | "received" | "receiptPending" | "deliveryPending" | "cancelled";

export const fleetKeysTexts: AreaTexts<FleetKeysKey> = {
  "pt-BR": {
    title: "Acompanhamento das chaves", subtitle: "Acompanhe a custódia local e as exceções, mantendo a confirmação física com o responsável da unidade.",
    configure: "Configurar unidades e responsáveis", unavailable: "Não foi possível consultar a custódia. Nenhum estado foi presumido.",
    panel: "Reservas e chaves pendentes",
    intro: "Reservas nos próximos sete dias e chaves entregues sem recebimento confirmado, inclusive de reservas canceladas. Esta visão não confirma entrega ou recebimento à distância.",
    none: "Nenhuma reserva nesta janela e nenhuma chave pendente.", thUnit: "Unidade / veículo", thDriver: "Condutor", thPeriod: "Período", thKeys: "Chaves",
    received: "Recebidas", receiptPending: "Recebimento pendente", deliveryPending: "Entrega pendente", cancelled: " · Reserva cancelada",
  },
  "en-US": {
    title: "Key tracking", subtitle: "Track local custody and exceptions, keeping the physical confirmation with the unit's person in charge.",
    configure: "Configure units and custodians", unavailable: "Custody could not be retrieved. No state was assumed.",
    panel: "Reservations and pending keys",
    intro: "Reservations in the next seven days and keys handed over without confirmed receipt, including canceled reservations. This view does not confirm handover or receipt remotely.",
    none: "No reservations in this window and no pending keys.", thUnit: "Unit / vehicle", thDriver: "Driver", thPeriod: "Period", thKeys: "Keys",
    received: "Received", receiptPending: "Receipt pending", deliveryPending: "Handover pending", cancelled: " · Reservation canceled",
  },
  es: {
    title: "Seguimiento de llaves", subtitle: "Siga la custodia local y las excepciones, manteniendo la confirmación física con el responsable de la unidad.",
    configure: "Configurar unidades y responsables", unavailable: "No fue posible consultar la custodia. No se presumió ningún estado.",
    panel: "Reservas y llaves pendientes",
    intro: "Reservas de los próximos siete días y llaves entregadas sin recepción confirmada, incluso de reservas canceladas. Esta vista no confirma la entrega ni la recepción a distancia.",
    none: "Ninguna reserva en esta ventana y ninguna llave pendiente.", thUnit: "Unidad / vehículo", thDriver: "Conductor", thPeriod: "Período", thKeys: "Llaves",
    received: "Recibidas", receiptPending: "Recepción pendiente", deliveryPending: "Entrega pendiente", cancelled: " · Reserva cancelada",
  },
  "zh-CN": {
    title: "钥匙跟踪", subtitle: "跟踪本地保管与异常情况，实物确认仍由单位负责人完成。",
    configure: "配置单位和负责人", unavailable: "无法查询保管情况。未假定任何状态。",
    panel: "预订与待处理钥匙",
    intro: "未来七天的预订，以及已交出但未确认接收的钥匙（包括已取消的预订）。此视图不能远程确认交接或接收。",
    none: "此时段没有预订，也没有待处理钥匙。", thUnit: "单位 / 车辆", thDriver: "驾驶员", thPeriod: "时段", thKeys: "钥匙",
    received: "已接收", receiptPending: "待接收", deliveryPending: "待交付", cancelled: " · 预订已取消",
  },
};
