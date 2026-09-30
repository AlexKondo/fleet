"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getLocale } from "@/lib/i18n/getLocale";
import { interpretMessage } from "@/lib/domain/chatOrchestrator";
import { requiresConfirmation, missingRequiredSlots, type IntentName } from "@fleet/domain";
import { dispatchIntent } from "./dispatch";
import { findActiveReservations } from "./queries";

const DAILY_MESSAGE_LIMIT = 60;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatState {
  status: "idle" | "needs_confirmation" | "error";
  conversationId?: string;
  messages: ChatMessage[];
  pendingAction?: { intent: IntentName; slots: Record<string, string>; summary: string };
  error?: string;
}

export const initialChatState: ChatState = { status: "idle", messages: [] };

// Intents the doc scopes to "point at the right screen" instead of full chat automation
// (pickup/return need photo evidence; vehicle-swap is a dashboard/fleet-manager action) —
// see dispatch.ts's file comment for the reasoning.
const NOT_AUTOMATED: Partial<Record<IntentName, string>> = {
  CHANGE_RESERVATION: "Para alterar detalhes de uma reserva, acesse a reserva em Minhas Viagens.",
  REQUEST_DIFFERENT_VEHICLE: "Para trocar de veículo, use o botão \"Trocar\" no Painel.",
  START_TRIP: "Para retirar o veículo, abra a reserva e use o checklist de retirada — ele exige fotos do veículo.",
  END_TRIP: "Para devolver o veículo, abra a reserva e use o checklist de devolução — ele exige fotos do veículo.",
};

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  return { supabase, user };
}

export async function sendChatMessage(prevState: ChatState, formData: FormData): Promise<ChatState> {
  const { supabase, user } = await requireUser();
  if (!user) return { status: "error", messages: prevState.messages, error: "not_authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();
  if (!profile) return { status: "error", messages: prevState.messages, error: "not_authenticated" };

  const phase = String(formData.get("phase") ?? "message");
  const admin = createSupabaseAdminClient();

  // A conversation row is created lazily on the first message of a session and reused for
  // the rest of it (id round-tripped via a hidden input) — see the "no message" fallback
  // below, which also protects against a stale/foreign conversationId being replayed.
  let conversationId = String(formData.get("conversationId") ?? "");
  if (!conversationId) {
    const { data: created } = await admin
      .from("chat_conversations")
      .insert({ organization_id: profile.organization_id, user_id: user.id })
      .select("id")
      .single();
    conversationId = created?.id ?? "";
  }
  if (!conversationId) {
    return { status: "error", messages: prevState.messages, error: "conversation_create_failed" };
  }

  if (phase === "cancel") {
    return { status: "idle", conversationId, messages: prevState.messages };
  }

  if (phase === "confirm") {
    const pending = prevState.pendingAction;
    if (!pending) return { status: "idle", conversationId, messages: prevState.messages };

    // Re-validate server-side rather than trusting the client's echoed slots — required
    // slots must still all be present (they were set once and only round-tripped as
    // hidden inputs, but nothing stops a tampered request from stripping one).
    if (missingRequiredSlots(pending.intent, pending.slots).length > 0) {
      return { status: "error", conversationId, messages: prevState.messages, error: "incomplete_slots" };
    }

    const notAutomatedMessage = NOT_AUTOMATED[pending.intent];
    const result = notAutomatedMessage
      ? { success: true, message: notAutomatedMessage }
      : await dispatchIntent(pending.intent, pending.slots);

    const assistantMessage: ChatMessage = { role: "assistant", content: result.message };
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: result.message,
      intent: pending.intent,
      slots: pending.slots,
    });
    await admin
      .from("chat_conversations")
      .update({ status: "resolved", updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    return {
      status: result.success ? "idle" : "error",
      conversationId,
      messages: [...prevState.messages, assistantMessage],
      error: result.success ? undefined : result.message,
    };
  }

  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { status: "idle", conversationId, messages: prevState.messages };

  const { count } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .gte("created_at", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString());
  if ((count ?? 0) >= DAILY_MESSAGE_LIMIT) {
    return {
      status: "error",
      conversationId,
      messages: prevState.messages,
      error: "daily_limit_reached",
    };
  }

  const userMessage: ChatMessage = { role: "user", content: message };
  await admin.from("chat_messages").insert({ conversation_id: conversationId, role: "user", content: message });

  const locale = await getLocale();
  const active = await findActiveReservations(supabase, user.id);
  const interpretation = await interpretMessage({
    history: prevState.messages,
    message,
    locale,
    context: {
      today: new Date().toISOString().slice(0, 10),
      organizationName: (profile.organization as unknown as { name: string } | null)?.name ?? "",
      activeReservationIds: active.map((r) => r.reservationId),
    },
  });

  let assistantContent: string;
  let pendingAction: ChatState["pendingAction"];
  let status: ChatState["status"] = "idle";

  if (interpretation.status === "ok") {
    const notAutomatedMessage = NOT_AUTOMATED[interpretation.intent];
    if (notAutomatedMessage) {
      assistantContent = notAutomatedMessage;
    } else if (requiresConfirmation(interpretation.intent) === "no") {
      const result = await dispatchIntent(interpretation.intent, interpretation.slots);
      assistantContent = result.message;
    } else {
      assistantContent = interpretation.summary;
      pendingAction = { intent: interpretation.intent, slots: interpretation.slots, summary: interpretation.summary };
      status = "needs_confirmation";
    }
  } else if (interpretation.status === "needs_clarification") {
    assistantContent = interpretation.question;
  } else if (interpretation.status === "low_confidence" || interpretation.status === "unknown_intent") {
    assistantContent = "Não entendi bem o que você precisa. Pode reformular?";
  } else {
    assistantContent = "Não consegui processar sua mensagem agora. Você pode continuar usando os formulários normalmente.";
    status = "error";
  }

  const assistantMessage: ChatMessage = { role: "assistant", content: assistantContent };
  await admin.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: assistantContent,
    intent: pendingAction?.intent,
    slots: pendingAction?.slots,
  });

  return {
    status,
    conversationId,
    messages: [...prevState.messages, userMessage, assistantMessage],
    pendingAction,
    error: status === "error" ? interpretation.status : undefined,
  };
}
