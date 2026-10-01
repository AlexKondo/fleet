"use server";

/**
 * Phase C4 — thin server-action layer over the carpool lifecycle RPCs (0059). Mirrors
 * apps/web/app/reservations/[id]/actions.ts: every call goes through the RLS-respecting
 * server client, authenticates via the session, and delegates ALL authorization, seat
 * accounting, idempotency and audit to the security-definer RPCs. Nothing here trusts a
 * client-supplied id beyond passing it to an RPC that re-checks ownership and organization
 * server-side; ids are shape-validated first only to avoid pointless round-trips.
 *
 * Results are `{ status: "success" | "error", error?: code }` — stable codes the C5 UI
 * translates (raw Postgres text never leaves the server; it is logged).
 *
 * No UI is wired to these in C4 (that is C5). Voice (C6) must call the same functions.
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidSeatCount } from "@fleet/domain";
import { isUuid, toCarpoolErrorCode, type CarpoolErrorCode } from "@/lib/carpool/rpcErrors";
import type { RiderTripDraft } from "@/lib/carpool/runCarpoolSearch";
import { searchCompatibleCarpool } from "./actions";

export type CarpoolActionError =
  | CarpoolErrorCode
  | "not_authenticated"
  | "invalid_input"
  | "offer_not_compatible"
  | "carpool_unavailable";

export type CarpoolActionResult<T extends object = object> =
  | ({ status: "success" } & T)
  | { status: "error"; error: CarpoolActionError };

const INVALID = { status: "error", error: "invalid_input" } as const;
const UNAUTHENTICATED = { status: "error", error: "not_authenticated" } as const;

async function authedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  return user ? { supabase, user } : null;
}

function refresh(reservationId?: string) {
  revalidatePath("/trips");
  revalidatePath("/dashboard");
  // Only used to pick which cached page to refresh — never trusted for anything else.
  if (isUuid(reservationId)) revalidatePath(`/reservations/${reservationId}`);
}

function fail(rpcName: string, message: string) {
  console.error(`${rpcName} failed:`, message);
  return { status: "error", error: toCarpoolErrorCode(message) } as const;
}

export async function enableCarpoolOffer(
  tripRequestId: string,
  seats: number,
  reservationId?: string,
): Promise<CarpoolActionResult<{ offerId: string }>> {
  if (!isUuid(tripRequestId) || !isValidSeatCount(seats)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;
  const { data, error } = await ctx.supabase.rpc("enable_carpool_offer", {
    p_trip_request_id: tripRequestId,
    p_seats: seats,
  });
  if (error) return fail("enable_carpool_offer", error.message);
  refresh(reservationId);
  return { status: "success", offerId: data as string };
}

export async function updateCarpoolOffer(
  offerId: string,
  seats: number,
  reservationId?: string,
): Promise<CarpoolActionResult> {
  if (!isUuid(offerId) || !isValidSeatCount(seats)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;
  const { error } = await ctx.supabase.rpc("update_carpool_offer", { p_offer_id: offerId, p_seats: seats });
  if (error) return fail("update_carpool_offer", error.message);
  refresh(reservationId);
  return { status: "success" };
}

export async function disableCarpoolOffer(
  offerId: string,
  reservationId?: string,
): Promise<CarpoolActionResult> {
  if (!isUuid(offerId)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;
  const { error } = await ctx.supabase.rpc("disable_carpool_offer", { p_offer_id: offerId });
  if (error) return fail("disable_carpool_offer", error.message);
  refresh(reservationId);
  return { status: "success" };
}

/**
 * Rider requests a seat on an offer. The route-evaluation numbers recorded on the request are
 * NEVER taken from the client: the search pipeline (geocoding + RoutingProvider + Stage B) is
 * re-run server-side for this rider's draft and the matching offer's numbers are used. If the
 * offer is not among the compatible matches (or the provider is unavailable) nothing is
 * created. `clientRequestId` is the caller-generated idempotency key (generate once per user
 * intent, e.g. when the confirm dialog opens, and reuse it on retry/double-tap).
 */
