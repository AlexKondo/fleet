"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getLocale } from "@/lib/i18n/getLocale";
import { interpretMessage } from "@/lib/domain/chatOrchestrator";
import { requiresConfirmation, missingRequiredSlots, type IntentName } from "@fleet/domain";
import { dispatchIntent } from "./dispatch";
import { findActiveReservations } from "./queries";
import { planTrip, type TripFormInput } from "@/app/trips/new/actions";
import { formatDateTime } from "@/lib/formatDateTime";

const DAILY_MESSAGE_LIMIT = 60;
const BURST_MESSAGE_LIMIT = 6;
const BURST_WINDOW_MS = 30_000;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatState {
  status: "idle" | "needs_confirmation" | "error";
  conversationId?: string;
  messages: ChatMessage[];
  pendingAction?: {
    intent: IntentName;
    slots: Record<string, string>;
    summary: string;
    /** CREATE_RESERVATION only — the recommended vehicle plus any real alternatives
     * (already filtered by the org's booking_mode by planTrip itself), so ChatPanel can
     * render an actual button per option instead of requiring the driver to type a plate
     * they read out of the summary text. */
    vehicleOptions?: { vehicleId: string; plate: string; categoryName: string }[];
  };
  error?: string;
}

// dispatch.ts's DispatchResult.message is a stable internal code on failure (or, for an
// RPC error with no mapped code, a raw Postgres message) — never shown to the user
// directly (the doc explicitly forbids exposing raw technical errors). Anything not
// listed here falls back to a generic message instead of leaking internals.
const FRIENDLY_DISPATCH_ERRORS: Record<string, string> = {
  reservation_not_found: "Não encontrei essa reserva. Pode informar qual?",
  RESERVATION_CONFLICT: "Esse veículo acabou de ser reservado por outra pessoa. Tente outro horário.",
  not_authenticated: "Sua sessão expirou. Faça login novamente.",
  missing_new_return_time: "Não entendi o novo horário de retorno. Pode informar de novo?",
  not_supported_via_chat: "Essa ação ainda não é feita por aqui.",
};

function friendlyDispatchError(code: string): string {
  return FRIENDLY_DISPATCH_ERRORS[code] ?? "Não consegui concluir essa ação agora. Tente novamente em instantes.";
}

type VehicleOption = { vehicleId: string; plate: string; categoryName: string };

// Numbered so the driver can just say/type the number ("2") instead of reading a plate off
// the screen and typing it back — the buttons in ChatPanel use the same numbering.
function buildVehicleSummary(
  chosen: VehicleOption,
  options: VehicleOption[],
  destination: string,
  input: TripFormInput,
  locale: Awaited<ReturnType<typeof getLocale>>,
): string {
  const optionsLine =
    options.length > 1
      ? ` Opções disponíveis:\n${options.map((o, i) => `${i + 1}. ${o.plate} (${o.categoryName})`).join("\n")}\nResponda com o número da opção desejada, ou toque em um dos botões abaixo.`
      : "";
  return `Vou reservar o veículo ${chosen.plate} (${chosen.categoryName}) para ${destination}, saída ${formatDateTime(input.departureAt, locale)}, retorno ${formatDateTime(input.expectedReturnAt, locale)}.${optionsLine}`;
}

