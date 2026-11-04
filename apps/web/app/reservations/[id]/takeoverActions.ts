"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { afterTakeoverAccepted } from "@/lib/carpool/afterTakeoverAccepted";

/**
 * The rider answers the invitation to take over the reservation of a cancelled carpool trip (Aceitar / Recusar on the reservation page). The database checks
 * that he IS the current candidate, the deadline, his licence and overlaps; accepting asks his manager (or the fleet managers) to approve.
 */
export async function respondTakeover(formData: FormData): Promise<void> {
  const reservationId = String(formData.get("reservationId") ?? "");
  const takeoverId = String(formData.get("takeoverId") ?? "");
  const accept = formData.get("answer") === "accept";
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(takeoverId) || !/^[0-9a-f-]{36}$/i.test(reservationId)) redirect("/trips");
  const { data, error } = await supabase.rpc("fm_takeover_respond", { p_takeover_id: takeoverId, p_accept: accept });
  const result = data as { ok?: boolean; outcome?: string } | null;
  revalidatePath(`/reservations/${reservationId}`);
  revalidatePath("/trips");
  revalidatePath("/dashboard");
  if (error || !result || result.ok !== true) redirect(`/reservations/${reservationId}?takeover=failed`);
  if (result.outcome === "accepted") afterTakeoverAccepted(reservationId);
  redirect(accept ? `/reservations/${reservationId}` : "/trips");
}
