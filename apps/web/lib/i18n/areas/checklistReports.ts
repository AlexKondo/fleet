import type { AreaTexts } from "../areaText";

/** What a checklist reported (`app/reservations/[id]/ChecklistReports.tsx`). */
const ptBR = {
  checklistReportsTitle: "Apontamentos já registrados nesta reserva",
  pickup: "Retirada",
  returnTrip: "Devolução",
  security: "Portaria",
  employee: "Colaborador",
  typeDamage: "Dano",
  typeEquipment: "Equipamento",
  typeCleaning: "Limpeza",
  exterior: "Externa",
  interior: "Interna",
};

type K = keyof typeof ptBR;

export const checklistReportsTexts: AreaTexts<K> = {
  "pt-BR": ptBR,
  "en-US": {
    checklistReportsTitle: "Already reported on this reservation",
    pickup: "Pickup",
    returnTrip: "Return",
    security: "Gate",
    employee: "Employee",
    typeDamage: "Damage",
    typeEquipment: "Equipment",
    typeCleaning: "Cleaning",
    exterior: "Exterior",
    interior: "Interior",
  },
  es: {
    checklistReportsTitle: "Observaciones ya registradas en esta reserva",
    pickup: "Retiro",
    returnTrip: "Devolución",
    security: "Portería",
    employee: "Colaborador",
    typeDamage: "Daño",
    typeEquipment: "Equipo",
    typeCleaning: "Limpieza",
    exterior: "Exterior",
    interior: "Interior",
  },
  "zh-CN": {
    checklistReportsTitle: "此预约已登记的问题",
    pickup: "取车",
    returnTrip: "还车",
    security: "门岗",
    employee: "员工",
    typeDamage: "损坏",
    typeEquipment: "设备",
    typeCleaning: "清洁",
    exterior: "外部",
    interior: "内部",
  },
};