// Matches a bare number ("2") or a short Portuguese phrasing ("opção 2", "opcao 2", "numero 2").
function parseOptionNumber(message: string): number | null {
  const match = message.trim().match(/^(?:op[cç][aã]o|n[uú]mero)?\s*(\d+)\s*$/i);
  return match ? Number(match[1]) : null;
}

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

  if (phase === "edit") {
    // Drops only the pending confirmation, keeping the conversation history — so a
    // follow-up like "muda a saída pra 7:00" carries the already-established
    // destination/return/etc. forward instead of making the driver restate the whole
    // request from scratch.
    return { status: "idle", conversationId, messages: prevState.messages };
  }

  if (phase === "cancel") {
    // Unlike "edit", cancelling a pending action ends the whole thread — every clarifying
    // question and option shown has nothing to do with whatever the driver asks next.
    // Marks the conversation abandoned (not left dangling "active") and starts fresh with
    // no conversationId, same as a successful confirm already does.
    await admin
      .from("chat_conversations")
      .update({ status: "abandoned", updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    return { status: "idle", messages: [] };
  }

  const locale = await getLocale();

  // Shared by the button click (phase=select_vehicle) and by a plain-text numeric reply
  // ("2", "opção 2") to a pending CREATE_RESERVATION confirmation — either way, re-runs the
  // exact same recommendation the initial message did (never trusts a client-echoed id
  // blindly) and rebuilds the confirmation card with a numbered options list, so the driver
  // never has to type a plate back.
  async function reselectVehicle(pending: NonNullable<ChatState["pendingAction"]>, chosenVehicleId: string): Promise<ChatState> {
    const input: TripFormInput = {
      departureAt: new Date(pending.slots.departureAt ?? "").toISOString(),
      expectedReturnAt: new Date(pending.slots.expectedReturnAt ?? "").toISOString(),
      origin: pending.slots.origin ?? "",
      destination: pending.slots.destination ?? "",
      distanceKm: Number(pending.slots.distanceKm ?? 0),
      passengerCount: Number(pending.slots.passengerCount ?? 1),
      requiresCargo: pending.slots.requiresCargo === "true",
      justification: pending.slots.justification ?? "Solicitado via assistente conversacional",
      allowCarpool: true,
    };
    const plan = await planTrip(input);

    if (plan.type !== "vehicle" || !plan.vehicle) {
      // The window's availability genuinely changed between rounds (e.g. everything got
      // booked up) — surface that instead of silently keeping a stale confirmation card.
      const message = "Essa opção não está mais disponível. Pode tentar de novo?";
      const assistantMessage: ChatMessage = { role: "assistant", content: message };
      await admin.from("chat_messages").insert({ conversation_id: conversationId, role: "assistant", content: message });
      return { status: "error", conversationId, messages: [...prevState.messages, assistantMessage], error: "vehicle_no_longer_available" };
    }

    const options = [
      { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate, categoryName: plan.vehicle.categoryName },
      ...plan.vehicle.alternatives.map((a) => ({ vehicleId: a.vehicleId, plate: a.plate, categoryName: a.categoryName })),
    ];
    const chosen = options.find((o) => o.vehicleId === chosenVehicleId) ?? options[0]!;

    const summary = buildVehicleSummary(chosen, options, pending.slots.destination ?? "", input, locale);

    const assistantMessage: ChatMessage = { role: "assistant", content: summary };
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: summary,
      intent: pending.intent,
      slots: { ...pending.slots, preferredVehicleId: chosen.vehicleId },
    });

    return {
      status: "needs_confirmation",
      conversationId,
      messages: [...prevState.messages, assistantMessage],
      pendingAction: {
        intent: pending.intent,
        slots: { ...pending.slots, preferredVehicleId: chosen.vehicleId },
        summary,
        vehicleOptions: options.length > 1 ? options : undefined,
      },
    };
  }

  if (phase === "select_vehicle") {
    const pending = prevState.pendingAction;
    const chosenVehicleId = String(formData.get("vehicleId") ?? "");
    if (!pending || pending.intent !== "CREATE_RESERVATION" || !chosenVehicleId) {
      return { status: "idle", conversationId, messages: prevState.messages };
    }
    return reselectVehicle(pending, chosenVehicleId);
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
    // `reasons`, when present, is already safe human-readable Portuguese (e.g. the
    // recommendation engine's own explanation for finding no eligible vehicle) — showing
    // the generic fallback instead would throw away a genuinely useful, specific answer.
    const displayMessage = result.success
      ? result.message
      : "reasons" in result && result.reasons && result.reasons.length > 0
        ? result.reasons.join(" ")
        : friendlyDispatchError(result.message);

    const assistantMessage: ChatMessage = { role: "assistant", content: displayMessage };
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      // The raw code is kept in the DB row (not the friendly text shown to the user) —
      // useful for debugging/telemetry without being what anyone actually reads.
      content: result.message,
      intent: pending.intent,
      slots: pending.slots,
    });
    await admin
      .from("chat_conversations")
      .update({ status: "resolved", updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    // On success the whole thread that got here (every clarifying question, every
    // alternative shown) has served its purpose — carrying it forward just cluttered the
    // next, unrelated request. Clears down to the confirmation itself and drops
    // conversationId so the next message starts a brand new conversation row rather than
    // appending to this now-finished one.
    if (result.success) {
      return { status: "idle", messages: [assistantMessage] };
    }

    return {
      status: "error",
      conversationId,
      messages: [...prevState.messages, assistantMessage],
      error: result.message,
    };
  }

  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { status: "idle", conversationId, messages: prevState.messages };

  // A plain numeric reply to a pending vehicle-choice confirmation ("2") picks that option
  // directly — no LLM round-trip needed, and it's exactly what was asked for: the driver
  // just says the number instead of typing a plate back.
  if (prevState.status === "needs_confirmation" && prevState.pendingAction?.vehicleOptions) {
    const optionNumber = parseOptionNumber(message);
    if (optionNumber !== null) {
      const options = prevState.pendingAction.vehicleOptions;
      const chosen = options[optionNumber - 1];
      if (chosen) {
        await admin.from("chat_messages").insert({ conversation_id: conversationId, role: "user", content: message });
        return reselectVehicle(prevState.pendingAction, chosen.vehicleId);
      }
    }
  }

  // Scoped by user_id across ALL of today's conversations, not just this one — a
  // per-conversation count would reset to zero every time a conversation resolves and a
  // fresh one starts, which defeats the point of a daily cap entirely.
  const { count: dailyCount } = await admin
    .from("chat_messages")
    .select("id, chat_conversations!inner(user_id)", { count: "exact", head: true })
    .eq("role", "user")
    .eq("chat_conversations.user_id", user.id)
    .gte("created_at", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString());
  if ((dailyCount ?? 0) >= DAILY_MESSAGE_LIMIT) {
    return { status: "error", conversationId, messages: prevState.messages, error: "daily_limit_reached" };
  }

  // Burst protection: a small, short window cap independent of the daily total — catches
  // a runaway client loop or someone hammering send far faster than an actual
  // conversation would ever require, without waiting for the daily count to add up.
  const { count: burstCount } = await admin
    .from("chat_messages")
    .select("id, chat_conversations!inner(user_id)", { count: "exact", head: true })
    .eq("role", "user")
    .eq("chat_conversations.user_id", user.id)
    .gte("created_at", new Date(Date.now() - BURST_WINDOW_MS).toISOString());
  if ((burstCount ?? 0) >= BURST_MESSAGE_LIMIT) {
    return { status: "error", conversationId, messages: prevState.messages, error: "rate_limited" };
  }

  const userMessage: ChatMessage = { role: "user", content: message };
  await admin.from("chat_messages").insert({ conversation_id: conversationId, role: "user", content: message });

  const active = await findActiveReservations(supabase, user.id);
  const interpretation = await interpretMessage({
    history: prevState.messages,
    message,
    locale,
    context: {
      // Brazil-local "now" (not the server's own UTC clock) with its explicit -03:00
      // offset spelled out — see chatOrchestrator.ts's system prompt for why this exact
      // format matters: it's also the model's only example of the offset it must echo back
      // on every datetime slot it produces.
      today: new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T") + "-03:00",
      organizationName: (profile.organization as unknown as { name: string } | null)?.name ?? "",
      activeReservationIds: active.map((r) => r.reservationId),
    },
  });

  let assistantContent: string;
  let pendingAction: ChatState["pendingAction"];
  let status: ChatState["status"] = "idle";

  if (interpretation.status === "ok") {
    const notAutomatedMessage = NOT_AUTOMATED[interpretation.intent];
    if (interpretation.intent === "ASK_FLEET") {
      // Purely informational — there's nothing for dispatch.ts to execute, so the
      // interpreter's own answer IS the response. Routing this through dispatchIntent
      // instead (as every other no-confirmation-needed intent does) hit its default
      // "not_supported_via_chat" case, silently breaking every general question.
      assistantContent = interpretation.summary;
    } else if (notAutomatedMessage) {
      assistantContent = notAutomatedMessage;
    } else if (requiresConfirmation(interpretation.intent) === "no") {
      const result = await dispatchIntent(interpretation.intent, interpretation.slots);
      assistantContent = result.success
        ? result.message
        : result.reasons && result.reasons.length > 0
          ? result.reasons.join(" ")
          : friendlyDispatchError(result.message);
    } else if (interpretation.intent === "CREATE_RESERVATION") {
      // Previously confirmed straight off the LLM's own (vehicle-blind) summary — the
      // driver found out which vehicle they'd gotten only after already confirming, with
      // no way to see or pick from other eligible options first. Now runs the exact same
      // recommendation engine the form uses (planTrip) before ever asking for
      // confirmation, so the summary can name the actual vehicle and, when the
      // organization's booking_mode allows it, list real alternatives by plate.
      const slots = interpretation.slots;
      const input: TripFormInput = {
        departureAt: new Date(slots.departureAt ?? "").toISOString(),
        expectedReturnAt: new Date(slots.expectedReturnAt ?? "").toISOString(),
        origin: slots.origin ?? "",
        destination: slots.destination ?? "",
        distanceKm: Number(slots.distanceKm ?? 0),
        passengerCount: Number(slots.passengerCount ?? 1),
        requiresCargo: slots.requiresCargo === "true",
        justification: slots.justification ?? "Solicitado via assistente conversacional",
        allowCarpool: true,
      };
      const plan = await planTrip(input);

      if (plan.type === "vehicle" && plan.vehicle) {
        // A plate the user already named (answering a previous round of alternatives)
        // resolves against THIS fresh plan — never trusted blindly, only used if it's
        // still actually eligible right now.
        const namedPlate = slots.preferredVehiclePlate?.trim().toUpperCase();
        const namedMatch = namedPlate
          ? plan.vehicle.plate.toUpperCase() === namedPlate
            ? { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate }
            : plan.vehicle.alternatives.find((alt) => alt.plate.toUpperCase() === namedPlate)
          : undefined;
        const chosenVehicleId = namedMatch?.vehicleId ?? plan.vehicle.vehicleId;
        const chosenPlate = namedMatch?.plate ?? plan.vehicle.plate;

        const vehicleOptions = [
          { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate, categoryName: plan.vehicle.categoryName },
          ...plan.vehicle.alternatives.map((a) => ({
            vehicleId: a.vehicleId,
            plate: a.plate,
            categoryName: a.categoryName,
          })),
        ];
        const summary = buildVehicleSummary(
          { vehicleId: chosenVehicleId, plate: chosenPlate, categoryName: plan.vehicle.categoryName },
          vehicleOptions,
          slots.destination ?? "",
          input,
          locale,
        );

        assistantContent = summary;
        pendingAction = {
          intent: interpretation.intent,
          slots: { ...slots, preferredVehicleId: chosenVehicleId },
          summary,
          vehicleOptions: vehicleOptions.length > 1 ? vehicleOptions : undefined,
        };
        status = "needs_confirmation";
      } else {
        // Carpool, or no eligible vehicle at all — nothing to pick between, so the
        // original (vehicle-blind) confirmation summary is the right one; dispatch.ts
        // re-runs planTrip itself at confirm time regardless.
        assistantContent = interpretation.summary;
        pendingAction = { intent: interpretation.intent, slots, summary: interpretation.summary };
        status = "needs_confirmation";
      }
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
