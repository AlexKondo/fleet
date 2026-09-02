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
