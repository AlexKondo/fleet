"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Self-service cancellation of the caller's own upcoming trip
 * (0010_cancel_reservation.sql — cancel_reservation authorizes either the reservation's
 * own requester or a fleet_manager/administrator). No `useActionState` here: same
 * fire-and-redirect shape as dashboard/actions.ts's runFleetAction, for the same
 * reason — this is a plain `<form action={...}>` bound with the reservation id, with no
 * state slot to carry a typed error back to.
 */
export async function cancelMyReservation(reservationId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_reservation", {
    p_reservation_id: reservationId,
  });
  revalidatePath("/trips");
  // Also called from the reservation detail page itself (no redirect on success there), so
  // that page needs to see the fresh status too, not just the /trips list.
  revalidatePath(`/reservations/${reservationId}`);
  if (error) {
    console.error("cancelMyReservation failed:", error.message);
    redirect("/trips?tripActionError=1");
  }
}

/**
 * Leave a carpool joined via create_carpool_participation (0003_trip_request_flow.sql).
 * A plain RLS-gated delete (0012_leave_carpool.sql "members leave trips they joined")
 * rather than an RPC — deleting your own trip_participants row has no side effects on
 * vehicle status or the driver's reservation, unlike cancelling a reservation.
 */
export async function leaveCarpool(participantId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("trip_participants").delete().eq("id", participantId);
  revalidatePath("/trips");
  if (error) {
    console.error("leaveCarpool failed:", error.message);
    redirect("/trips?tripActionError=1");
  }
}
