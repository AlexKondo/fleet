"use server";
import {assistantPolicy} from "@/lib/operations/aiPolicy";

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
import { noVehicleReply } from "./noVehicle";
import { classifyError, failureReply, type AssistantReply } from "./replies";
import { fillTemplate } from "@/lib/carpool/errorText";
import type { Dictionary } from "@/lib/i18n/dictionaries";
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
  /** Optional in-app link rendered under the message (e.g. /trips/new prefilled after "no vehicle"). */
  link?: { href: string; label: string };
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
  /** FIX-VENCIDAS/Assistente: the last assistant message already explains the failure in plain
   * words (what / why / alternatives / how to continue), so ChatPanel must NOT add the generic
   * error line under it. Only a failure without any explanation shows chat.errorGeneric. */
  explained?: boolean;
}

// FIX-VENCIDAS/Assistente: every text the assistant writes comes from the dictionaries
// (chat.replies.*); failures always carry what happened / why / alternatives / how to continue
// (app/chat/replies.ts). Codes and database messages only ever reach the server log.

type VehicleOption = { vehicleId: string; plate: string; vehicleName: string; locationName?: string | null };

// The numbered list itself lives only in ChatPanel's clickable buttons now (still numbered
// so the driver can also just say/type the number, e.g. "2") — repeating the same list as
// plain text here duplicated it right above the buttons for no reason.
function buildVehicleSummary(
  dict: Dictionary,
  chosen: VehicleOption,
  options: VehicleOption[],
  destination: string,
  input: TripFormInput,
  locale: Awaited<ReturnType<typeof getLocale>>,
  tail = "",
): string {
  const card = dict.chat.replies.card;
  const optionsLine = options.length > 1 ? card.chooseOption : "";
  const where = chosen.locationName ? ` ${fillTemplate(card.vehicleAt, { location: chosen.locationName })}` : "";
  return `${fillTemplate(card.vehicle, {
    name: chosen.vehicleName,
    plate: chosen.plate,
    destination,
    departure: formatDateTimeShort(input.departureAt, locale),
    return: formatDateTimeShort(input.expectedReturnAt, locale),
  })}${where}${optionsLine}${tail}`;
}

// Matches a bare number ("2") or a short Portuguese phrasing ("opção 2", "opcao 2", "numero 2").
function parseOptionNumber(message: string): number | null {
  const match = message.trim().match(/^(?:op[cç][aã]o|n[uú]mero)?\s*(\d+)\s*$/i);
  return match ? Number(match[1]) : null;
}

// Intents the doc scopes to "point at the right screen" instead of full chat automation
// (pickup/return need photo evidence; vehicle-swap is a dashboard/fleet-manager action) —
// see dispatch.ts's file comment for the reasoning.
const NOT_AUTOMATED: Partial<Record<IntentName, keyof Dictionary["chat"]["replies"]["notAutomated"]>> = {
  CHANGE_RESERVATION: "change",
  REQUEST_DIFFERENT_VEHICLE: "differentVehicle",
  START_TRIP: "startTrip",
  END_TRIP: "endTrip",
};
const notAutomatedText = (dict: Dictionary, intent: IntentName): string | undefined => {
  const key = NOT_AUTOMATED[intent];
  return key ? dict.chat.replies.notAutomated[key] : undefined;
};

/** A failure that is already explained in the assistant's own message (no generic line). */
function explainedError(base: ChatMessage[], reply: AssistantReply, error: string, conversationId?: string): ChatState {
  return {
    status: "error",
    ...(conversationId ? { conversationId } : {}),
    messages: [...base, { role: "assistant", content: reply.content, ...(reply.link ? { link: reply.link } : {}) }],
    error,
    explained: true,
  };
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  return { supabase, user };
}

