"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserEmail } from "@/lib/email/recipients";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { getAppUrl } from "@/lib/getAppUrl";

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Fire-and-revalidate wrapper for the RPC-backed fleet manager actions below. These are
 * invoked directly as `<form action={...}>` (no client component / useActionState), so
 * there's no state slot to carry a typed error back to for inline display. A failed RPC
 * call is a normal, expected outcome here (an unauthorized role per the RLS checks
 * inside each function, a reservation someone else already approved, a vehicle someone
 * else already claimed) — never something that should crash the whole dashboard to
 * Next.js's generic error page. It's logged server-side (the raw message may be a
 * Postgres internal detail not fit for display) and the user is redirected back with a
 * generic `?fleetActionError=1` flag so the dashboard can show that *something* didn't
 * apply, without silently no-oping on a click that looked like it worked.
 */
async function runFleetAction(
  fn: (supabase: TypedSupabaseClient) => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await fn(supabase);
  revalidatePath("/dashboard");
  if (error) {
    console.error("Fleet action failed:", error.message);
    redirect("/dashboard?fleetActionError=1");
  }
}

/**
 * Counterpart of the `?fleetActionError=1` redirect above, for the success path. Every
 * action here used to end in silence: the page just re-rendered and the manager had to
 * infer from the row disappearing (or not) whether the click landed. `?actionSuccess=1`
 * renders the same banner the error flag does, in a positive color.
 *
 * Callers invoke this *last*, after any best-effort email, because `redirect()` throws.
 */
function redirectSuccess(searchParams = ""): never {
  redirect(`/dashboard?actionSuccess=1${searchParams}`);
}

/**
 * Free-text reason typed by the manager into an inline `<input name="...">`, falling back
 * to the localized default bound to the action when the field is left empty.
 */
