"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { operationForm, operationReturn } from "@/lib/operations/forms";
export async function executeOperation(form: FormData) {
  const returnTo = operationReturn(form.get("return_to"));
  const url = new URL(returnTo, "https://fleet.invalid");
  url.searchParams.delete("error");
  url.searchParams.delete("success");
  const db = await createSupabaseServerClient();
  if (!(await getCurrentUser(db))) redirect("/login");
  let issue: string | null = null;
  try {
    const { command, payload, requestId } = operationForm(form);
    const { error } = await db.rpc("fm_v3_command", {
      p_command: command,
      p_payload: payload,
      p_request_id: requestId,
    });
    if (error) {
      const match =
        /(GATE_SELF_RELEASE_NOT_AUTHORIZED|INDEPENDENT_ACTOR_REQUIRED|PHYSICAL_DEPARTURE_ALREADY_RECORDED|EXCEPTION_NOT_REQUIRED|VEHICLE_ON_TRIP|KEYS_OUTSTANDING|SELF_APPROVAL_DENIED|SUPERIOR_APPROVAL_REQUIRED|APPROVER_NOT_AUTHORIZED|BUDGET_APPROVAL_PENDING|MANAGEMENT_SCOPE_DENIED|NOT_AUTHORIZED|NOT_FOUND|INVALID_INPUT|INVALID_STATE_TRANSITION|CONCURRENT_UPDATE|IDEMPOTENCY_CONFLICT|MAINTENANCE_CONFLICT|RESERVATION_CONFLICT|POWERTRAIN_MISMATCH|APPROVED_BUDGET_EXCEEDED|DEPARTURE_BLOCKED|CHECKLIST_REQUIRED|OUTSIDE_RESERVATION_WINDOW|OUTSIDE_MAINTENANCE_WINDOW|LEGACY_ARRIVAL_REASON_REQUIRED|VEHICLE_NOT_READY|IMMUTABLE_VIN)/.exec(
          error.message,
        );
      issue = match?.[1] ?? "UNAVAILABLE";
    }
  } catch {
    issue = "INVALID_INPUT";
  }
  if (issue) url.searchParams.set("error", issue);
  else {
    url.searchParams.set("success", "1");
    for (const p of ["/maintenance", "/fleet", "/gate", "/dashboard"])
      revalidatePath(p, "layout");
  }
  redirect(url.pathname + url.search);
}