function locationJson(point: { lat: number; lng: number }, label: unknown) {
  const clean = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return {
    coordinates: { lat: point.lat, lng: point.lng },
    source: "manual_lat_lng",
    ...(clean ? { label: clean } : {}),
  };
}

export async function requestCarpoolRide(input: {
  offerId: string;
  clientRequestId: string;
  draft: RiderTripDraft;
  reservationId?: string;
  /** Phase C5: the canonical labels the rider confirmed in New Trip; stored (trimmed, capped)
   * next to the coordinates so the rider/host can read the pickup/drop-off summary later. */
  pickupLabel?: string;
  dropoffLabel?: string;
}): Promise<CarpoolActionResult<{ requestId: string }>> {
  if (!isUuid(input?.offerId) || !isUuid(input?.clientRequestId)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;

  const search = await searchCompatibleCarpool(input.draft);
  if (search.status === "error") return INVALID;
  if (search.status === "unavailable") return { status: "error", error: "carpool_unavailable" };
  const match = search.matches.find((m) => m.offerId === input.offerId);
  if (!match) return { status: "error", error: "offer_not_compatible" };

  // The ONLY path that creates a request: service-role function, called AFTER the session user
  // was authenticated above. p_rider_id is the authenticated user's id (never client input), and
  // the route numbers + coordinates come from the server-side search result (`match`) alone.
  // create_carpool_ride_request_as_rider is not executable by anon/authenticated (0060).
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("create_carpool_ride_request_as_rider", {
    p_rider_id: ctx.user.id,
    p_offer_id: input.offerId,
    p_seats: input.draft.requestedSeats,
    p_pickup: locationJson(match.pickup, input.pickupLabel),
    p_dropoff: locationJson(match.dropoff, input.dropoffLabel),
    p_requested_departure_at: new Date(input.draft.requestedDepartureAt).toISOString(),
    p_client_request_id: input.clientRequestId,
    p_match_additional_distance_km: match.additionalDistanceKm,
    p_match_additional_time_min: match.additionalTimeMin,
  });
  if (error) return fail("create_carpool_ride_request_as_rider", error.message);
  refresh(input.reservationId);
  return { status: "success", requestId: data as string };
}

export async function acceptCarpoolRequest(
  requestId: string,
  reservationId?: string,
): Promise<CarpoolActionResult> {
  if (!isUuid(requestId)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;
  const { error } = await ctx.supabase.rpc("accept_carpool_ride_request", { p_request_id: requestId });
  if (error) return fail("accept_carpool_ride_request", error.message);
  refresh(reservationId);
  return { status: "success" };
}

export async function rejectCarpoolRequest(
  requestId: string,
  reason?: string,
  reservationId?: string,
): Promise<CarpoolActionResult> {
  if (!isUuid(requestId)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;
  const { error } = await ctx.supabase.rpc("reject_carpool_ride_request", {
    p_request_id: requestId,
    p_reason: (reason ?? "").slice(0, 500),
  });
  if (error) return fail("reject_carpool_ride_request", error.message);
  refresh(reservationId);
  return { status: "success" };
}

export async function cancelCarpoolRequest(
  requestId: string,
  reservationId?: string,
): Promise<CarpoolActionResult> {
  if (!isUuid(requestId)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;
  const { error } = await ctx.supabase.rpc("cancel_carpool_ride_request", { p_request_id: requestId });
  if (error) return fail("cancel_carpool_ride_request", error.message);
  refresh(reservationId);
  return { status: "success" };
}

export async function revalidateCarpoolMatches(
  tripRequestId: string,
  reservationId?: string,
): Promise<CarpoolActionResult<{ invalidated: number }>> {
  if (!isUuid(tripRequestId)) return INVALID;
  const ctx = await authedClient();
  if (!ctx) return UNAUTHENTICATED;
  const { data, error } = await ctx.supabase.rpc("revalidate_carpool_matches", {
    p_trip_request_id: tripRequestId,
  });
  if (error) return fail("revalidate_carpool_matches", error.message);
  refresh(reservationId);
  return {
    status: "success",
    invalidated: Number((data as { invalidated?: number } | null)?.invalidated ?? 0),
  };
}