function readReason(formData: FormData | undefined, field: string, fallback: string): string {
  const value = formData?.get(field);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * Best-effort email to the reservation's requester, mirroring whichever in-app
 * notification the calling RPC already inserted (0008/0010_*.sql) — same audience, same
 * event, just a second delivery channel. `build` receives the destination text so the
 * caller can phrase its own heading/body; never throws, never blocks the caller's
 * already-successful RPC result.
 */
async function notifyRequesterByEmail(
  supabase: TypedSupabaseClient,
  reservationId: string,
  build: (destination: string) => { heading: string; bodyLines: string[] },
): Promise<void> {
  const { data: reservation } = await supabase
    .from("reservations")
    .select("trip_request:trip_requests(requester_id, destination)")
    .eq("id", reservationId)
    .single();
  const requesterId = reservation?.trip_request?.requester_id;
  if (!requesterId) return;

  const email = await getUserEmail(requesterId);
  if (!email) return;

  const { heading, bodyLines } = build(reservation?.trip_request?.destination ?? "seu destino");
  const { html, text } = renderEmail({
    heading,
    bodyLines,
    ctaLabel: "Ver Minhas Viagens",
    ctaUrl: `${getAppUrl()}/trips`,
  });
  await sendEmail({ to: email, subject: heading, html, text });
}

export async function approveReservation(reservationId: string): Promise<void> {
  await runFleetAction((supabase) =>
    supabase.rpc("approve_reservation", { p_reservation_id: reservationId }),
  );
  const supabase = await createSupabaseServerClient();
  await notifyRequesterByEmail(supabase, reservationId, (destination) => ({
    heading: "Reserva aprovada",
    bodyLines: [
      `Sua reserva para <strong>${destination}</strong> foi aprovada e o veículo está confirmado.`,
    ],
  }));
  redirectSuccess();
}

/** `?myTasks=1` is the operator's active filter — preserved across a task action's redirect. */
function taskFilterSuffix(formData: FormData | undefined): string {
  return formData?.get("myTasks") === "1" ? "&myTasks=1" : "";
}

export async function completeWorkflowTask(taskId: string, formData?: FormData): Promise<void> {
  await runFleetAction((supabase) =>
    supabase.rpc("complete_workflow_task", { p_task_id: taskId }),
  );
  redirectSuccess(taskFilterSuffix(formData));
}

/** Dismiss a task that turned out unnecessary, without marking it falsely 'done' (0011_cancel_workflow_task.sql). */
export async function cancelWorkflowTask(taskId: string, formData?: FormData): Promise<void> {
  await runFleetAction((supabase) =>
    supabase.rpc("cancel_workflow_task", { p_task_id: taskId }),
  );
  redirectSuccess(taskFilterSuffix(formData));
}

/**
 * Claim an unassigned operational task (0030_workflow_task_assignee.sql). There's no RPC
 * for this one, so the guards the sibling actions get from their SECURITY DEFINER
 * functions are spelled out here: the caller must be signed in and hold a role that may
 * work the queue, and the update is conditioned on `assigned_to is null` so two operators
 * racing for the same task can't both "win" — the loser's update matches zero rows and
 * gets the same generic error banner as any other lost race.
 */
export async function claimWorkflowTask(taskId: string, formData?: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const canManageTasks =
    profile?.role === "fleet_manager" ||
    profile?.role === "administrator" ||
    profile?.role === "maintenance_operator";
  if (!canManageTasks) {
    redirect("/dashboard?fleetActionError=1");
  }

  const { data, error } = await supabase
    .from("workflow_tasks")
    .update({ assigned_to: user.id })
    .eq("id", taskId)
    .eq("status", "open")
    .is("assigned_to", null)
    .select("id");

  revalidatePath("/dashboard");
  if (error || !data || data.length === 0) {
    console.error("Fleet action failed:", error?.message ?? "task already claimed");
    redirect("/dashboard?fleetActionError=1");
  }
  redirectSuccess(taskFilterSuffix(formData));
}

export async function blockVehicle(
  vehicleId: string,
  defaultReason: string,
  formData?: FormData,
): Promise<void> {
  await runFleetAction((supabase) =>
    supabase.rpc("block_vehicle", {
      p_vehicle_id: vehicleId,
      p_reason: readReason(formData, "reason", defaultReason),
    }),
  );
  redirectSuccess();
}

export async function unblockVehicle(vehicleId: string): Promise<void> {
  await runFleetAction((supabase) =>
    supabase.rpc("unblock_vehicle", { p_vehicle_id: vehicleId }),
  );
  redirectSuccess();
}

/**
 * Reject a pending reservation or cancel a confirmed-but-not-yet-picked-up one
 * (0010_cancel_reservation.sql). Bound with the reservation id and a localized *default*
 * reason (`.bind(null, r.id, dict…)`); when the form carries a `reason` input the
 * manager's own words win. The reason is what the requester sees in their cancellation
 * notification and email, so "Rejeitada pelo gestor de frota" on every single rejection
 * told them nothing — this is the one field that explains the decision.
 */
export async function cancelReservation(
  reservationId: string,
  defaultReason: string,
  formData?: FormData,
): Promise<void> {
  const reason = readReason(formData, "reason", defaultReason);
  await runFleetAction((supabase) =>
    supabase.rpc("cancel_reservation", { p_reservation_id: reservationId, p_reason: reason }),
  );
  const supabase = await createSupabaseServerClient();
  await notifyRequesterByEmail(supabase, reservationId, (destination) => ({
    heading: "Reserva cancelada",
    bodyLines: [
      `Sua reserva para <strong>${destination}</strong> foi cancelada${reason ? `: ${reason}` : "."}`,
    ],
  }));
  redirectSuccess();
}

/**
 * §5 "Substituir veículos": move an existing reservation to a different vehicle. Bound
 * with the reservation id (`swapVehicle.bind(null, r.id)`); the target vehicle id comes
 * from the `<select name="vehicleId">` in the submitted form, same shape Next.js uses
 * for every bound server action with a form payload.
 */
export async function swapVehicle(reservationId: string, formData: FormData): Promise<void> {
  const newVehicleId = formData.get("vehicleId");
  if (typeof newVehicleId !== "string" || newVehicleId.length === 0) {
    redirect("/dashboard?fleetActionError=1");
  }
  await runFleetAction((supabase) =>
    supabase.rpc("swap_reservation_vehicle", {
      p_reservation_id: reservationId,
      p_new_vehicle_id: newVehicleId,
    }),
  );
  redirectSuccess();
}

/**
 * §5 "Transferir reservas": reassign a reservation's requester. Bound with the
 * reservation id; the target profile id comes from the `<select name="requesterId">` in
 * the submitted form.
 */
export async function transferReservation(reservationId: string, formData: FormData): Promise<void> {
  const newRequesterId = formData.get("requesterId");
  if (typeof newRequesterId !== "string" || newRequesterId.length === 0) {
    redirect("/dashboard?fleetActionError=1");
  }
  await runFleetAction((supabase) =>
    supabase.rpc("transfer_reservation", {
      p_reservation_id: reservationId,
      p_new_requester_id: newRequesterId,
    }),
  );
  redirectSuccess();
}
