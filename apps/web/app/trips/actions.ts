"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { cleanCancelReason, notifyManagersOfCancellation } from "@/lib/trips/notifyManagersCancellation";

/**
 * Self-service cancellation of the caller's own upcoming trip
 * (0010_cancel_reservation.sql — cancel_reservation authorizes either the reservation's
 * own requester or a fleet_manager/administrator). No `useActionState` here: same
 * fire-and-redirect shape as dashboard/actions.ts's runFleetAction, for the same
 * reason — this is a plain `<form action={...}>` bound with the reservation id, with no
 * state slot to carry a typed error back to.
 */
export async function cancelMyReservation(reservationId: string, formData?: FormData): Promise<void> {
  // The manager is told about every cancellation, so the reason is asked BEFORE anything happens (the form field is required;
  // this is the server-side backstop for a request that skipped it).
  const reason = cleanCancelReason(formData?.get("reason"));
  if (!reason) redirect(`/reservations/${reservationId}?cancelError=reason_required`);

  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  const { error } = await supabase.rpc("cancel_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason,
  });
  revalidatePath("/trips");
  // Also called from the reservation detail page itself (no redirect on success there), so
  // that page needs to see the fresh status too, not just the /trips list.
  revalidatePath(`/reservations/${reservationId}`);
  if (error) {
    console.error("cancelMyReservation failed:", error.message);
    if (error.message.includes("CANCEL_BLOCKED_OPERATION_STARTED"))
      redirect("/trips?tripActionError=cancel_blocked_operation_started");
    redirect("/trips?tripActionError=1");
  }

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (profile) {
      await notifyManagersOfCancellation(supabase, {
        organizationId: profile.organization_id,
        requesterId: user.id,
        reservationId,
        reason,
      });
    }
  }
}

/** Leaving a legacy participation changes its state and retains passenger history. */
export async function leaveCarpool(participantId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("leave_legacy_participation",{p_id:participantId});
  revalidatePath("/trips");
  if (error) {
    console.error("leaveCarpool failed:", error.message);
    redirect("/trips?tripActionError=1");
  }
}
