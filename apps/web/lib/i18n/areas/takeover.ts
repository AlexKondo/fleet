import type { AreaTexts } from "../areaText";

/** The carpool takeover card on the reservation page (app/reservations/[id]/TakeoverCard.tsx). */
type K = "inviteTitle" | "inviteBody" | "accept" | "decline" | "deadline" | "waitingTitle" | "waitingBody" | "passedTitle" | "passedBody" | "failed";

export const takeoverTexts: AreaTexts<K> = {
  "pt-BR": {
    inviteTitle: "Convite para assumir esta reserva",
    inviteBody: "{name} cancelou a viagem e a reserva passou para você. Você aceita ficar com o veículo? Se aceitar, o pedido vai para o seu gestor aprovar e o veículo continua reservado.",
    accept: "Aceitar a reserva",
    decline: "Recusar",
    deadline: "Responda até {date}.",
    waitingTitle: "Aguardando a aprovação do gestor",
    waitingBody: "Você aceitou a reserva. Ela fica reservada para você e será sua assim que o gestor aprovar.",
    passedTitle: "Sua reserva foi repassada",
    passedBody: "A reserva foi repassada para {name}, que precisa aceitar e ter o gestor aprovando. Se ninguém assumir, ela será cancelada.",
    failed: "Não foi possível registrar a sua resposta. Confira a CNH e se você tem outra reserva no mesmo horário, ou o prazo.",
  },
  "en-US": {
    inviteTitle: "Invitation to take over this reservation",
    inviteBody: "{name} cancelled the trip and the reservation was passed to you. Do you accept the vehicle? If you do, the request goes to your manager for approval and the vehicle stays reserved.",
    accept: "Accept the reservation",
    decline: "Decline",
    deadline: "Answer by {date}.",
    waitingTitle: "Waiting for the manager's approval",
    waitingBody: "You accepted the reservation. It stays reserved for you and becomes yours as soon as your manager approves.",
    passedTitle: "Your reservation was passed on",
    passedBody: "The reservation was passed to {name}, who has to accept it and get the manager's approval. If nobody takes it, it will be cancelled.",
    failed: "Your answer could not be recorded. Check your licence, another reservation at the same time, or the deadline.",
  },
  es: {
    inviteTitle: "Invitación para asumir esta reserva",
    inviteBody: "{name} canceló el viaje y la reserva pasó a usted. ¿Acepta el vehículo? Si acepta, la solicitud va a su gestor para aprobación y el vehículo sigue reservado.",
    accept: "Aceptar la reserva",
    decline: "Rechazar",
    deadline: "Responda hasta {date}.",
    waitingTitle: "Esperando la aprobación del gestor",
    waitingBody: "Usted aceptó la reserva. Queda reservada para usted y será suya en cuanto el gestor la apruebe.",
    passedTitle: "Su reserva fue traspasada",
    passedBody: "La reserva fue traspasada a {name}, que debe aceptarla y tener la aprobación del gestor. Si nadie la asume, se cancelará.",
    failed: "No fue posible registrar su respuesta. Revise su licencia, otra reserva en el mismo horario o el plazo.",
  },
  "zh-CN": {
    inviteTitle: "接手此预订的邀请",
    inviteBody: "{name} 取消了行程，预订已转给您。您是否接受该车辆？接受后，申请将提交给您的经理审批，车辆继续为您保留。",
    accept: "接受预订",
    decline: "拒绝",
    deadline: "请在 {date} 前回复。",
    waitingTitle: "等待经理审批",
    waitingBody: "您已接受预订。它会为您保留，经理批准后即归您所有。",
    passedTitle: "您的预订已转让",
    passedBody: "预订已转给 {name}，对方需要接受并获得经理批准。如果无人接手，预订将被取消。",
    failed: "无法记录您的回复。请检查驾照、同一时间的其他预订或截止时间。",
  },
};

export type TakeoverKey = K;
