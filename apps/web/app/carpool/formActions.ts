"use server";

/**
 * Phase C5 — form-bound wrappers (return void / redirect) over the C4 server actions, for the
 * Server-Component pages (My Trip host view, Trips rider view). Same shape as
 * reservations/[id]/actions.ts#respondToCarpoolRequest: the RPC does ALL authorization (host
 * ownership, organization, seat accounting); these only translate a failure into a redirect
 * carrying a stable error code the page renders as a banner. Ids are shape-validated first and
 * never trusted beyond being passed to an RPC that re-checks them.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { isUuid } from "@/lib/carpool/rpcErrors";
import {
  acceptCarpoolRequest,
  cancelCarpoolRequest,
  disableCarpoolOffer,
  enableCarpoolOffer,
  rejectCarpoolRequest,
  updateCarpoolOffer,
  type CarpoolActionResult,
} from "./requestActions";

function reservationPath(reservationId: string): string {
  return `/reservations/${reservationId}`;
}

function done(result: CarpoolActionResult, backTo: string, okFlag?: string): never {
  if (result.status === "error") {
    redirect(`${backTo}?carpoolActionError=${encodeURIComponent(result.error)}`);
  }
  redirect(okFlag ? `${backTo}?${okFlag}` : backTo);
}

function seatsFrom(formData: FormData): number {
  const n = Number(String(formData.get("seats") ?? ""));
  return Number.isInteger(n) ? n : Number.NaN;
}

export async function hostEnableOffer(
  reservationId: string,
  tripRequestId: string,
  formData: FormData,
): Promise<void> {
  if (!isUuid(reservationId)) redirect("/trips");
  done(await enableCarpoolOffer(tripRequestId, seatsFrom(formData), reservationId), reservationPath(reservationId));
}

export async function hostUpdateOffer(
  reservationId: string,
  offerId: string,
  formData: FormData,
): Promise<void> {
  if (!isUuid(reservationId)) redirect("/trips");
  done(await updateCarpoolOffer(offerId, seatsFrom(formData), reservationId), reservationPath(reservationId));
}

export async function hostDisableOffer(reservationId: string, offerId: string): Promise<void> {
  if (!isUuid(reservationId)) redirect("/trips");
  done(await disableCarpoolOffer(offerId, reservationId), reservationPath(reservationId));
}

export async function hostAcceptRequest(reservationId: string, requestId: string): Promise<void> {
  if (!isUuid(reservationId)) redirect("/trips");
  done(await acceptCarpoolRequest(requestId, reservationId), reservationPath(reservationId));
}

export async function hostRejectRequest(
  reservationId: string,
  requestId: string,
  formData: FormData,
): Promise<void> {
  if (!isUuid(reservationId)) redirect("/trips");
  const reason = String(formData.get("reason") ?? "").trim();
  done(await rejectCarpoolRequest(requestId, reason || undefined, reservationId), reservationPath(reservationId));
}

/** Rider cancels their own request (PENDING or ACCEPTED) from the Trips page. */
export async function riderCancelRequest(requestId: string): Promise<void> {
  done(await cancelCarpoolRequest(requestId), "/trips");
}

/**
 * New Trip: after requestCarpoolRide succeeds, the real outcome (PENDING = waiting for the host,
 * ACCEPTED = auto-accepted by policy) is read back from the rider's OWN request row (RLS: a rider
 * only ever sees their own). Returns null when it cannot be read.
 */
export async function getMyCarpoolRequestStatus(
  requestId: string,
): Promise<{ status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "INVALIDATED" } | null> {
  if (!isUuid(requestId)) return null;
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return null;
  const { data } = await supabase
    .from("carpool_ride_requests")
    .select("status")
    .eq("id", requestId)
    .eq("rider_id", user.id)
    .maybeSingle();
  revalidatePath("/trips");
  return data ? { status: data.status as never } : null;
}
