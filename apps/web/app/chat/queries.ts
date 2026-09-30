import "server-only";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { requiresConfirmation, type IntentName } from "@fleet/domain";
import type { ChatMessage, ChatState } from "./actions";

export interface ActiveReservationSummary {
  reservationId: string;
  status: string;
  vehiclePlate: string;
  destination: string;
  departureAt: string;
  expectedReturnAt: string;
}

/**
 * The caller's own pending/confirmed reservations — used both to give the orchestrator
 * context (so "cancela minha viagem" can resolve to the one active reservation without
 * asking which one) and to resolve VIEW_RESERVATION/FIND_MY_VEHICLE/CANCEL_RESERVATION
 * when the message didn't name a reservationId explicitly.
 */
export async function findActiveReservations(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<ActiveReservationSummary[]> {
  const { data } = await supabase
    .from("reservations")
    .select(
      `id, status, vehicle:vehicles(plate), trip_request:trip_requests!inner(requester_id, destination, departure_at, expected_return_at)`,
    )
    .eq("trip_request.requester_id", userId)
    .in("status", ["pending_approval", "confirmed"]);

  return (data ?? [])
    .filter((r) => r.trip_request)
    .map((r) => ({
      reservationId: r.id,
      status: r.status,
      vehiclePlate: r.vehicle?.plate ?? "",
      destination: r.trip_request!.destination,
      departureAt: r.trip_request!.departure_at,
      expectedReturnAt: r.trip_request!.expected_return_at,
    }));
}

/**
 * Restores the caller's most recent still-open conversation (server-fetched in
 * AppShell.tsx, passed down through ChatWidget/ChatPanel as useActionState's initial
 * value) — without this, reloading the page always started a brand-new conversation even
 * mid-exchange, since the previous one only ever lived in that React tree's own state.
 * A "resolved"/"abandoned" conversation is deliberately NOT restored: it already reached
 * an outcome, so continuing to show it as "current" would be confusing — the next message
 * naturally starts a fresh one (sendChatMessage creates a row when no conversationId is
 * passed).
 */
export async function loadLatestChatState(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<ChatState> {
  const idle: ChatState = { status: "idle", messages: [] };

  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversation) return idle;

  const { data: rows } = await supabase
    .from("chat_messages")
    .select("role, content, intent, slots")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });
  if (!rows || rows.length === 0) return idle;

  const messages: ChatMessage[] = rows.map((row) => ({
    role: row.role as ChatMessage["role"],
    content: row.content,
  }));

  const last = rows[rows.length - 1]!;
  // A pending confirmation looks like: the last row is the assistant's summary of a
  // mutating intent, tagged with intent+slots, and the conversation never got marked
  // resolved (sendChatMessage's confirm phase does that) — i.e. the user closed the tab
  // or navigated away right after being asked to confirm, without answering either way.
  if (
    last.role === "assistant" &&
    last.intent &&
    requiresConfirmation(last.intent as IntentName) !== "no"
  ) {
    return {
      status: "needs_confirmation",
      conversationId: conversation.id,
      messages,
      pendingAction: {
        intent: last.intent as IntentName,
        slots: (last.slots as Record<string, string>) ?? {},
        summary: last.content,
      },
    };
  }

  return { status: "idle", conversationId: conversation.id, messages };
}

/** Resolves a possibly-missing reservationId slot against the caller's own active
 * reservations — exact match if given, the single active one if there's only one, or
 * null (ambiguous/none) otherwise, which the caller should turn into a clarifying
 * question rather than guessing. */
export function resolveReservationId(
  slotValue: string | undefined,
  active: ActiveReservationSummary[],
): string | null {
  if (slotValue) return active.some((r) => r.reservationId === slotValue) ? slotValue : null;
  return active.length === 1 ? active[0]!.reservationId : null;
}

export interface ChatUsageStats {
  conversationsLast7Days: number;
  messagesToday: number;
  resolvedCount: number;
  abandonedCount: number;
  topIntents: { intent: string; count: number }[];
}

/**
 * Org-wide chat usage summary for Configurações (fleet_manager/administrator only) — the
 * doc's §V5 telemetry requirement (invocation rate, outcomes) in the simplest form that
 * doesn't need a new events table: aggregated directly from chat_conversations/
 * chat_messages. RLS on those tables only lets a user see their OWN rows, so this must run
 * on the admin client — the caller is responsible for having already verified the acting
 * user is actually a fleet_manager/administrator of `organizationId` before calling this,
 * same convention as every other admin-client query in this app.
 */
export async function getChatUsageStats(
  admin: TypedSupabaseClient,
  organizationId: string,
): Promise<ChatUsageStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

  const [{ count: conversationsLast7Days }, { data: conversations }] = await Promise.all([
    admin
      .from("chat_conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", sevenDaysAgo),
    admin.from("chat_conversations").select("id, status").eq("organization_id", organizationId),
  ]);

  const conversationIds = (conversations ?? []).map((c) => c.id);
  const resolvedCount = (conversations ?? []).filter((c) => c.status === "resolved").length;
  const abandonedCount = (conversations ?? []).filter((c) => c.status === "abandoned").length;

  let messagesToday = 0;
  const intentCounts = new Map<string, number>();
  if (conversationIds.length > 0) {
    const { count } = await admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", conversationIds)
      .gte("created_at", todayStart);
    messagesToday = count ?? 0;

    const { data: intentRows } = await admin
      .from("chat_messages")
      .select("intent")
      .in("conversation_id", conversationIds)
      .not("intent", "is", null);
    for (const row of intentRows ?? []) {
      if (!row.intent) continue;
      intentCounts.set(row.intent, (intentCounts.get(row.intent) ?? 0) + 1);
    }
  }

  const topIntents = Array.from(intentCounts.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    conversationsLast7Days: conversationsLast7Days ?? 0,
    messagesToday,
    resolvedCount,
    abandonedCount,
    topIntents,
  };
}
