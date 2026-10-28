import type { AreaTexts } from "../areaText";

/** Public confirmation page /aprovar/<token> opened from the approval e-mail. */
type K =
  | "title" | "intro" | "requester" | "vehicle" | "departure" | "returnAt" | "origin" | "destination" | "purpose" | "passengers"
  | "validUntil" | "approve" | "reject" | "noteSafe"
  | "doneApproved" | "doneRejected" | "alreadyDecided" | "expired" | "superseded" | "invalid" | "unavailable" | "notAuthorized" | "genericError"
  | "backHint";

export const approvalEmailTexts: AreaTexts<K> = {
  "pt-BR": {
    title: "Pedido de uso de veículo",
    intro: "{name} pediu um veículo e aguarda a sua decisão.",
    requester: "Solicitante", vehicle: "Veículo", departure: "Saída", returnAt: "Retorno", origin: "Origem", destination: "Destino",
    purpose: "Objetivo", passengers: "Passageiros", validUntil: "Este pedido vale até",
    approve: "Aprovar", reject: "Recusar",
    noteSafe: "Nada é decidido ao abrir esta página: só quando você tocar em Aprovar ou Recusar.",
    doneApproved: "Aprovado. O veículo foi liberado para o solicitante, que já foi avisado.",
    doneRejected: "Recusado. A reserva foi cancelada e o solicitante foi avisado.",
    alreadyDecided: "Este pedido já foi respondido. Nada foi alterado.",
    expired: "Este pedido expirou. O solicitante precisa fazer um novo pedido.",
    superseded: "Este pedido já foi tratado por outra pessoa no sistema. Nada foi alterado.",
    invalid: "Link inválido ou já usado.",
    unavailable: "Não foi possível liberar: o veículo não está disponível. Fale com a gestão da frota.",
    notAuthorized: "Você não pode decidir este pedido. Se precisar, aprove pelo sistema FleetMind.",
    genericError: "Não foi possível processar agora. Tente novamente em instantes.",
    backHint: "Você pode fechar esta página.",
  },
  "en-US": {
    title: "Vehicle request",
    intro: "{name} requested a vehicle and is waiting for your decision.",
    requester: "Requester", vehicle: "Vehicle", departure: "Departure", returnAt: "Return", origin: "Origin", destination: "Destination",
    purpose: "Purpose", passengers: "Passengers", validUntil: "This request is valid until",
    approve: "Approve", reject: "Reject",
    noteSafe: "Nothing is decided by opening this page: only when you tap Approve or Reject.",
    doneApproved: "Approved. The vehicle was released to the requester, who has been notified.",
    doneRejected: "Rejected. The booking was cancelled and the requester was notified.",
    alreadyDecided: "This request was already answered. Nothing was changed.",
    expired: "This request has expired. The requester needs to make a new request.",
    superseded: "This request was already handled by someone else in the system. Nothing was changed.",
    invalid: "Invalid or already used link.",
    unavailable: "Could not release: the vehicle is not available. Contact fleet management.",
    notAuthorized: "You cannot decide this request. If needed, approve it in the FleetMind system.",
    genericError: "Could not process right now. Please try again in a moment.",
    backHint: "You can close this page.",
  },
  es: {
    title: "Solicitud de uso de vehículo",
    intro: "{name} pidió un vehículo y espera tu decisión.",
    requester: "Solicitante", vehicle: "Vehículo", departure: "Salida", returnAt: "Regreso", origin: "Origen", destination: "Destino",
    purpose: "Objetivo", passengers: "Pasajeros", validUntil: "Esta solicitud vale hasta",
    approve: "Aprobar", reject: "Rechazar",
    noteSafe: "No se decide nada al abrir esta página: solo cuando toques Aprobar o Rechazar.",
    doneApproved: "Aprobado. El vehículo fue liberado para el solicitante, que ya fue avisado.",
    doneRejected: "Rechazado. La reserva fue cancelada y se avisó al solicitante.",
    alreadyDecided: "Esta solicitud ya fue respondida. No se cambió nada.",
    expired: "Esta solicitud expiró. El solicitante debe hacer una nueva solicitud.",
    superseded: "Esta solicitud ya fue tratada por otra persona en el sistema. No se cambió nada.",
    invalid: "Enlace no válido o ya usado.",
    unavailable: "No se pudo liberar: el vehículo no está disponible. Habla con la gestión de la flota.",
    notAuthorized: "No puedes decidir esta solicitud. Si es necesario, apruébala en el sistema FleetMind.",
    genericError: "No se pudo procesar ahora. Inténtalo de nuevo en un momento.",
    backHint: "Puedes cerrar esta página.",
  },
  "zh-CN": {
    title: "用车申请",
    intro: "{name} 申请了一辆车，等待您的决定。",
    requester: "申请人", vehicle: "车辆", departure: "出发", returnAt: "返回", origin: "出发地", destination: "目的地",
    purpose: "用途", passengers: "乘客", validUntil: "本申请有效至",
    approve: "批准", reject: "拒绝",
    noteSafe: "打开此页面不会做出任何决定：只有您点击“批准”或“拒绝”时才生效。",
    doneApproved: "已批准。车辆已放行给申请人，并已通知对方。",
    doneRejected: "已拒绝。预订已取消，并已通知申请人。",
    alreadyDecided: "此申请已被答复。未做任何更改。",
    expired: "此申请已过期。申请人需要重新提交。",
    superseded: "此申请已由系统内的其他人处理。未做任何更改。",
    invalid: "链接无效或已使用。",
    unavailable: "无法放行：车辆不可用。请联系车队管理。",
    notAuthorized: "您无权决定此申请。如有需要，请在 FleetMind 系统内审批。",
    genericError: "暂时无法处理，请稍后重试。",
    backHint: "您可以关闭此页面。",
  },
};

/** Status returned by the database -> key of the message shown after a decision. */
export function emailStatusKey(status: string): K {
  switch (status) {
    case "approved": return "doneApproved";
    case "rejected": return "doneRejected";
    case "already_decided": return "alreadyDecided";
    case "expired": return "expired";
    case "superseded": return "superseded";
    case "vehicle_unavailable": return "unavailable";
    case "not_authorized": case "phone_mismatch": return "notAuthorized";
    case "invalid": return "invalid";
    default: return "genericError";
  }
}
