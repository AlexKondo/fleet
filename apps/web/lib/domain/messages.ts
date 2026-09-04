import type { Database } from "@fleet/supabase-client";

export type MessageType = Database["public"]["Enums"]["message_type"];

export const MESSAGE_TYPE_OPTIONS: { value: MessageType; label: string }[] = [
  { value: "text", label: "Mensagem" },
  { value: "delay", label: "Atraso" },
  { value: "vehicle_issue", label: "Problema no veículo" },
  { value: "return_time_change", label: "Mudança no horário de retorno" },
  { value: "vehicle_not_found", label: "Veículo não encontrado" },
];

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  text: "Mensagem",
  delay: "Atraso",
  vehicle_issue: "Problema no veículo",
  return_time_change: "Mudança no horário de retorno",
  vehicle_not_found: "Veículo não encontrado",
  system_alert: "Alerta do sistema",
};
