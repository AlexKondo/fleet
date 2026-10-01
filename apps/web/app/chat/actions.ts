"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getLocale } from "@/lib/i18n/getLocale";
import { interpretMessage } from "@/lib/domain/chatOrchestrator";
import { requiresConfirmation, missingRequiredSlots, isCarpoolIntent, type IntentName } from "@fleet/domain";
import { dispatchIntent } from "./dispatch";
import { findActiveReservations } from "./queries";
import { planTrip, type TripFormInput } from "@/app/trips/new/actions";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import { packSlots, stripReservedSlots, unpackSlots } from "./persistedPending";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { deriveCarpoolGating } from "@/lib/carpool/carpoolFirst";
import {
  carpoolFirstForReservation,
  loadChatCarpoolCtx,
  offerNoteForReservation,
  prepareCarpoolIntent,
  prepareFromOption,
  type CarpoolPrepared,
  type ChatOption,
} from "./carpoolChat";

const DAILY_MESSAGE_LIMIT = 60;
const BURST_MESSAGE_LIMIT = 6;
const BURST_WINDOW_MS = 30_000;
const SELECT_BURST_LIMIT = 12;
const SELECT_DAILY_LIMIT = 150;

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
    vehicleOptions?: { vehicleId: string; plate: string; vehicleName: string }[];
    /** Generic numbered options (Phase C6): compatible carpool offers from FIND_CARPOOL or from
     * carpool-first in a chat reservation (plus the "use a vehicle" choice). Same UX as
     * vehicleOptions (numbered buttons + bare-number reply). The ids are only HINTS: every
     * choice is re-validated server-side with a fresh search before any card is built. */
    options?: ChatOption[];
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

type VehicleOption = { vehicleId: string; plate: string; vehicleName: string };

