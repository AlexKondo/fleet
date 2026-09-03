"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
}

export async function completeWorkflowTask(taskId: string): Promise<void> {
  return runFleetAction((supabase) =>
    supabase.rpc("complete_workflow_task", { p_task_id: taskId }),
  );
}

/** Dismiss a task that turned out unnecessary, without marking it falsely 'done' (0011_cancel_workflow_task.sql). */
export async function cancelWorkflowTask(taskId: string): Promise<void> {
  return runFleetAction((supabase) =>
    supabase.rpc("cancel_workflow_task", { p_task_id: taskId }),
  );
}

export async function blockVehicle(vehicleId: string, reason: string): Promise<void> {
  return runFleetAction((supabase) =>
    supabase.rpc("block_vehicle", { p_vehicle_id: vehicleId, p_reason: reason }),
  );
}

export async function unblockVehicle(vehicleId: string): Promise<void> {
  return runFleetAction((supabase) =>
    supabase.rpc("unblock_vehicle", { p_vehicle_id: vehicleId }),
  );
}

/**
 * Reject a pending reservation or cancel a confirmed-but-not-yet-picked-up one
 * (0010_cancel_reservation.sql). Same bound-with-a-fixed-reason shape as the
 * blockVehicle button above (`.bind(null, r.id, "...")`) — no reason input in this UI,
 * matching that precedent's level of simplicity.
 */
export async function cancelReservation(reservationId: string, reason: string): Promise<void> {
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
  return runFleetAction((supabase) =>
    supabase.rpc("swap_reservation_vehicle", {
      p_reservation_id: reservationId,
      p_new_vehicle_id: newVehicleId,
    }),
  );
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
  return runFleetAction((supabase) =>
    supabase.rpc("transfer_reservation", {
      p_reservation_id: reservationId,
      p_new_requester_id: newRequesterId,
    }),
  );
}
