import type { AreaTexts } from "../areaText";

/** Screen /approvals ("Aprovar reservas"): the direct manager decides inside the platform. Labels and outcome messages are shared with approvalEmail.ts. */
type K = "title" | "subtitle" | "empty" | "count" | "validUntil" | "requestedAt";

export const approvalsInAppTexts: AreaTexts<K> = {
  "pt-BR": {
    title: "Aprovar reservas",
    subtitle: "Pedidos de reserva de veículo das pessoas que você gerencia. Aprovar libera o veículo; recusar cancela a reserva e avisa o solicitante.",
    empty: "Nenhum pedido aguardando a sua aprovação.",
    count: "{count} pedido(s) aguardando a sua decisão",
    validUntil: "Vale até",
    requestedAt: "Pedido em",
  },
  "en-US": {
    title: "Approve bookings",
    subtitle: "Vehicle booking requests from the people you manage. Approving releases the vehicle; rejecting cancels the booking and notifies the requester.",
    empty: "No requests waiting for your approval.",
    count: "{count} request(s) waiting for your decision",
    validUntil: "Valid until",
    requestedAt: "Requested on",
  },
  es: {
    title: "Aprobar reservas",
    subtitle: "Solicitudes de reserva de vehículo de las personas que gestionas. Aprobar libera el vehículo; rechazar cancela la reserva y avisa al solicitante.",
    empty: "Ninguna solicitud espera tu aprobación.",
    count: "{count} solicitud(es) esperando tu decisión",
    validUntil: "Vale hasta",
    requestedAt: "Solicitado el",
  },
  "zh-CN": {
    title: "审批预订",
    subtitle: "您所管理人员的用车预订申请。批准即放行车辆；拒绝将取消预订并通知申请人。",
    empty: "没有等待您审批的申请。",
    count: "{count} 个申请等待您的决定",
    validUntil: "有效至",
    requestedAt: "申请时间",
  },
};
