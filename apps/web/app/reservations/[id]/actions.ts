"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { attemptAutomaticReassignment } from "@/lib/domain/autoReassignment";
import { getDictionary } from "@/lib/i18n/getLocale";

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
 * reservation impacted + notify) — see 0018_automatic_reassignment.sql for why that
 * lives in the RPC rather than here (atomicity with the message write). The RPC returns
 * which reservations it just marked impacted, so BR-019/BR-020's automatic-reassignment
 * step can run right after — see autoReassignment.ts for why that step itself is NOT in
 * the RPC (it needs the TypeScript Mobility Decision Engine).
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) return { status: "error", error: "no_profile" };

  const reservationId = String(formData.get("reservationId") ?? "");
  const messageType = String(formData.get("messageType") ?? "text");
  const body = String(formData.get("body") ?? "").trim();
  const newExpectedReturnAtRaw = String(formData.get("newExpectedReturnAt") ?? "").trim();

  const dict = await getDictionary();
  if (!reservationId) return { status: "error", error: dict.errors.reservations.reservationInvalid };
  if (!body) return { status: "error", error: dict.errors.reservations.messageRequired };
  if (!MESSAGE_TYPES.includes(messageType as MessageType)) {
    return { status: "error", error: dict.errors.reservations.messageTypeInvalid };
  }

  const { data, error } = await supabase.rpc("post_reservation_message", {
    p_reservation_id: reservationId,
    p_message_type: messageType as MessageType,
    p_body: body,
    p_new_expected_return_at: newExpectedReturnAtRaw
      ? new Date(newExpectedReturnAtRaw).toISOString()
      : undefined,
  });
  if (error) return { status: "error", error: error.message };

  const impactedReservationIds = (
    (data as { impacted_reservation_ids?: string[] } | null)?.impacted_reservation_ids ?? []
  ).filter((id): id is string => typeof id === "string");

  if (impactedReservationIds.length > 0) {
    // Best-effort — a failure here must never surface as a failure of the message the
    // user actually just sent; the reservation simply stays impacted for manual handling.
    await attemptAutomaticReassignment(supabase, profile.organization_id, impactedReservationIds);
  }

  revalidatePath(`/reservations/${reservationId}`);
  return { status: "success" };
}

/**
 * ISSUE-016 remediation: the host driver accepts or rejects a pending carpool join
 * request on their own reservation (respond_to_carpool_request,
 * 0020_carpool_host_acceptance.sql — security definer, re-checks host ownership and
 * vehicle capacity server-side regardless of what this form was rendered with). Plain
 * fire-and-revalidate shape (no useActionState) — same reasoning as
 * dashboard/actions.ts's runFleetAction: this is bound directly to a form with no state
 * slot, and a failure here (request already resolved by a race, capacity now full) is a
 * normal outcome, not something that should crash the page.
 */
export async function respondToCarpoolRequest(
  reservationId: string,
  participantId: string,
  accept: boolean,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("respond_to_carpool_request", {
    p_participant_id: participantId,
    p_accept: accept,
  });
  revalidatePath(`/reservations/${reservationId}`);
  if (error) {
    console.error("respondToCarpoolRequest failed:", error.message);
  }
}
