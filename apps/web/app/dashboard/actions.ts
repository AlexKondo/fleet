"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Fire-and-revalidate wrapper for the RPC-backed fleet manager actions below. These are
 * invoked directly as `<form action={...}>` (no client component / useActionState), so
 * they intentionally return void rather than a result — a failed RPC call (e.g. an
 * unauthorized role, per the RLS checks inside each function) surfaces as Next's default
 * server-action error handling rather than inline UI feedback. Acceptable for this
 * internal admin surface; revisit if/when these gain a client-side error display.
 */
async function runFleetAction(
  fn: (supabase: TypedSupabaseClient) => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await fn(supabase);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
}

export async function approveReservation(reservationId: string): Promise<void> {
  return runFleetAction((supabase) =>
    supabase.rpc("approve_reservation", { p_reservation_id: reservationId }),
  );
}

export async function completeWorkflowTask(taskId: string): Promise<void> {
  return runFleetAction((supabase) =>
    supabase.rpc("complete_workflow_task", { p_task_id: taskId }),
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
 * §5 "Substituir veículos": move an existing reservation to a different vehicle. Bound
 * with the reservation id (`swapVehicle.bind(null, r.id)`); the target vehicle id comes
 * from the `<select name="vehicleId">` in the submitted form, same shape Next.js uses
 * for every bound server action with a form payload.
 */
export async function swapVehicle(reservationId: string, formData: FormData): Promise<void> {
  const newVehicleId = formData.get("vehicleId");
  if (typeof newVehicleId !== "string" || newVehicleId.length === 0) {
    throw new Error("Select a target vehicle");
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
    throw new Error("Select a target user");
  }
  return runFleetAction((supabase) =>
    supabase.rpc("transfer_reservation", {
      p_reservation_id: reservationId,
      p_new_requester_id: newRequesterId,
    }),
  );
}
