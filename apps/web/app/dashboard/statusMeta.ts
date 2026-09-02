import type { Database } from "@fleet/supabase-client";

type VehicleStatus = Database["public"]["Enums"]["vehicle_status"];

export const STATUS_META: Record<VehicleStatus, { label: string; dot: string; text: string }> = {
  available: { label: "Disponível", dot: "bg-signal-teal", text: "text-signal-teal" },
  reserved: { label: "Reservado", dot: "bg-signal-blue", text: "text-signal-blue" },
  awaiting_pickup: { label: "Aguardando Retirada", dot: "bg-signal-blue", text: "text-signal-blue" },
  in_use: { label: "Em Uso", dot: "bg-signal-blue", text: "text-signal-blue" },
  returning: { label: "Retornando", dot: "bg-signal-violet", text: "text-signal-violet" },
  inspection: { label: "Inspeção", dot: "bg-signal-amber", text: "text-signal-amber" },
  charging: { label: "Carregando", dot: "bg-signal-teal", text: "text-signal-teal" },
  cleaning: { label: "Limpeza", dot: "bg-signal-amber", text: "text-signal-amber" },
  maintenance: { label: "Manutenção", dot: "bg-signal-red", text: "text-signal-red" },
  blocked: { label: "Bloqueado", dot: "bg-signal-red", text: "text-signal-red" },
};

export const ATTENTION_LABELS: Record<string, string> = {
  damage_blocking_trip: "Avaria",
  safety_equipment_missing: "Equipamento ausente",
  documentation_invalid: "Documentação inválida",
  maintenance_due_soon: "Revisão próxima",
  energy_low: "Energia baixa",
  cleaning_required: "Limpeza pendente",
};
