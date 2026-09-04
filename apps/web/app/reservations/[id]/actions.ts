"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface MessageActionState {
  status: "idle" | "success" | "error";
  error?: string;
}

const MESSAGE_TYPES = [
  "text",
  "delay",
  "vehicle_issue",
  "return_time_change",
  "vehicle_not_found",
  "system_alert",
] as const;
type MessageType = (typeof MESSAGE_TYPES)[number];

/**
 * Communication Hub (COMMUNICATION_HUB.md / DV-004): posts a message to a reservation's
 * thread. A 'delay' message with a new estimated return time also triggers
 * post_reservation_message's own delay-impact side effect (mark the vehicle's next
 * reservation impacted + notify) — see 0017_communication_hub.sql for why that lives in
 * the RPC rather than here (atomicity with the message write).
 */
export async function postReservationMessage(
  _prevState: MessageActionState,
  formData: FormData,
): Promise<MessageActionState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  const reservationId = String(formData.get("reservationId") ?? "");
  const messageType = String(formData.get("messageType") ?? "text");
  const body = String(formData.get("body") ?? "").trim();
  const newExpectedReturnAtRaw = String(formData.get("newExpectedReturnAt") ?? "").trim();

  if (!reservationId) return { status: "error", error: "Reserva inválida." };
  if (!body) return { status: "error", error: "Escreva uma mensagem." };
  if (!MESSAGE_TYPES.includes(messageType as MessageType)) {
    return { status: "error", error: "Tipo de mensagem inválido." };
  }

  const { error } = await supabase.rpc("post_reservation_message", {
    p_reservation_id: reservationId,
    p_message_type: messageType as MessageType,
    p_body: body,
    p_new_expected_return_at: newExpectedReturnAtRaw
      ? new Date(newExpectedReturnAtRaw).toISOString()
      : undefined,
  });
  if (error) return { status: "error", error: error.message };

  revalidatePath(`/reservations/${reservationId}`);
  return { status: "success" };
}