// The numbered list itself lives only in ChatPanel's clickable buttons now (still numbered
// so the driver can also just say/type the number, e.g. "2") — repeating the same list as
// plain text here duplicated it right above the buttons for no reason.
function buildVehicleSummary(
  chosen: VehicleOption,
  options: VehicleOption[],
  destination: string,
  input: TripFormInput,
  locale: Awaited<ReturnType<typeof getLocale>>,
  tail = "",
): string {
  const optionsLine = options.length > 1 ? " Escolha uma das opções abaixo, ou diga o número dela." : "";
  return `Vou reservar o veículo ${chosen.vehicleName} (${chosen.plate}) para ${destination}, saída ${formatDateTimeShort(input.departureAt, locale)}, retorno ${formatDateTimeShort(input.expectedReturnAt, locale)}.${optionsLine}${tail}`;
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

  // "edit" and "cancel" (dropping/clearing a pending confirmation) are handled entirely
  // client-side now — see ChatPanel.tsx's handleEdit/handleCancel — since neither needs any
  // server work (an LLM call, a dispatch, persisted state); routing them through this
  // Server Action anyway made Next.js revalidate the current route's RSC payload on every
  // click, visibly flashing whatever table/Gantt sits behind the chat panel for no reason.
  // "cancel" still persists via a plain Route Handler (app/api/chat/abandon/route.ts),
  // which has no such revalidation side effect.

  const locale = await getLocale();
  // Phase C6: the org's carpool gating (one policy query). Drives the host-question wording in
  // the orchestrator, carpool-first for chat reservations and every carpool intent.
  const carpoolCtx = await loadChatCarpoolCtx(supabase, user.id, {
    organizationId: profile.organization_id,
    gating: deriveCarpoolGating(await loadLatestPolicy(supabase, profile.organization_id)),
  });
  const dictNow = dictionaries[locale];

  // Tail of a vehicle card when the user answered Yes to offering seats under the new engine:
  // states exactly how many seats will be published after the reservation is created.
  function reservationTail(slots: Record<string, string>, maxOfferableSeats: number | undefined): string {
    if (!carpoolCtx?.gating.hostStep || slots.allowCarpool !== "true") return "";
    const requested = slots.offerSeats ? Number(slots.offerSeats) : maxOfferableSeats ?? 0;
    const seats = Math.min(Number.isInteger(requested) ? requested : 0, maxOfferableSeats ?? 0);
    return offerNoteForReservation(carpoolCtx, seats);
  }

  // Turns a prepared carpool step into the chat state (reply / confirmation card / options).
  async function stateFromPrepared(
    prepared: CarpoolPrepared,
    intent: IntentName,
    base: ChatMessage[],
  ): Promise<ChatState> {
    const content = prepared.kind === "reply" ? prepared.message : prepared.summary;
    const slots = prepared.kind === "reply" ? undefined : prepared.slots;
    const pendingAction: ChatState["pendingAction"] =
      prepared.kind === "reply"
        ? undefined
        : {
            intent,
            slots: prepared.slots,
            summary: prepared.summary,
            options: prepared.kind === "options" ? prepared.options : undefined,
          };
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      intent: pendingAction?.intent,
      slots: packSlots(slots, pendingAction?.options, pendingAction?.vehicleOptions),
    });
    return {
      status: pendingAction ? "needs_confirmation" : "idle",
      conversationId,
      messages: [...base, { role: "assistant", content }],
      pendingAction,
    };
  }

  // The vehicle confirmation card for a chat CREATE_RESERVATION: the exact recommendation the
  // New Trip form uses (planTrip), never the LLM's own vehicle-blind summary. Also used when the
  // user answers "use a vehicle" to the carpool-first options.
  async function buildReservationCard(
    slots: Record<string, string>,
    llmSummary: string | null,
    note: string,
  ): Promise<{
    assistantContent: string;
    pendingAction?: ChatState["pendingAction"];
    status: ChatState["status"];
  }> {
    const input: TripFormInput = {
      departureAt: new Date(slots.departureAt ?? "").toISOString(),
      expectedReturnAt: new Date(slots.expectedReturnAt ?? "").toISOString(),
      origin: slots.origin ?? "",
      destination: slots.destination ?? "",
      distanceKm: Number(slots.distanceKm ?? 0),
      passengerCount: Number(slots.passengerCount ?? 1),
      requiresCargo: slots.requiresCargo === "true",
      justification: slots.justification ?? "Solicitado via assistente conversacional",
      allowCarpool: slots.allowCarpool === "true",
    };
    const plan = await planTrip(input);

    if (plan.type === "vehicle" && plan.vehicle) {
      // A plate the user already named (answering a previous round of alternatives)
      // resolves against THIS fresh plan — never trusted blindly, only used if it's
      // still actually eligible right now.
      const namedPlate = slots.preferredVehiclePlate?.trim().toUpperCase();
      const namedMatch = namedPlate
        ? plan.vehicle.plate.toUpperCase() === namedPlate
          ? { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate, vehicleName: plan.vehicle.vehicleName }
          : plan.vehicle.alternatives.find((alt) => alt.plate.toUpperCase() === namedPlate)
        : undefined;
      const chosenVehicleId = namedMatch?.vehicleId ?? plan.vehicle.vehicleId;
      const chosenPlate = namedMatch?.plate ?? plan.vehicle.plate;
      const chosenVehicleName = namedMatch?.vehicleName ?? plan.vehicle.vehicleName;
      const chosenMax =
        chosenVehicleId === plan.vehicle.vehicleId
          ? plan.vehicle.maxOfferableSeats
          : plan.vehicle.alternatives.find((a) => a.vehicleId === chosenVehicleId)?.maxOfferableSeats;

      const vehicleOptions = [
        { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate, vehicleName: plan.vehicle.vehicleName },
        ...plan.vehicle.alternatives.map((a) => ({
          vehicleId: a.vehicleId,
          plate: a.plate,
          vehicleName: a.vehicleName,
        })),
      ];
      const summary =
        (note ? `${note}\n` : "") +
        buildVehicleSummary(
          { vehicleId: chosenVehicleId, plate: chosenPlate, vehicleName: chosenVehicleName },
          vehicleOptions,
          slots.destination ?? "",
          input,
          locale,
          reservationTail(slots, chosenMax),
        );
      return {
        assistantContent: summary,
        pendingAction: {
          intent: "CREATE_RESERVATION",
          slots: { ...slots, preferredVehicleId: chosenVehicleId },
          summary,
          vehicleOptions: vehicleOptions.length > 1 ? vehicleOptions : undefined,
        },
        status: "needs_confirmation",
      };
    }

    if (llmSummary === null) {
      // No LLM summary to fall back on (the user picked "use a vehicle" after the carpool
      // options) and no vehicle is eligible: say why instead of showing a card that can't work.
      return {
        assistantContent:
          plan.reasons.length > 0 ? plan.reasons.join(" ") : "Nenhum veículo elegível encontrado para esse período.",
        status: "error",
      };
    }
    // Carpool (legacy engine), or no eligible vehicle at all — nothing to pick between, so the
    // original (vehicle-blind) confirmation summary is the right one; dispatch.ts re-runs
    // planTrip itself at confirm time regardless.
    const summary = (note ? `${note}\n` : "") + llmSummary;
    return {
      assistantContent: summary,
      pendingAction: { intent: "CREATE_RESERVATION", slots, summary },
      status: "needs_confirmation",
    };
  }

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
      allowCarpool: pending.slots.allowCarpool === "true",
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
      { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate, vehicleName: plan.vehicle.vehicleName },
      ...plan.vehicle.alternatives.map((a) => ({ vehicleId: a.vehicleId, plate: a.plate, vehicleName: a.vehicleName })),
    ];
    const chosen = options.find((o) => o.vehicleId === chosenVehicleId) ?? options[0]!;

    const chosenMax =
      chosen.vehicleId === plan.vehicle.vehicleId
        ? plan.vehicle.maxOfferableSeats
        : plan.vehicle.alternatives.find((a) => a.vehicleId === chosen.vehicleId)?.maxOfferableSeats;
    const summary = buildVehicleSummary(
      chosen,
      options,
      pending.slots.destination ?? "",
      input,
      locale,
      reservationTail(pending.slots, chosenMax),
    );

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

  // Shared by the button click (phase=select_option) and the bare-number reply: one numbered
  // carpool option (or "use a vehicle") was chosen.
  async function selectOption(pending: NonNullable<ChatState["pendingAction"]>, optionId: string): Promise<ChatState> {
    if (!carpoolCtx) return { status: "error", conversationId, messages: prevState.messages, error: "not_authenticated" };
    const result = await prepareFromOption(
      carpoolCtx,
      { intent: pending.intent, slots: pending.slots, options: pending.options },
      optionId,
    );
    if (result.kind === "vehicle") {
      // "Use a vehicle": the normal vehicle card, carpool-first not repeated.
      const built = await buildReservationCard({ ...pending.slots, carpoolDeclined: "true" }, null, "");
      await admin.from("chat_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: built.assistantContent,
        intent: built.pendingAction?.intent,
        slots: built.pendingAction?.slots,
      });
      return {
        status: built.status,
        conversationId,
        messages: [...prevState.messages, { role: "assistant", content: built.assistantContent }],
        pendingAction: built.pendingAction,
        error: built.status === "error" ? "no_eligible_vehicle" : undefined,
      };
    }
    return stateFromPrepared(result, "REQUEST_CARPOOL", prevState.messages);
  }

  if (phase === "select_option") {
    // Option clicks add no user message, but each one triggers a fresh geocode + route search,
    // so they are limited on the assistant rows they produce: at most SELECT_BURST_LIMIT (12)
    // per 30s (switching between a handful of options is fine, a script is not) and
    // SELECT_DAILY_LIMIT (150) per day, per user across conversations. Bare-number replies
    // instead go through the regular user-message burst (6/30s) and daily (60) limits.
    const since30 = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
    const startOfDay = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const countAssistant = async (since: string) =>
      (
        await admin
          .from("chat_messages")
          .select("id, chat_conversations!inner(user_id)", { count: "exact", head: true })
          .eq("role", "assistant")
          .eq("chat_conversations.user_id", user.id)
          .gte("created_at", since)
      ).count ?? 0;
    if ((await countAssistant(since30)) >= SELECT_BURST_LIMIT) {
      return { status: "error", conversationId, messages: prevState.messages, error: "rate_limited" };
    }
    if ((await countAssistant(startOfDay)) >= SELECT_DAILY_LIMIT) {
      return { status: "error", conversationId, messages: prevState.messages, error: "daily_limit_reached" };
    }
    const pending = prevState.pendingAction;
    const optionId = String(formData.get("optionId") ?? "");
    if (!pending || !pending.options || !optionId || !pending.options.some((o) => o.id === optionId)) {
      return { status: "idle", conversationId, messages: prevState.messages };
    }
    return selectOption(pending, optionId);
  }

  if (phase === "confirm") {
    const pending = prevState.pendingAction;
    if (!pending) return { status: "idle", conversationId, messages: prevState.messages };

    // Carpool intents (Phase C6): the client echoes the pending action back, so it must be
    // exactly the confirmation card THIS server persisted for this user's still-active
    // conversation (same intent, same slots). Nothing mutating is reachable otherwise.
    if (isCarpoolIntent(pending.intent)) {
      const { data: last } = await admin
        .from("chat_messages")
        .select("intent, slots, chat_conversations!inner(user_id, status)")
        .eq("conversation_id", conversationId)
        .eq("chat_conversations.user_id", user.id)
        .eq("chat_conversations.status", "active")
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const canonical = (v: unknown) =>
        JSON.stringify(Object.entries((v ?? {}) as Record<string, string>).sort(([a], [b]) => (a < b ? -1 : 1)));
      if (!last || last.intent !== pending.intent || canonical(unpackSlots(last.slots).slots) !== canonical(pending.slots)) {
        const notPending = dictNow.chat.carpool.confirmationNotPending;
        return {
          status: "error",
          conversationId,
          messages: [...prevState.messages, { role: "assistant", content: notPending }],
          error: "confirmation_not_pending",
        };
      }
    }

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

  // A plain numeric reply to a pending vehicle-choice confirmation ("2") picks that option
  // directly — no LLM round-trip needed, and it's exactly what was asked for: the driver
  // just says the number instead of typing a plate back.
  if (prevState.status === "needs_confirmation" && prevState.pendingAction?.options) {
    // Same bare-number reply for the numbered carpool options (Phase C6).
    const optionNumber = parseOptionNumber(message);
    const chosenOption = optionNumber !== null ? prevState.pendingAction.options[optionNumber - 1] : undefined;
    if (chosenOption) {
      await admin.from("chat_messages").insert({ conversation_id: conversationId, role: "user", content: message });
      const answered = await selectOption(prevState.pendingAction, chosenOption.id);
      return { ...answered, messages: [...prevState.messages, { role: "user", content: message }, ...answered.messages.slice(prevState.messages.length)] };
    }
  }
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

  const userMessage: ChatMessage = { role: "user", content: message };
  await admin.from("chat_messages").insert({ conversation_id: conversationId, role: "user", content: message });

  const active = await findActiveReservations(supabase, user.id);
  const rawInterpretation = await interpretMessage({
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
      carpoolEngineActive: carpoolCtx?.gating.newEngine ?? false,
    },
  });
  // C7b hardening: LLM-emitted slots can never carry a reserved ("__*") key into what is persisted / restored.
  const interpretation =
    rawInterpretation.status === "ok"
      ? { ...rawInterpretation, slots: stripReservedSlots(rawInterpretation.slots) }
      : rawInterpretation;

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
    } else if (isCarpoolIntent(interpretation.intent)) {
      // Smart Carpool (Phase C6). Nothing is executed here: the server resolves every
      // reference among the caller's own rows and either asks ONE question, shows numbered
      // options (FIND_CARPOOL, read-only) or builds the confirmation card. dispatch.ts only runs
      // at the confirm phase.
      if (!carpoolCtx) {
        assistantContent = "Não consegui processar sua mensagem agora. Você pode continuar usando os formulários normalmente.";
        status = "error";
      } else {
        const prepared = await prepareCarpoolIntent(
          carpoolCtx,
          interpretation.intent,
          interpretation.slots,
          prevState.pendingAction
            ? { intent: prevState.pendingAction.intent, slots: prevState.pendingAction.slots, options: prevState.pendingAction.options }
            : undefined,
        );
        const next = await stateFromPrepared(prepared, interpretation.intent, [...prevState.messages, userMessage]);
        return next;
      }
    } else if (requiresConfirmation(interpretation.intent) === "no") {
      const result = await dispatchIntent(interpretation.intent, interpretation.slots);
      assistantContent = result.success
        ? result.message
        : result.reasons && result.reasons.length > 0
          ? result.reasons.join(" ")
          : friendlyDispatchError(result.message);
    } else if (interpretation.intent === "CREATE_RESERVATION") {
      // Phase C6 carpool-first (parity with New Trip): when the org runs the Smart Carpool
      // engine with carpool-first, compatible offers are shown BEFORE the vehicle card, next to
      // a "use a vehicle" choice. Any other outcome falls through to the normal vehicle card.
      const slots = interpretation.slots;
      let carpoolNote = "";
      const first = carpoolCtx?.gating.carpoolFirst
        ? await carpoolFirstForReservation(carpoolCtx, slots)
        : ({ kind: "none" } as { kind: "none"; note?: string });
      if (first.kind === "options") {
        assistantContent = first.summary;
        pendingAction = { intent: interpretation.intent, slots, summary: first.summary, options: first.options };
        status = "needs_confirmation";
      } else {
        carpoolNote = first.note ?? "";
        // Same recommendation engine the form uses (planTrip), before ever asking for
        // confirmation, so the summary can name the actual vehicle and, when the
        // organization's booking_mode allows it, list real alternatives by plate.
        const built = await buildReservationCard(slots, interpretation.summary, carpoolNote);
        assistantContent = built.assistantContent;
        pendingAction = built.pendingAction;
        status = built.status;
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
    slots: packSlots(pendingAction?.slots, pendingAction?.options, pendingAction?.vehicleOptions),
  });

  return {
    status,
    conversationId,
    messages: [...prevState.messages, userMessage, assistantMessage],
    pendingAction,
    error: status === "error" ? interpretation.status : undefined,
  };
}
