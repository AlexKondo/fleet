import type { AreaTexts } from "../areaText";

export type GanttKey =
  | "pending" | "reserved" | "inProgress" | "completed" | "cancelled"
  | "zoomOut" | "zoomIn" | "week" | "month" | "quarter" | "now";

export const ganttTexts: AreaTexts<GanttKey> = {
  "pt-BR": {
    pending: "Aguardando aprovação",
    reserved: "Reservado, não retirado",
    inProgress: "Em andamento",
    completed: "Concluída",
    cancelled: "Cancelada",
    zoomOut: "Diminuir zoom",
    zoomIn: "Aumentar zoom",
    week: "Semana",
    month: "Mês",
    quarter: "Trimestre",
    now: "Agora",
  },
  "en-US": {
    pending: "Awaiting approval",
    reserved: "Reserved, not picked up",
    inProgress: "In progress",
    completed: "Completed",
    cancelled: "Cancelled",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    week: "Week",
    month: "Month",
    quarter: "Quarter",
    now: "Now",
  },
  es: {
    pending: "Pendiente de aprobación",
    reserved: "Reservado, no retirado",
    inProgress: "En curso",
    completed: "Concluida",
    cancelled: "Cancelada",
    zoomOut: "Reducir zoom",
    zoomIn: "Aumentar zoom",
    week: "Semana",
    month: "Mes",
    quarter: "Trimestre",
    now: "Ahora",
  },
  "zh-CN": {
    pending: "待审批",
    reserved: "已预订，未取车",
    inProgress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
    zoomOut: "缩小",
    zoomIn: "放大",
    week: "周",
    month: "月",
    quarter: "季度",
    now: "现在",
  },
};