export async function sendChatMessage(prevState: ChatState, formData: FormData): Promise<ChatState> {
  const locale = await getLocale();
  const dictNow = dictionaries[locale];
  const sessionExpired = () =>
    explainedError(prevState.messages, failureReply(dictNow, "generic", "sessionExpired", { mode: "reenter" }), "not_authenticated");

  const { supabase, user } = await requireUser();
  if (!user) return sessionExpired();

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();
  if (!profile) return sessionExpired();

  const policy = await assistantPolicy(supabase);
  if (!policy.enabled) {
    const text = policy.available ? dictNow.chat.replies.assistantDisabled : dictNow.chat.replies.policyUnavailable;
    return explainedError(prevState.messages, { content: text }, "assistant_disabled");
  }

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
    console.error("chat: conversation row could not be created");
    return explainedError(prevState.messages, failureReply(dictNow, "generic", "unexpected", { mode: "reenter" }), "conversation_create_failed");
  }

  // "edit" and "cancel" (dropping/clearing a pending confirmation) are handled entirely
  // client-side now — see ChatPanel.tsx's handleEdit/handleCancel — since neither needs any
  // server work (an LLM call, a dispatch, persisted state); routing them through this
  // Server Action anyway made Next.js revalidate the current route's RSC payload on every
  // click, visibly flashing whatever table/Gantt sits behind the chat panel for no reason.
  // "cancel" still persists via a plain Route Handler (app/api/chat/abandon/route.ts),
  // which has no such revalidation side effect.

  // Phase C6: the org's carpool gating (one policy query). Drives the host-question wording in
  // the orchestrator, carpool-first for chat reservations and every carpool intent.
  const carpoolCtx = await loadChatCarpoolCtx(supabase, user.id, {
    organizationId: profile.organization_id,
    gating: deriveCarpoolGating(await loadLatestPolicy(supabase, profile.organization_id)),
  });

  // Tail of a vehicle card when the user answered Yes to offering seats under the new engine:
  // states exactly how many seats will be published after the reservation is created.
  function reservationTail(slots: Record<string, string>, maxOfferableSeats: number | undefined): string {
    if (!carpoolCtx?.gating.hostStep || slots.allowCarpool !== "true") return "";
    const requested = slots.offerSeats ? Number(slots.offerSeats) : maxOfferableSeats ?? 0;
    const seats = Math.min(Number.isInteger(requested) ? requested : 0, maxOfferableSeats ?? 0);
    return offerNoteForReservation(carpoolCtx, seats);
  }

  // FIX-VENCIDAS/Assistente: "no vehicle for this window" answer. Persisted with the trip slots but
  // WITHOUT an intent, so a reload never turns it back into a confirmation card; status idle (not
  // an error: the generic error line is reserved for genuinely unexpected failures).
  async function noVehicleState(
    slots: Record<string, string>,
    reply: AssistantReply,
    base: ChatMessage[],
  ): Promise<ChatState> {
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: reply.content,
      slots: packSlots(slots),
    });
    return {
      status: "idle",
      conversationId,
      messages: [...base, { role: "assistant", content: reply.content, link: reply.link }],
    };
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
    link?: ChatMessage["link"];
    /** true when the engine found no vehicle: the reply is an explanation, not a confirmation card. */
    noVehicle?: boolean;
  }> {
    const input: TripFormInput = {
      departureAt: new Date(slots.departureAt ?? "").toISOString(),
      expectedReturnAt: new Date(slots.expectedReturnAt ?? "").toISOString(),
      origin: slots.origin ?? "",
      originIsFreeText: true,
      destination: slots.destination ?? "",
      distanceKm: Number(slots.distanceKm ?? 0),
      passengerCount: Number(slots.passengerCount ?? 1),
      requiresCargo: slots.requiresCargo === "true",
      justification: slots.justification ?? "Solicitado via assistente conversacional",
      allowCarpool: slots.allowCarpool === "true",
    };
    const plan = await planTrip(input);

    if (plan.error) {
      // Session / availability read failure: plain reply, trip data kept in the form link, real
      // cause in the log.
      console.error("chat CREATE_RESERVATION planTrip failed:", plan.error);
      const reply = failureReply(dictNow, "reservation", classifyError(plan.error), { mode: "form", slots });
      return { assistantContent: reply.content, link: reply.link, status: "error" };
    }

    if (plan.type === "none") {
      // FIX-VENCIDAS/Assistente: no vehicle for this window is a legitimate answer (not an error):
      // the REAL cause (counts per reason) + alternatives + prefilled form link; the trip data and
      // the carpool intention are preserved in the link and in the persisted chat row.
      const reply = noVehicleReply(dictNow, slots, plan.reasons, plan.fleet, "reservation", plan.originCheck?.others);
      return {
        assistantContent: (note ? `${note}\n` : "") + reply.content,
        status: "idle",
        link: reply.link,
        noVehicle: true,
      };
    }

    if (plan.type === "vehicle" && plan.vehicle) {
      // A plate the user already named (answering a previous round of alternatives)
      // resolves against THIS fresh plan — never trusted blindly, only used if it's
      // still actually eligible right now.
      const namedPlate = slots.preferredVehiclePlate?.trim().toUpperCase();
      const namedMatch = namedPlate
        ? plan.vehicle.plate.toUpperCase() === namedPlate
          ? { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate, vehicleName: plan.vehicle.vehicleName, locationName: plan.vehicle.info.locationName }
          : plan.vehicle.alternatives.find((alt) => alt.plate.toUpperCase() === namedPlate)
        : undefined;
      const chosenVehicleId = namedMatch?.vehicleId ?? plan.vehicle.vehicleId;
      const chosenPlate = namedMatch?.plate ?? plan.vehicle.plate;
      const chosenVehicleName = namedMatch?.vehicleName ?? plan.vehicle.vehicleName;
      const chosenLocation =
        chosenVehicleId === plan.vehicle.vehicleId
          ? plan.vehicle.info.locationName
          : plan.vehicle.alternatives.find((a) => a.vehicleId === chosenVehicleId)?.info.locationName;
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
          dictNow,
          { vehicleId: chosenVehicleId, plate: chosenPlate, vehicleName: chosenVehicleName, locationName: chosenLocation },
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
      // options) and no vehicle card can be built: same explanation as "no vehicle".
      const reply = noVehicleReply(dictNow, slots, plan.reasons, plan.fleet, "reservation", plan.originCheck?.others);
      return { assistantContent: reply.content, status: "idle", link: reply.link, noVehicle: true };
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
      originIsFreeText: true,
      destination: pending.slots.destination ?? "",
      distanceKm: Number(pending.slots.distanceKm ?? 0),
      passengerCount: Number(pending.slots.passengerCount ?? 1),
      requiresCargo: pending.slots.requiresCargo === "true",
      justification: pending.slots.justification ?? "Solicitado via assistente conversacional",
      allowCarpool: pending.slots.allowCarpool === "true",
    };
    const plan = await planTrip(input);

    if (plan.type === "none" && !plan.error) {
      // Everything got booked up between rounds: explanation + alternatives, data preserved.
      return noVehicleState(pending.slots, noVehicleReply(dictNow, pending.slots, plan.reasons, plan.fleet, "reservation", plan.originCheck?.others), prevState.messages);
    }
    if (plan.type !== "vehicle" || !plan.vehicle) {
      // Planning failed (or only a legacy carpool is left): plain reply, trip data in the form link.
      if (plan.error) console.error("chat reselectVehicle planTrip failed:", plan.error);
      const reply = failureReply(
        dictNow,
        "reservation",
        plan.error ? classifyError(plan.error) : "vehicleUnavailable",
        { mode: "form", slots: pending.slots },
      );
      await admin.from("chat_messages").insert({ conversation_id: conversationId, role: "assistant", content: reply.content, slots: packSlots(pending.slots) });
      return explainedError(prevState.messages, reply, "vehicle_no_longer_available", conversationId);
    }

    const options = [
      { vehicleId: plan.vehicle.vehicleId, plate: plan.vehicle.plate, vehicleName: plan.vehicle.vehicleName, locationName: plan.vehicle.info.locationName },
      ...plan.vehicle.alternatives.map((a) => ({ vehicleId: a.vehicleId, plate: a.plate, vehicleName: a.vehicleName, locationName: a.info.locationName })),
    ];
    const chosen = options.find((o) => o.vehicleId === chosenVehicleId) ?? options[0]!;

    const chosenMax =
      chosen.vehicleId === plan.vehicle.vehicleId
        ? plan.vehicle.maxOfferableSeats
        : plan.vehicle.alternatives.find((a) => a.vehicleId === chosen.vehicleId)?.maxOfferableSeats;
    const summary = buildVehicleSummary(
      dictNow,
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
    if (!carpoolCtx) return { ...sessionExpired(), conversationId };
    const result = await prepareFromOption(
      carpoolCtx,
      { intent: pending.intent, slots: pending.slots, options: pending.options },
      optionId,
    );
    if (result.kind === "vehicle") {
      // "Use a vehicle": the normal vehicle card, carpool-first not repeated.
      const declinedSlots = { ...pending.slots, carpoolDeclined: "true" };
      const built = await buildReservationCard(declinedSlots, null, "");
      await admin.from("chat_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: built.assistantContent,
        intent: built.pendingAction?.intent,
        slots: built.pendingAction?.slots ?? (built.noVehicle ? packSlots(declinedSlots) : undefined),
      });
      return {
        status: built.status,
        conversationId,
        messages: [...prevState.messages, { role: "assistant", content: built.assistantContent, ...(built.link ? { link: built.link } : {}) }],
        pendingAction: built.pendingAction,
        error: built.status === "error" ? "plan_failed" : undefined,
        explained: built.status === "error" ? true : undefined,
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
      return explainedError(prevState.messages, failureReply(dictNow, "generic", "rateLimited", { mode: "chat" }), "rate_limited", conversationId);
    }
    if ((await countAssistant(startOfDay)) >= SELECT_DAILY_LIMIT) {
      return explainedError(prevState.messages, failureReply(dictNow, "generic", "dailyLimit", { mode: "chat" }), "daily_limit_reached", conversationId);
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
        return explainedError(
          prevState.messages,
          failureReply(dictNow, "generic", "confirmationExpired", { mode: "chat" }),
          "confirmation_not_pending",
          conversationId,
        );
      }
    }

    // Re-validate server-side rather than trusting the client's echoed slots — required
    // slots must still all be present (they were set once and only round-tripped as
    // hidden inputs, but nothing stops a tampered request from stripping one).
    if (missingRequiredSlots(pending.intent, pending.slots).length > 0) {
      return explainedError(
        prevState.messages,
        failureReply(dictNow, "generic", "missingInfo", { mode: "chat" }),
        "incomplete_slots",
        conversationId,
      );
    }

    const notAutomatedMessage = notAutomatedText(dictNow, pending.intent);
    const result = notAutomatedMessage
      ? { success: true, message: notAutomatedMessage, reply: { content: notAutomatedMessage } as AssistantReply, noVehicle: false }
      : await dispatchIntent(pending.intent, pending.slots, dictNow, locale);
    if (result.noVehicle) {
      // Not an error: explanation + alternatives + prefilled form; the conversation stays active
      // so the user can simply ask for another time.
      return noVehicleState(pending.slots, result.reply, prevState.messages);
    }
    const reply = result.reply;
    const assistantMessage: ChatMessage = reply.link
      ? { role: "assistant", content: reply.content, link: reply.link }
      : { role: "assistant", content: reply.content };
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      // The user-facing text (never a code): codes and causes go to the server log only.
      content: reply.content,
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
      explained: true,
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
    // The message was not processed nor stored: the user has to send it again later.
    return explainedError(prevState.messages, failureReply(dictNow, "generic", "dailyLimit", { mode: "reenter" }), "daily_limit_reached", conversationId);
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
    return explainedError(prevState.messages, failureReply(dictNow, "generic", "rateLimited", { mode: "reenter" }), "rate_limited", conversationId);
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
  let assistantLink: ChatMessage["link"];
  // Trip data kept on the persisted assistant row (no intent => never restored as a pending card).
  let noVehicleSlots: Record<string, string> | undefined;

  if (interpretation.status === "ok") {
    const notAutomatedMessage = notAutomatedText(dictNow, interpretation.intent);
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
        console.error("chat: carpool context unavailable for a carpool intent");
        assistantContent = failureReply(dictNow, "generic", "unexpected", { mode: "chat" }).content;
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
      const result = await dispatchIntent(interpretation.intent, interpretation.slots, dictNow, locale);
      assistantContent = result.reply.content;
      assistantLink = result.reply.link;
      if (result.noVehicle) noVehicleSlots = interpretation.slots;
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
        assistantLink = built.link;
        // Whenever the reply links to the prefilled form, the same trip data is kept on the row.
        if (built.link) noVehicleSlots = slots;
      }
    } else {
      assistantContent = interpretation.summary;
      pendingAction = { intent: interpretation.intent, slots: interpretation.slots, summary: interpretation.summary };
      status = "needs_confirmation";
    }
  } else if (interpretation.status === "needs_clarification") {
    assistantContent = interpretation.question;
  } else if (interpretation.status === "low_confidence" || interpretation.status === "unknown_intent") {
    assistantContent = dictNow.chat.replies.notUnderstood;
  } else {
    // Genuinely unexpected (LLM unavailable, missing API key, unparseable answer): generic text,
    // real cause only in the server log.
    console.error("chat interpretMessage failed:", interpretation.message);
    assistantContent = failureReply(dictNow, "generic", "unexpected", { mode: "chat" }).content;
    status = "error";
  }

  const assistantMessage: ChatMessage = assistantLink
    ? { role: "assistant", content: assistantContent, link: assistantLink }
    : { role: "assistant", content: assistantContent };
  await admin.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: assistantContent,
    intent: pendingAction?.intent,
    slots: pendingAction
      ? packSlots(pendingAction.slots, pendingAction.options, pendingAction.vehicleOptions)
      : packSlots(noVehicleSlots),
  });

  return {
    status,
    conversationId,
    messages: [...prevState.messages, userMessage, assistantMessage],
    pendingAction,
    error: status === "error" ? interpretation.status : undefined,
    // Every error reply above is written in plain words (what / why / alternatives / continue).
    explained: status === "error" ? true : undefined,
  };
}
