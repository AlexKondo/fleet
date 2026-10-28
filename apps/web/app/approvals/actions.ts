"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { isResultStatus } from "@/lib/approvals/emailResult";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The direct manager's decision on /approvals. Authorization lives in the database (fm_manager_decide_reservation: the caller must be the
 * requester's direct manager); this action validates the shape, forwards the decision as the signed-in user (no service role) and shows
 * the outcome. Fleet managers keep approving through their own screens (approve_reservation), which this does not touch.
 */
export async function decideInApp(reservationId: string, decision: "approve" | "reject"): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");
  let status = "generic_error";
  if (UUID.test(reservationId) && (decision === "approve" || decision === "reject")) {
    const { data, error } = await supabase.rpc("fm_manager_decide_reservation", { p_reservation_id: reservationId, p_decision: decision });
    if (!error && data && typeof data === "object" && !Array.isArray(data) && typeof (data as { status?: unknown }).status === "string") {
      status = (data as { status: string }).status;
    } else if (error) {
      console.error("in-app approval: decide failed", error.message);
    }
  }
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  redirect(`/approvals?r=${isResultStatus(status) ? status : "generic_error"}`);
}
