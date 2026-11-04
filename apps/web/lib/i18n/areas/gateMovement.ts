import type { AreaTexts } from "../areaText";

/** What the porter reads when he lets a vehicle out / receives it back (Portaria list + the confirmation screen). */
type K =
  | "listDeparture" | "listArrival"
  | "titleDeparture" | "titleArrival" | "noteDeparture" | "noteArrival"
  | "confirmDeparture" | "confirmArrival" | "optionDeparture" | "optionArrival" | "optionDenied" | "noteLabel";
export type GateMovementKey = K;

export const gateMovementTexts: AreaTexts<K> = {
  "pt-BR": {
    listDeparture: "Liberar saída do veículo",
    listArrival: "Registrar chegada do veículo",
    titleDeparture: "Liberar a saída do veículo",
    titleArrival: "Registrar a chegada do veículo",
    noteDeparture: "Os dois checklists de retirada já foram feitos. Confirme que o veículo está saindo pelo portão agora: ele passa a constar como \"Em uso\" e o colaborador pode devolvê-lo depois.",
    noteArrival: "Confirme que o veículo chegou ao portão agora. Depois disso a devolução pode ser concluída.",
    confirmDeparture: "Confirmar saída",
    confirmArrival: "Confirmar chegada",
    optionDeparture: "O veículo está saindo",
    optionArrival: "O veículo chegou",
    optionDenied: "Saída impedida (não liberei o veículo)",
    noteLabel: "Observação (opcional)",
  },
  "en-US": {
    listDeparture: "Release the vehicle",
    listArrival: "Record the vehicle's arrival",
    titleDeparture: "Release the vehicle",
    titleArrival: "Record the vehicle's arrival",
    noteDeparture: "Both pickup checklists are done. Confirm that the vehicle is leaving through the gate now: it then shows as \"In use\" and the employee can return it later.",
    noteArrival: "Confirm that the vehicle reached the gate now. After that the return can be completed.",
    confirmDeparture: "Confirm departure",
    confirmArrival: "Confirm arrival",
    optionDeparture: "The vehicle is leaving",
    optionArrival: "The vehicle arrived",
    optionDenied: "Departure refused (I did not release it)",
    noteLabel: "Note (optional)",
  },
  es: {
    listDeparture: "Liberar la salida del vehículo",
    listArrival: "Registrar la llegada del vehículo",
    titleDeparture: "Liberar la salida del vehículo",
    titleArrival: "Registrar la llegada del vehículo",
    noteDeparture: "Los dos checklists de retiro ya están hechos. Confirme que el vehículo sale por el portón ahora: pasa a figurar como \"En uso\" y el colaborador podrá devolverlo después.",
    noteArrival: "Confirme que el vehículo llegó al portón ahora. Después se puede completar la devolución.",
    confirmDeparture: "Confirmar salida",
    confirmArrival: "Confirmar llegada",
    optionDeparture: "El vehículo está saliendo",
    optionArrival: "El vehículo llegó",
    optionDenied: "Salida impedida (no liberé el vehículo)",
    noteLabel: "Observación (opcional)",
  },
  "zh-CN": {
    listDeparture: "放行车辆",
    listArrival: "登记车辆到达",
    titleDeparture: "放行车辆",
    titleArrival: "登记车辆到达",
    noteDeparture: "两份取车检查均已完成。请确认车辆现在从门口驶出：车辆将显示为“使用中”，员工之后可以归还。",
    noteArrival: "请确认车辆现在已到达门口。之后即可完成还车。",
    confirmDeparture: "确认出门",
    confirmArrival: "确认到达",
    optionDeparture: "车辆正在离开",
    optionArrival: "车辆已到达",
    optionDenied: "禁止出门（未放行）",
    noteLabel: "备注（可选）",
  },
};
